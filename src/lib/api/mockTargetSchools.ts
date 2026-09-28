import { supabase } from '../supabase';
import type { Database } from '@/types/database';
import type { HighSchoolKeyRow, MockSchoolChoice } from '@/lib/scores/mockSchools';
import type { CurrentTargetRow, PlannedTargetRow } from '@/lib/scores/mockTargetPlan';

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
    .select('id, prefecture, school_name, course, establishment')
    .in('school_name', unique);
  if (error) {
    throw new Error(`高校マスタの取得に失敗しました: ${error.message}`);
  }
  return (data || []) as HighSchoolKeyRow[];
}

/**
 * 生徒ごとのいまの志望校（student_target_schools）。取り込みのプレビューで前後を見せるのに使う。
 * ★id を100件ずつに分けて引く（1人最大5行なので1回500行以内。1000行の切り捨てに掛からない）。
 */
export async function getTargetSchoolsByStudents(
  studentIds: string[]
): Promise<Map<string, CurrentTargetRow[]>> {
  const byStudent = new Map<string, CurrentTargetRow[]>();
  const ids = Array.from(new Set(studentIds));
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const { data, error } = await supabase
      .from('student_target_schools')
      .select(
        'student_id, rank, school_name, high_school_id, reason, is_heigan, source_assessment_id, updated_at'
      )
      .in('student_id', chunk);
    if (error) {
      throw new Error(`志望校の取得に失敗しました: ${error.message}`);
    }
    for (const r of (data || []) as TargetDbRow[]) {
      const list = byStudent.get(r.student_id) ?? [];
      list.push(toCurrentRow(r));
      byStudent.set(r.student_id, list);
    }
  }
  return byStudent;
}

type TargetDbRow = Pick<
  Database['public']['Tables']['student_target_schools']['Row'],
  | 'student_id'
  | 'rank'
  | 'school_name'
  | 'high_school_id'
  | 'reason'
  | 'is_heigan'
  | 'source_assessment_id'
  | 'updated_at'
>;

function toCurrentRow(r: TargetDbRow): CurrentTargetRow {
  return {
    rank: r.rank,
    schoolName: r.school_name,
    highSchoolId: r.high_school_id,
    reason: r.reason,
    isHeigan: r.is_heigan ?? false,
    sourceAssessmentId: r.source_assessment_id ?? null,
    updatedAt: r.updated_at,
  };
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
 * 取り込み画面で「反映する」にした生徒の志望校を、模試の志望校に置き換える。
 *
 * ★プレビューを開いてから取り込むまでの間に、面談画面で誰かが志望校を直したかもしれない。
 *   直前に読み直し、プレビューで見せた行と1つでも違えば何もしない（'conflict'）。
 *   見せていない変更を黙って消さないため。
 * ★先に 1..n を upsert してから n より後ろを消す。先に全部消すと、途中で失敗したときに
 *   志望校が空になる。
 * @returns 'applied'＝置き換えた／'conflict'＝途中で直されていたので触らなかった
 */
export async function applyMockTargetSchools(
  studentId: string,
  schoolId: string,
  assessmentId: string,
  rows: PlannedTargetRow[],
  shownCurrent: readonly CurrentTargetRow[]
): Promise<'applied' | 'conflict'> {
  const latest = (await getTargetSchoolsByStudents([studentId])).get(studentId) ?? [];
  const key = (list: readonly CurrentTargetRow[]) =>
    [...list]
      .sort((a, b) => a.rank - b.rank)
      .map((r) => `${r.rank}|${r.schoolName}|${r.updatedAt}`)
      .join('/');
  if (key(latest) !== key(shownCurrent)) return 'conflict';

  if (rows.length > 0) {
    const { error } = await supabase.from('student_target_schools').upsert(
      rows.map((r) => ({
        student_id: studentId,
        // ★トリガーが生徒の所属校で上書きする。ここでは形だけ渡す
        school_id: schoolId,
        rank: r.rank,
        school_name: r.schoolName,
        high_school_id: r.highSchoolId,
        reason: r.reason,
        is_heigan: r.isHeigan,
        source_assessment_id: assessmentId,
      })),
      { onConflict: 'student_id,rank' }
    );
    if (error) {
      throw new Error(`志望校の登録に失敗しました: ${error.message}`);
    }
  }
  const { error } = await supabase
    .from('student_target_schools')
    .delete()
    .eq('student_id', studentId)
    .gt('rank', rows.length);
  if (error) {
    throw new Error(`志望校の整理に失敗しました: ${error.message}`);
  }
  return 'applied';
}
