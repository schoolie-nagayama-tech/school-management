import { supabase } from '../supabase';
import type { Database } from '@/types/database';

/**
 * 志望校・高校マスタの読み書き。
 * ------------------------------------------------------------------
 * このリポジトリの流儀（src/lib/api/interviews.ts）に合わせ、API Route を作らず
 * ブラウザから Supabase を直叩きする。RLS（check_school_access）が教室スコープを守る。
 * 正典: docs/interview-script-ai-plan.md §4
 */

type HighSchoolRow = Database['public']['Tables']['high_schools']['Row'];
type HighSchoolStandardRow = Database['public']['Tables']['high_school_standards']['Row'];
type TargetSchoolDbRow = Database['public']['Tables']['student_target_schools']['Row'];

/** 志望校1件がマスタに当たったときの合格めやす情報 */
export interface TargetSchoolMaster {
  prefecture: string;
  schoolName: string;
  // ★空文字＝普通科の本体（NULLではない）。UNIQUE制約の都合でDB側の既定値も空文字。
  course: string;
  category: string;
  naishin: number | null;
  naishinMax: number | null;
  hensachi: number | null;
  sourceLabel: string;
  // ★NULL＝紙の原本とまだ突き合わせていない（手起こしの数値）。画面ではその旨を示す。
  verifiedAt: string | null;
}

/** 生徒1人の志望校1件（第1〜3志望のいずれか） */
export interface TargetSchoolRow {
  id: string;
  rank: number;
  schoolName: string;
  // ★null可。私立・国立・他県はマスタに無いので、自由記述のまま残る。
  highSchoolId: string | null;
  reason: string | null;
  updatedAt: string;
  // マスタに当たったときだけ入る。当たらなければ null（＝自由記述のまま）。
  master: TargetSchoolMaster | null;
}

/** 保存時に渡す1件分の入力 */
export interface TargetSchoolInput {
  rank: number;
  schoolName: string;
  highSchoolId: string | null;
  reason: string | null;
}

/** 高校マスタの検索結果（最新年度のめやすを添えたもの） */
export interface HighSchoolSearchResult {
  id: string;
  prefecture: string;
  schoolName: string;
  course: string;
  category: string;
  municipality: string | null;
  naishin: number | null;
  naishinMax: number | null;
  hensachi: number | null;
  sourceLabel: string;
  verifiedAt: string | null;
}

/**
 * high_school_standards は年度ごとに複数行あるうち、source_year が最大の1件だけを使う。
 * DB側の .order() はモック環境やRLS越しでも並びを厳密に保証しないため、
 * 呼び出し側（JS）で最大年度を選び直す。
 */
function pickLatestStandard(
  standards: HighSchoolStandardRow[],
  highSchoolId: string
): HighSchoolStandardRow | undefined {
  return standards
    .filter((s) => s.high_school_id === highSchoolId)
    .sort((a, b) => b.source_year - a.source_year)[0];
}

function toMaster(
  school: HighSchoolRow | undefined,
  standard: HighSchoolStandardRow | undefined
): TargetSchoolMaster | null {
  if (!school) return null;
  return {
    prefecture: school.prefecture,
    schoolName: school.school_name,
    course: school.course,
    category: school.category,
    naishin: standard?.naishin ?? null,
    naishinMax: standard?.naishin_max ?? null,
    hensachi: standard?.hensachi ?? null,
    sourceLabel: standard?.source_label ?? '',
    verifiedAt: standard?.verified_at ?? null,
  };
}

/**
 * 生徒の志望校（第1〜3志望）を rank 昇順で取得する。
 * high_schools・high_school_standards（最新年度）を結合し、必要内申・必要偏差値・
 * 出典ラベル・verified_at も一緒に返す。
 */
export async function getStudentTargetSchools(studentId: string): Promise<TargetSchoolRow[]> {
  const { data, error } = await supabase
    .from('student_target_schools')
    .select('*')
    .eq('student_id', studentId)
    .order('rank', { ascending: true });

  if (error) {
    throw new Error(`志望校の取得に失敗しました: ${error.message}`);
  }

  const rows = (data || []) as TargetSchoolDbRow[];
  const highSchoolIds = Array.from(
    new Set(rows.map((r) => r.high_school_id).filter((id): id is string => Boolean(id)))
  );

  let schoolsById = new Map<string, HighSchoolRow>();
  let standards: HighSchoolStandardRow[] = [];

  if (highSchoolIds.length > 0) {
    const [schoolsRes, standardsRes] = await Promise.all([
      supabase.from('high_schools').select('*').in('id', highSchoolIds),
      supabase
        .from('high_school_standards')
        .select('*')
        .in('high_school_id', highSchoolIds)
        .order('source_year', { ascending: false }),
    ]);

    if (schoolsRes.error) {
      throw new Error(`高校マスタの取得に失敗しました: ${schoolsRes.error.message}`);
    }
    if (standardsRes.error) {
      throw new Error(`合格めやすの取得に失敗しました: ${standardsRes.error.message}`);
    }

    // ★Promise.all で別テーブルのクエリを並べると要素の型が {} に潰れる。
    //   map の中で as を書くと s.id が引けないので、配列ごと先にキャストする。
    const schoolRows = (schoolsRes.data || []) as HighSchoolRow[];
    schoolsById = new Map(schoolRows.map((s) => [s.id, s]));
    standards = (standardsRes.data || []) as HighSchoolStandardRow[];
  }

  return rows.map((row) => {
    const school = row.high_school_id ? schoolsById.get(row.high_school_id) : undefined;
    const standard = row.high_school_id
      ? pickLatestStandard(standards, row.high_school_id)
      : undefined;
    return {
      id: row.id,
      rank: row.rank,
      schoolName: row.school_name,
      highSchoolId: row.high_school_id,
      reason: row.reason,
      updatedAt: row.updated_at,
      master: toMaster(school, standard),
    };
  });
}

