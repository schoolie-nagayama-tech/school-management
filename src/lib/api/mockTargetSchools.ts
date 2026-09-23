import { supabase } from '../supabase';
import type { Database } from '@/types/database';
import type { HighSchoolKeyRow, MockSchoolChoice } from '@/lib/scores/mockSchools';

/**
 * 模試の志望校（assessment_target_schools）の読み書き。
 * ------------------------------------------------------------------
 * targetSchools.ts と同じく API Route を作らずブラウザから直叩きする。
 * RLS（check_school_access）が教室スコープを守り、school_id はトリガーが生徒の所属校に強制する。
 * 正典: docs/interview-workspace-layout-2026-09.md「模試の志望校」
 */

type AssessmentTargetSchoolDbRow = Database['public']['Tables']['assessment_target_schools']['Row'];

/** 面談画面に渡す模試の志望校1枠 */
export interface MockSchoolRecord {
  assessmentId: string;
  slot: number;
  isPublic: boolean;
  nameRaw: string;
  highSchoolId: string | null;
  possibility: number | null;
  unjudged: boolean;
}

/**
 * 生徒の模試の志望校を全件取る（模試ごとの並べ替えは呼び出し側で assessments と突き合わせる）。
 * ★1回の模試で最大5行、年に10回受けても50行。PostgREST の1000行の切り捨ては気にしなくてよい。
 */
export async function getStudentMockSchools(studentId: string): Promise<MockSchoolRecord[]> {
  const { data, error } = await supabase
    .from('assessment_target_schools')
    .select('*')
    .eq('student_id', studentId)
    .order('slot', { ascending: true });

  if (error) {
    throw new Error(`模試の志望校の取得に失敗しました: ${error.message}`);
  }
  return ((data || []) as AssessmentTargetSchoolDbRow[]).map((r) => ({
    assessmentId: r.assessment_id,
    slot: r.slot,
    isPublic: r.is_public,
    nameRaw: r.school_name_raw,
    highSchoolId: r.high_school_id,
    possibility: r.possibility,
    unjudged: r.possibility_unjudged,
  }));
}

/**
 * 高校マスタを学校名の完全一致でまとめて引く（模試の志望校の当てに使う）。
 * ★全件は読まない。取り込む模試に出てきた名前だけを in で引く（数十校）。
 */
export async function getHighSchoolKeysByNames(names: string[]): Promise<HighSchoolKeyRow[]> {
  // ★名前は normalizeText で「ケ」→「ヶ」にそろえてある。マスタ側がどちらで書いていても
  //   引けるよう、両方の表記で引く（当ての突き合わせは matchMockSchoolName が両側をそろえて行う）
  const unique = Array.from(
    new Set(names.filter(Boolean).flatMap((n) => [n, n.replace(/ヶ/g, 'ケ')]))
  );
  if (unique.length === 0) return [];
  const { data, error } = await supabase
    .from('high_schools')
    .select('id, prefecture, school_name, course')
    .in('school_name', unique);
  if (error) {
    throw new Error(`高校マスタの取得に失敗しました: ${error.message}`);
  }
  return (data || []) as HighSchoolKeyRow[];
}

/**
 * 生徒ごとの志望校（student_target_schools）の登録件数。
 * ★取り込みのプレビューで「志望校が入る生徒の数」を出すのに使う。
 * ★id を100件ずつに分けて引く（1人最大3行なので1回300行以内。1000行の切り捨てに掛からない）。
 */
export async function countTargetSchoolsByStudents(
  studentIds: string[]
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const ids = Array.from(new Set(studentIds));
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const { data, error } = await supabase
      .from('student_target_schools')
      .select('student_id')
      .in('student_id', chunk);
    if (error) {
      throw new Error(`志望校の件数の取得に失敗しました: ${error.message}`);
    }
    for (const row of (data || []) as { student_id: string }[]) {
      counts.set(row.student_id, (counts.get(row.student_id) ?? 0) + 1);
    }
  }
  return counts;
}

/** 取り込む1枠と、マスタに当てた結果 */
export interface MockSchoolToSave extends MockSchoolChoice {
  highSchoolId: string | null;
  /** マスタの学校名（当たらなければ模試の学校名）。志望校の自動登録に使う */
  schoolName: string;
}

/** 模試1回ぶんの志望校を保存する */
export async function insertAssessmentTargetSchools(
  assessmentId: string,
  studentId: string,
  schoolId: string,
  schools: MockSchoolToSave[]
): Promise<void> {
  if (schools.length === 0) return;
  const rows = schools.map((s) => ({
    assessment_id: assessmentId,
    student_id: studentId,
    // ★トリガーが生徒の所属校で上書きする。ここでは形だけ渡す
    school_id: schoolId,
    slot: s.slot,
    is_public: s.isPublic,
    school_name_raw: s.nameRaw,
    high_school_id: s.highSchoolId,
    possibility: s.possibility,
    possibility_unjudged: s.unjudged,
  }));
  const { error } = await supabase.from('assessment_target_schools').insert(rows);
  if (error) {
    throw new Error(`模試の志望校の保存に失敗しました: ${error.message}`);
  }
}

/**
 * 志望校が1件も無い生徒に、模試の公立の志望校を第1〜3志望として入れる。
 *
 * ★既にある志望校は決して上書きしない。直前にもう一度件数を数え、1件でもあれば何もしない
 *  （プレビューを開いてから取り込むまでの間に、面談画面で誰かが入れたかもしれない）。
 * ★順位は模試の枠の順（空き枠を詰めて 1..n）。理由（reason）は空のまま。
 *   模試の欄は「志望の理由」を持たないので、面談で聞いて入れてもらう。
 * @returns 入れた件数（何もしなければ 0）
 */
export async function fillTargetSchoolsFromMock(
  studentId: string,
  schoolId: string,
  publicSchools: MockSchoolToSave[]
): Promise<number> {
  const picks = publicSchools
    .filter((s) => s.isPublic)
    .sort((a, b) => a.slot - b.slot)
    .slice(0, 3);
  if (picks.length === 0) return 0;

  const existing = await countTargetSchoolsByStudents([studentId]);
  if ((existing.get(studentId) ?? 0) > 0) return 0;

  const rows = picks.map((s, i) => ({
    student_id: studentId,
    school_id: schoolId,
    rank: i + 1,
    school_name: s.schoolName,
    high_school_id: s.highSchoolId,
    reason: null,
  }));
  const { error } = await supabase.from('student_target_schools').insert(rows);
  if (error) {
    throw new Error(`志望校の登録に失敗しました: ${error.message}`);
  }
  return rows.length;
}
