/**
 * 講師の欠勤（コマ単位）API
 *
 * teacher_absences テーブルの CRUD。
 * 「この講師のこの日のこのコマは欠勤」を記録し、座席表で講師カードを欠勤表示にする。
 * 生徒の再配置は行わない（室長が手動で振替・再割当を判断する想定）。
 */

import { supabase } from '@/lib/supabase';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface TeacherAbsence {
  id: string;
  school_id: string;
  user_id: string;
  absence_date: string; // YYYY-MM-DD
  time_slot_id: string;
  reason: string | null;
  created_by: string | null;
  created_at: string;
}

/** 欠勤マップのキー: `${date}|${timeSlotId}|${userId}` */
export function absenceKey(date: string, timeSlotId: string, userId: string): string {
  return `${date}|${timeSlotId}|${userId}`;
}

/**
 * 指定期間の欠勤を取得し、高速参照用の Set（キー）と詳細 Map を返す。
 * 座席表は keySet.has(absenceKey(...)) で O(1) 判定する。
 */
export async function getTeacherAbsences(
  schoolId: string,
  fromDate: string,
  toDate: string
): Promise<{ keySet: Set<string>; byKey: Map<string, TeacherAbsence> }> {
  const { data } = await db
    .from('teacher_absences')
    .select('*')
    .eq('school_id', schoolId)
    .gte('absence_date', fromDate)
    .lte('absence_date', toDate);

  const keySet = new Set<string>();
  const byKey = new Map<string, TeacherAbsence>();
  for (const a of (data ?? []) as TeacherAbsence[]) {
    const k = absenceKey(a.absence_date, a.time_slot_id, a.user_id);
    keySet.add(k);
    byKey.set(k, a);
  }
  return { keySet, byKey };
}

/** 欠勤マーク（コマ単位）。既にあれば何もしない（UNIQUE 衝突は無視）。 */
export async function markTeacherAbsent(input: {
  schoolId: string;
  userId: string;
  date: string;
  timeSlotId: string;
  reason?: string | null;
  createdBy?: string | null;
}): Promise<void> {
  const { error } = await db.from('teacher_absences').insert({
    school_id: input.schoolId,
    user_id: input.userId,
    absence_date: input.date,
    time_slot_id: input.timeSlotId,
    reason: input.reason ?? null,
    created_by: input.createdBy ?? null,
  });
  // 23505 = UNIQUE 違反（既に欠勤登録済み）→ 冪等扱いで無視
  if (error && error.code !== '23505') {
    throw new Error(`欠勤の登録に失敗しました: ${error.message}`);
  }
}

/** 欠勤解除（出勤に戻す） */
export async function unmarkTeacherAbsent(
  userId: string,
  date: string,
  timeSlotId: string
): Promise<void> {
  const { error } = await db
    .from('teacher_absences')
    .delete()
    .eq('user_id', userId)
    .eq('absence_date', date)
    .eq('time_slot_id', timeSlotId);
  if (error) throw new Error(`欠勤の解除に失敗しました: ${error.message}`);
}