/**
 * 生徒の志望校（第1〜3志望）をまとめて保存する。
 *
 * - school_name が空の rank は削除する（＝その志望順位を未入力に戻す）。
 * - 残りは (student_id, rank) の UNIQUE 制約に対して upsert する。
 * - ★school_id はそのまま渡してよい。BEFOREトリガー trg_student_target_schools_sync_school が
 *   生徒の所属校で必ず上書きするため、呼び出し側で正確な値を用意する必要はない
 *   （ズレていてもトリガーが矯正する＝壊れない）。
 */
export async function saveStudentTargetSchools(
  studentId: string,
  schoolId: string,
  rows: TargetSchoolInput[]
): Promise<void> {
  const ranksToDelete = rows.filter((r) => !r.schoolName.trim()).map((r) => r.rank);
  const rowsToUpsert = rows
    .filter((r) => r.schoolName.trim())
    .map((r) => ({
      student_id: studentId,
      school_id: schoolId,
      rank: r.rank,
      school_name: r.schoolName.trim(),
      // ★マスタに当たらなくてもnullのまま保存できる（私立・国立・他県を塞がないため）
      high_school_id: r.highSchoolId,
      reason: r.reason?.trim() || null,
    }));

  if (ranksToDelete.length > 0) {
    const { error } = await supabase
      .from('student_target_schools')
      .delete()
      .eq('student_id', studentId)
      .in('rank', ranksToDelete);

    if (error) {
      throw new Error(`志望校の削除に失敗しました: ${error.message}`);
    }
  }

  if (rowsToUpsert.length > 0) {
    const { error } = await supabase
      .from('student_target_schools')
      .upsert(rowsToUpsert, { onConflict: 'student_id,rank' });

    if (error) {
      throw new Error(`志望校の保存に失敗しました: ${error.message}`);
    }
  }
}

/**
 * 高校マスタを学校名の部分一致で検索する（最大20件）。
 * 最新年度の内申・偏差値・所在地も一緒に返す。
 * ★course が空文字のもの（普通科の本体）を先に出す。「小平（外国語科）」より「小平」を上に、
 *   という面談での自然な並び（普通科が基本形）に合わせるため。
 */
export async function searchHighSchools(query: string): Promise<HighSchoolSearchResult[]> {
  // ★ilike のパターンなので % と _ はワイルドカードとして効いてしまう。
  //   学校名に含まれることはないので、打ち間違いで全件マッチにならないよう落とす。
  const q = query.trim().replace(/[%_]/g, '');
  if (!q) return [];

  const { data: schools, error } = await supabase
    .from('high_schools')
    .select('*')
    // ★並べ替えは必ず limit より前、つまりDB側でやる。
    //   JS側で並べ替えると「先に見せたい普通科の本体」が20件の枠から落ちる。
    //   「工科」で25件ヒットするような検索で実際に落ちた。
    .ilike('school_name', `%${q}%`)
    .order('course', { ascending: true })
    .order('school_name', { ascending: true })
    .limit(20);

  if (error) {
    throw new Error(`高校マスタの検索に失敗しました: ${error.message}`);
  }

  const list = (schools || []) as HighSchoolRow[];
  if (list.length === 0) return [];

  const ids = list.map((s) => s.id);
  const { data: standardsData, error: standardsError } = await supabase
    .from('high_school_standards')
    .select('*')
    .in('high_school_id', ids)
    .order('source_year', { ascending: false });

  if (standardsError) {
    throw new Error(`合格めやすの取得に失敗しました: ${standardsError.message}`);
  }

  const standards = (standardsData || []) as HighSchoolStandardRow[];

  return list
    .map((s) => {
      const standard = pickLatestStandard(standards, s.id);
      return {
        id: s.id,
        prefecture: s.prefecture,
        schoolName: s.school_name,
        course: s.course,
        category: s.category,
        municipality: s.municipality,
        naishin: standard?.naishin ?? null,
        naishinMax: standard?.naishin_max ?? null,
        hensachi: standard?.hensachi ?? null,
        sourceLabel: standard?.source_label ?? '',
        verifiedAt: standard?.verified_at ?? null,
      };
    })
    .sort((a, b) => {
      // course 空文字（普通科の本体）を先に。空文字はどの非空文字より辞書順で小さいので
      // localeCompare でも自然にそうなるが、意図を明示するため比較を分ける。
      const aIsBase = a.course === '' ? 0 : 1;
      const bIsBase = b.course === '' ? 0 : 1;
      if (aIsBase !== bIsBase) return aIsBase - bIsBase;
      return a.schoolName.localeCompare(b.schoolName, 'ja');
    });
}
