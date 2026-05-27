/**
 * 担当変更履歴ログ API (schedule_change_logs)
 *
 * 通塾日程パターンや座席表エントリの teacher_id 変更、振替、削除等を時系列で記録する。
 * 監査・問合せ対応・運用デバッグに使う「読み取り中心」のテーブル。
 *
 * 書き込み:
 *  - 各操作 (assignTeacherToPattern / updateScheduleEntry / createTransferEntry など)
 *    の確定タイミングで logScheduleChange を呼ぶ
 *  - 失敗してもメイン操作は失敗扱いにしない（catch して warn ログのみ）
 *
 * 読み取り:
 *  - 学校全体: getScheduleChangeLogs(schoolId, filter)
 *  - 生徒詳細用: 同 API で student_id 絞り
 *  - 講師詳細用: before/after_teacher_id の OR で絞り
 */

import { supabase } from '@/lib/supabase';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export type ScheduleChangeAction =
  | 'pattern_assign'
  | 'pattern_unassign'
  | 'entry_assign'
  | 'entry_reassign'
  | 'transfer_create'
  | 'transfer_revert'
  | 'entry_remove';

export interface ScheduleChangeLog {
  id: string;
  school_id: string;
  actor_user_id: string | null;
  action_type: ScheduleChangeAction;
  pattern_id: string | null;
  entry_id: string | null;
  student_id: string | null;
  before_teacher_id: string | null;
  after_teacher_id: string | null;
  description: string | null;
  affected_date: string | null;
  affected_slot_id: string | null;
  created_at: string;
  // join (オプション)
  actor?: { id: string; display_name: string | null; email: string | null } | null;
  student?: { id: string; last_name: string; first_name: string } | null;
  before_teacher?: { id: string; display_name: string | null } | null;
  after_teacher?: { id: string; display_name: string | null } | null;
}

export interface LogScheduleChangeInput {
  school_id: string;
  actor_user_id?: string | null;
  action_type: ScheduleChangeAction;
  pattern_id?: string | null;
  entry_id?: string | null;
  student_id?: string | null;
  before_teacher_id?: string | null;
  after_teacher_id?: string | null;
  description?: string | null;
  affected_date?: string | null;
  affected_slot_id?: string | null;
}

/**
 * 1件記録する。失敗時は warn ログのみ（throw しない）。
 * 呼び出し側のメイン処理を巻き添えで失敗させないため。
 */
export async function logScheduleChange(input: LogScheduleChangeInput): Promise<void> {
  try {
    const { error } = await db.from('schedule_change_logs').insert({
      school_id: input.school_id,
      actor_user_id: input.actor_user_id ?? null,
      action_type: input.action_type,
      pattern_id: input.pattern_id ?? null,
      entry_id: input.entry_id ?? null,
      student_id: input.student_id ?? null,
      before_teacher_id: input.before_teacher_id ?? null,
      after_teacher_id: input.after_teacher_id ?? null,
      description: input.description ?? null,
      affected_date: input.affected_date ?? null,
      affected_slot_id: input.affected_slot_id ?? null,
    });
    if (error) console.warn('[schedule-change-log] insert failed:', error.message);
  } catch (e) {
    console.warn('[schedule-change-log] insert exception:', e);
  }
}

export interface ScheduleChangeLogsFilter {
  schoolId: string;
  studentId?: string;
  /** before_teacher_id or after_teacher_id どちらかが一致 */
  teacherId?: string;
  fromDate?: string;
  toDate?: string;
  actionTypes?: ScheduleChangeAction[];
  limit?: number;
}

/**
 * 履歴を時系列降順で取得する。
 * actor / student / before_teacher / after_teacher の join 込み。
 */
export async function getScheduleChangeLogs(
  filter: ScheduleChangeLogsFilter
): Promise<ScheduleChangeLog[]> {
  const limit = filter.limit ?? 200;

  let query = db
    .from('schedule_change_logs')
    .select(
      [
        '*',
        'actor:user_profiles!schedule_change_logs_actor_user_id_fkey(id, display_name, email)',
        'student:students(id, last_name, first_name)',
        'before_teacher:user_profiles!schedule_change_logs_before_teacher_id_fkey(id, display_name)',
        'after_teacher:user_profiles!schedule_change_logs_after_teacher_id_fkey(id, display_name)',
      ].join(', ')
    )
    .eq('school_id', filter.schoolId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (filter.studentId) query = query.eq('student_id', filter.studentId);
  if (filter.teacherId) {
    query = query.or(
      `before_teacher_id.eq.${filter.teacherId},after_teacher_id.eq.${filter.teacherId}`
    );
  }
  if (filter.fromDate) query = query.gte('created_at', filter.fromDate);
  if (filter.toDate) query = query.lte('created_at', filter.toDate);
  if (filter.actionTypes && filter.actionTypes.length > 0) {
    query = query.in('action_type', filter.actionTypes);
  }

  const { data, error } = await query;
  if (error) {
    // join 失敗時は join を諦めて素のデータだけ返す（FK が未確立のケース対策）
    console.warn('[schedule-change-log] fetch with joins failed, fallback:', error.message);
    const { data: plain } = await db
      .from('schedule_change_logs')
      .select('*')
      .eq('school_id', filter.schoolId)
      .order('created_at', { ascending: false })
      .limit(limit);
    return (plain ?? []) as ScheduleChangeLog[];
  }
  return (data ?? []) as ScheduleChangeLog[];
}

/** action_type → 日本語ラベル */
export function actionLabel(action: ScheduleChangeAction): string {
  switch (action) {
    case 'pattern_assign':
      return '通塾日程に講師を割当';
    case 'pattern_unassign':
      return '通塾日程の講師を解除';
    case 'entry_assign':
      return 'このコマだけ講師を割当';
    case 'entry_reassign':
      return '担当講師を変更';
    case 'transfer_create':
      return '振替を作成';
    case 'transfer_revert':
      return '振替を取消';
    case 'entry_remove':
      return 'コマを削除';
    default:
      return action;
  }
}
