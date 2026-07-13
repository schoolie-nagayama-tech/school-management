// P2改訂（2026-07-13）: 授業追加の「未消化プール」CRUD。
//
// schedule_pending_lessons テーブル（対象者×科目×種別 → 残コマ数）を扱う。
// 「授業を追加」でコマ数を指定して配置した途中で「完了」した場合、残数をここへ退避し、
// 後から「配置」で再開する（振替の保留プールと並ぶ導線）。配置ごとに残数を1減らし、0で削除。
//
// マイグレ 20260713_schedule_pending_lessons.sql の適用が前提。未適用でも他機能を壊さないよう、
// 取得系はエラーを握りつぶして空配列を返す（テーブル未作成時に座席表全体が落ちないため）。

import { supabase } from '@/lib/supabase';
import type { HalfPosition } from '@/types/schedule';

// 座席表系テーブルと同じく Database 型未追加のため any でクエリ
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface PendingLesson {
  id: string;
  school_id: string;
  student_id: string | null;
  inquiry_id: string | null;
  subject_id: string;
  kind: 'additional' | 'trial';
  ratio: 1 | 2;
  duration_minutes: number | null;
  half_position: HalfPosition;
  remaining_count: number;
  created_at: string;
  updated_at: string;
  // join（表示用・任意）
  student?: { id: string; last_name: string; first_name: string; grade: number } | null;
  inquiry?: { id: string; student_name: string | null; grade: string | null } | null;
}

/** プール新規作成の入力。 */
export interface CreatePendingLessonInput {
  schoolId: string;
  studentId: string | null;
  inquiryId: string | null;
  subjectId: string;
  kind: 'additional' | 'trial';
  ratio: 1 | 2;
  durationMinutes: number | null;
  halfPosition: HalfPosition;
  remainingCount: number;
}

/**
 * 学校群の未消化プールを全件取得（生徒・見込み客名を join）。
 * テーブル未適用など取得失敗時は空配列（座席表を落とさない）。
 */
export async function getPendingLessons(schoolIds: string[]): Promise<PendingLesson[]> {
  if (schoolIds.length === 0) return [];
  const { data, error } = await db
    .from('schedule_pending_lessons')
    .select(
      '*, student:students(id, last_name, first_name, grade), inquiry:inquiries(id, student_name, grade)'
    )
    .in('school_id', schoolIds)
    .order('created_at', { ascending: true });
  if (error) {
    // マイグレ未適用（テーブル無し）でも他機能を壊さない。
    console.warn('Failed to load pending lessons (table may not be migrated yet):', error);
    return [];
  }
  type Row = Omit<PendingLesson, 'student' | 'inquiry'> & {
    student?: PendingLesson['student'] | PendingLesson['student'][];
    inquiry?: PendingLesson['inquiry'] | PendingLesson['inquiry'][];
  };
  return ((data ?? []) as Row[]).map((r) => ({
    ...r,
    ratio: r.ratio === 1 ? 1 : 2,
    student: Array.isArray(r.student) ? r.student[0] : r.student,
    inquiry: Array.isArray(r.inquiry) ? r.inquiry[0] : r.inquiry,
  })) as PendingLesson[];
}

/** プールに1行作成（残コマ数 remainingCount）。 */
export async function createPendingLesson(input: CreatePendingLessonInput): Promise<void> {
  const { error } = await db.from('schedule_pending_lessons').insert({
    school_id: input.schoolId,
    student_id: input.studentId,
    inquiry_id: input.inquiryId,
    subject_id: input.subjectId,
    kind: input.kind,
    ratio: input.ratio,
    duration_minutes: input.durationMinutes,
    half_position: input.halfPosition,
    remaining_count: input.remainingCount,
  });
  if (error) {
    console.error('Error creating pending lesson:', error);
    throw new Error('未消化プールへの退避に失敗しました');
  }
}

/**
 * 1コマ配置したぶん残数を1減らす。残数が1（＝これが最後）なら行を削除する。
 * @returns 削除したら true（プールから消えた）、まだ残っていれば false。
 */
export async function decrementPendingLesson(id: string): Promise<boolean> {
  const { data, error } = await db
    .from('schedule_pending_lessons')
    .select('remaining_count')
    .eq('id', id)
    .single();
  if (error || !data) {
    console.error('Error fetching pending lesson for decrement:', error);
    throw new Error('未消化プールの更新に失敗しました');
  }
  const remaining = (data as { remaining_count: number }).remaining_count;
  if (remaining <= 1) {
    await deletePendingLesson(id);
    return true;
  }
  const { error: updateErr } = await db
    .from('schedule_pending_lessons')
    .update({ remaining_count: remaining - 1, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (updateErr) {
    console.error('Error decrementing pending lesson:', updateErr);
    throw new Error('未消化プールの更新に失敗しました');
  }
  return false;
}

/** プール行を削除（「削除」ボタン）。 */
export async function deletePendingLesson(id: string): Promise<void> {
  const { error } = await db.from('schedule_pending_lessons').delete().eq('id', id);
  if (error) {
    console.error('Error deleting pending lesson:', error);
    throw new Error('未消化プールの削除に失敗しました');
  }
}
