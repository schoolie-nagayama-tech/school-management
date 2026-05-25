import { supabase } from '@/lib/supabase';
import type {
  ScheduleTimeSlot,
  ScheduleTimeSlotFormData,
  ScheduleClosedDay,
  ScheduleClosedDayFormData,
  ScheduleRegularPattern,
  ScheduleRegularPatternFormData,
  ScheduleEntry,
  ScheduleEntryFormData,
  ScheduleEntryFormation,
  ScheduleGenerationResult,
  TimeConflictResult,
} from '@/types/schedule';

// 座席表テーブルは Database 型に未定義のため、any でクエリ
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/** teacherロール以外は授業登録不可。teacher_id が user_profiles で role='teacher' であることを確認 */
async function ensureUserIsTeacher(teacherId: string): Promise<void> {
  const { data, error } = await db
    .from('user_profiles')
    .select('role')
    .eq('id', teacherId)
    .single();
  if (error || !data) {
    throw new Error('講師の確認に失敗しました');
  }
  const role = String((data as { role?: string }).role ?? '').toLowerCase();
  if (role !== 'teacher') {
    throw new Error('授業を担当できるのは講師ロールのユーザーのみです');
  }
}

// ========================================
// コマ時間マスタ
// ========================================

/**
 * コマ時間を取得。formation を指定すれば該当形態のみ、未指定なら全件。
 * 既存呼び出しは全件を期待しているので互換性のため formation は optional に。
 */
export async function getTimeSlots(
  schoolId: string,
  formation?: ScheduleEntryFormation
): Promise<ScheduleTimeSlot[]> {
  let q = db.from('schedule_time_slots').select('*').eq('school_id', schoolId);
  if (formation) q = q.eq('formation', formation);
  const { data, error } = await q
    .order('formation', { ascending: true })
    .order('slot_number', { ascending: true })
    .order('display_order', { ascending: true });

  if (error) {
    console.error('Error fetching time slots:', error);
    throw new Error('コマ時間の取得に失敗しました');
  }
  return (data || []) as ScheduleTimeSlot[];
}

export async function getActiveTimeSlots(
  schoolId: string,
  formation?: ScheduleEntryFormation
): Promise<ScheduleTimeSlot[]> {
  let q = db
    .from('schedule_time_slots')
    .select('*')
    .eq('school_id', schoolId)
    .eq('is_active', true);
  if (formation) q = q.eq('formation', formation);
  const { data, error } = await q
    .order('formation', { ascending: true })
    .order('slot_number', { ascending: true })
    .order('display_order', { ascending: true });

  if (error) {
    console.error('Error fetching active time slots:', error);
    throw new Error('コマ時間の取得に失敗しました');
  }
  return (data || []) as ScheduleTimeSlot[];
}

export async function getTimeSlotById(id: string): Promise<ScheduleTimeSlot | null> {
  const { data, error } = await db
    .from('schedule_time_slots')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error('Error fetching time slot:', error);
    throw new Error('コマ時間の取得に失敗しました');
  }
  return (data as ScheduleTimeSlot) ?? null;
}

/** IDの配列順に slot_number を 1,2,3... に振り直す */
export async function reorderTimeSlots(schoolId: string, orderedIds: string[]): Promise<void> {
  const { error } = await db.rpc('reorder_time_slots', {
    p_school_id: schoolId,
    p_ordered_ids: orderedIds,
  });
  if (error) {
    console.error('Error reordering time slots:', error);
    throw new Error('コマ番号の並び替えに失敗しました');
  }
}

export async function createTimeSlot(
  schoolId: string,
  form: ScheduleTimeSlotFormData
): Promise<ScheduleTimeSlot> {
  const { data, error } = await db
    .from('schedule_time_slots')
    .insert({
      school_id: schoolId,
      slot_number: form.slot_number,
      start_time: form.start_time,
      end_time: form.end_time,
      is_active: form.is_active,
      display_order: form.display_order,
      // 形態：未指定は個別（既存マスタとの互換）。集団用は明示的に渡す。
      formation: form.formation ?? 'individual',
    })
    .select()
    .single();

  if (error) {
    console.error('Error creating time slot:', error);
    throw new Error('コマ時間の登録に失敗しました');
  }
  return data as ScheduleTimeSlot;
}

export async function updateTimeSlot(
  id: string,
  form: Partial<ScheduleTimeSlotFormData>
): Promise<ScheduleTimeSlot> {
  const { data, error } = await db
    .from('schedule_time_slots')
    .update(form)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('Error updating time slot:', error);
    throw new Error('コマ時間の更新に失敗しました');
  }
  return data as ScheduleTimeSlot;
}

export async function deleteTimeSlot(id: string, _schoolId: string): Promise<void> {
  const { error } = await db.from('schedule_time_slots').delete().eq('id', id);
  if (error) {
    console.error('Error deleting time slot:', error);
    throw new Error('コマ時間の削除に失敗しました。使用中の場合は削除できません。');
  }
}

/** コマ時間が通塾日程またはスケジュールで使用されているか */
export async function isTimeSlotInUse(timeSlotId: string): Promise<boolean> {
  const [p, e] = await Promise.all([
    db.from('schedule_regular_patterns').select('id').eq('time_slot_id', timeSlotId).limit(1),
    db.from('schedule_entries').select('id').eq('time_slot_id', timeSlotId).limit(1),
  ]);
  return (p.data?.length ?? 0) > 0 || (e.data?.length ?? 0) > 0;
}

// ========================================
// 休講日
// ========================================

export async function getClosedDays(
  schoolId: string | null,
  options?: { from?: string; to?: string }
): Promise<ScheduleClosedDay[]> {
  let query = db.from('schedule_closed_days').select('*');

  if (schoolId === null) {
    query = query.is('school_id', null);
  } else {
    query = query.or(`school_id.eq.${schoolId},school_id.is.null`);
  }

  if (options?.from) {
    query = query.gte('closed_date', options.from);
  }
  if (options?.to) {
    query = query.lte('closed_date', options.to);
  }
  query = query.order('closed_date', { ascending: true });

  const { data, error } = await query;
  if (error) {
    console.error('Error fetching closed days:', error);
    throw new Error('休講日の取得に失敗しました');
  }
  return (data || []) as ScheduleClosedDay[];
}

export async function createClosedDay(
  schoolId: string | null,
  form: ScheduleClosedDayFormData
): Promise<ScheduleClosedDay> {
  const { data, error } = await db
    .from('schedule_closed_days')
    .insert({
      school_id: form.is_global ? null : schoolId,
      closed_date: form.closed_date,
      reason: form.reason || null,
      is_global: form.is_global,
    })
    .select()
    .single();

  if (error) {
    console.error('Error creating closed day:', error);
    throw new Error('休講日の登録に失敗しました');
  }
  return data as ScheduleClosedDay;
}

export async function deleteClosedDay(id: string): Promise<void> {
  const { error } = await db.from('schedule_closed_days').delete().eq('id', id);
  if (error) {
    console.error('Error deleting closed day:', error);
    throw new Error('休講日の削除に失敗しました');
  }
}

// ========================================
// 時間重複チェック
// ========================================

/** 時間帯が重複するか（endA > startB && endB > startA） */
function timeRangesOverlap(
  startA: string,
  endA: string,
  startB: string,
  endB: string
): boolean {
  const sA = startA.slice(0, 8);
  const eA = endA.slice(0, 8);
  const sB = startB.slice(0, 8);
  const eB = endB.slice(0, 8);
  return eA > sB && eB > sA;
}

/**
 * 生徒の時間重複をチェック
 * @returns 重複がある場合は重複情報、なければ null
 */
export async function checkStudentTimeConflict(
  studentId: string,
  dayOfWeek: number,
  startTime: string,
  endTime: string,
  options?: {
    excludeRegularPatternId?: string;
    excludeScheduleEntryId?: string;
    specificDate?: string;
  }
): Promise<TimeConflictResult | null> {
  const excludePatternId = options?.excludeRegularPatternId;
  const excludeEntryId = options?.excludeScheduleEntryId;
  const specificDate = options?.specificDate;

  if (specificDate) {
    // 特定日の schedule_entries をチェック
    const { data: entries, error } = await db
      .from('schedule_entries')
      .select(
        'id, entry_date, time_slot_id, teacher_id, subject_ids, time_slot:schedule_time_slots(start_time, end_time), teacher:user_profiles(display_name, email)'
      )
      .eq('student_id', studentId)
      .eq('entry_date', specificDate)
      .in('status', ['scheduled', 'completed', 'transferred_in']);

    if (error || !entries?.length) return null;

    const timeSlotsMap = new Map<string, { start_time: string; end_time: string }>();
    const teachersMap = new Map<string, string>();

    for (const row of entries as (ScheduleEntry & {
      time_slot?: { start_time: string; end_time: string }[] | { start_time: string; end_time: string };
      teacher?: { display_name: string | null; email: string | null }[] | { display_name: string | null; email: string | null };
    })[]) {
      if (row.id === excludeEntryId) continue;
      const slot = Array.isArray(row.time_slot) ? row.time_slot[0] : row.time_slot;
      const teacher = Array.isArray(row.teacher) ? row.teacher[0] : row.teacher;
      if (slot) {
        timeSlotsMap.set(row.time_slot_id, slot);
        if (teacher)
          teachersMap.set(row.teacher_id, teacher.display_name || teacher.email || '—');
      }
    }

    for (const row of entries as (ScheduleEntry & {
      time_slot?: { start_time: string; end_time: string }[] | { start_time: string; end_time: string };
    })[]) {
      if (row.id === excludeEntryId) continue;
      const slot = timeSlotsMap.get(row.time_slot_id);
      if (!slot) continue;
      const st = slot.start_time ?? '';
      const et = slot.end_time ?? '';
      if (timeRangesOverlap(startTime, endTime, st, et)) {
        const teacherName = teachersMap.get(row.teacher_id) ?? '—';
        const subjectName = (row.subject_ids?.length ? '科目' : '—') as string;
        return {
          type: 'schedule_entry',
          conflictWith: {
            id: row.id,
            date: row.entry_date,
            startTime: st,
            endTime: et,
            teacherName,
            subjectName,
          },
          message: `${specificDate} ${st.slice(0, 5)}-${et.slice(0, 5)}（${teacherName}）と重複しています`,
        };
      }
    }
    return null;
  }

  // 通常授業パターンをチェック（同じ曜日）
  const { data: patternRows, error: patError } = await db
    .from('schedule_regular_patterns')
    .select(
      'id, day_of_week, time_slot_id, teacher_id, time_slot:schedule_time_slots(start_time, end_time), teacher:user_profiles(display_name, email)'
    )
    .eq('student_id', studentId)
    .eq('day_of_week', dayOfWeek)
    .eq('is_active', true);

  if (patError || !patternRows?.length) return null;

  const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];
  const dayLabel = DAY_NAMES[dayOfWeek] ?? '';

  for (const row of patternRows as {
    id: string;
    day_of_week: number;
    time_slot_id: string;
    teacher_id: string;
    time_slot?: { start_time: string; end_time: string }[] | { start_time: string; end_time: string };
    teacher?: { display_name: string | null; email: string | null }[] | { display_name: string | null; email: string | null };
  }[]) {
    if (row.id === excludePatternId) continue;
    const slot = Array.isArray(row.time_slot) ? row.time_slot[0] : row.time_slot;
    const teacher = Array.isArray(row.teacher) ? row.teacher[0] : row.teacher;
    if (!slot) continue;
    const st = slot.start_time ?? '';
    const et = slot.end_time ?? '';
    if (timeRangesOverlap(startTime, endTime, st, et)) {
      const teacherName = teacher?.display_name || teacher?.email || '—';
      return {
        type: 'regular_pattern',
        conflictWith: {
          id: row.id,
          dayOfWeek: row.day_of_week,
          startTime: st,
          endTime: et,
          teacherName,
          subjectName: '科目',
        },
        message: `${dayLabel}曜 ${st.slice(0, 5)}-${et.slice(0, 5)}（${teacherName}）と重複しています`,
      };
    }
  }
  return null;
}

// ========================================
// 通塾日程（通常授業パターン）
// ========================================

/**
 * 通塾日程を取得
 *
 * filters.asOfDate を指定すると「その日時点で有効なパターン」のみ取得する
 *  - effective_from <= asOfDate
 *  - effective_until IS NULL OR effective_until >= asOfDate
 * 指定しない場合は is_active=true 全件（UI 編集用、過去・未来予約も含めて見える）
 */
export async function getRegularPatterns(
  schoolId: string,
  filters?: { studentId?: string; dayOfWeek?: number; periodType?: string; asOfDate?: string }
): Promise<ScheduleRegularPattern[]> {
  let query = db
    .from('schedule_regular_patterns')
    .select(
      `
      *,
      time_slot:schedule_time_slots(*),
      student:students(id, last_name, first_name, grade),
      teacher:user_profiles(id, display_name, email)
    `
    )
    .eq('school_id', schoolId)
    .eq('is_active', true);

  if (filters?.studentId) query = query.eq('student_id', filters.studentId);
  if (filters?.dayOfWeek !== undefined) query = query.eq('day_of_week', filters.dayOfWeek);
  if (filters?.periodType) query = query.eq('period_type', filters.periodType);
  if (filters?.asOfDate) {
    // effective_from <= asOfDate AND (effective_until IS NULL OR effective_until >= asOfDate)
    query = query
      .lte('effective_from', filters.asOfDate)
      .or(`effective_until.is.null,effective_until.gte.${filters.asOfDate}`);
  }

  query = query.order('day_of_week').order('time_slot_id');

  const { data, error } = await query;
  if (error) {
    console.error('Error fetching regular patterns:', error);
    throw new Error('通塾日程の取得に失敗しました');
  }

  const rows = (data || []) as (ScheduleRegularPattern & {
    time_slot?: ScheduleTimeSlot[];
    student?: { id: string; last_name: string; first_name: string; grade: number }[];
    teacher?: { id: string; display_name: string | null; email: string | null }[];
  })[];
  return rows.map((r) => ({
    ...r,
    time_slot: Array.isArray(r.time_slot) ? r.time_slot[0] : r.time_slot,
    student: Array.isArray(r.student) ? r.student[0] : r.student,
    teacher: Array.isArray(r.teacher) ? r.teacher[0] : r.teacher,
  })) as ScheduleRegularPattern[];
}

export async function createRegularPattern(
  schoolId: string,
  form: ScheduleRegularPatternFormData
): Promise<ScheduleRegularPattern> {
  if (form.teacher_id) {
    await ensureUserIsTeacher(form.teacher_id);
  }
  const timeSlot = await getTimeSlotById(form.time_slot_id);
  if (timeSlot) {
    const conflict = await checkStudentTimeConflict(
      form.student_id,
      form.day_of_week,
      timeSlot.start_time,
      timeSlot.end_time
    );
    if (conflict) throw new Error(conflict.message);
  }

  const { data, error } = await db
    .from('schedule_regular_patterns')
    .insert({
      school_id: schoolId,
      student_id: form.student_id,
      day_of_week: form.day_of_week,
      time_slot_id: form.time_slot_id,
      teacher_id: form.teacher_id,
      subject_ids: form.subject_ids || [],
      seat_label: form.seat_label || null,
      period_type: form.period_type,
      is_active: true,
      effective_from: form.effective_from || todayStr(),
      effective_until: form.effective_until ?? null,
      // 形態：未指定は個別。集団パターンを作るときは form.formation='group' を渡す。
      formation: form.formation ?? 'individual',
    })
    .select()
    .single();

  if (error) {
    console.error('Error creating regular pattern:', error);
    throw new Error('通塾日程の登録に失敗しました');
  }
  return data as ScheduleRegularPattern;
}

/** 今日の YYYY-MM-DD（JST想定） */
function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** 指定日の前日を YYYY-MM-DD で返す */
function prevDay(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/**
 * 通塾日程を「指定日から」変更する
 *
 * 既存パターンの effective_until を変更日の前日にし、
 * 新しい設定で effective_from = 変更日 のパターンを作成する。
 * これにより、過去月の請求計算は変更前の通塾日程で計算され続ける。
 *
 * 例：週2→週3 を 2026-04-01 から
 *  - 既存の週2パターンに effective_until=2026-03-31 をセット
 *  - 新規に週3分のパターンを effective_from=2026-04-01 で作成
 */
export async function scheduleRegularPatternChangeFrom(
  patternId: string,
  fromDate: string,
  form: ScheduleRegularPatternFormData,
  schoolId: string
): Promise<ScheduleRegularPattern> {
  if (form.teacher_id) {
    await ensureUserIsTeacher(form.teacher_id);
  }

  // 1. 既存パターンに effective_until をセット（変更日の前日まで有効）
  const until = prevDay(fromDate);
  const { error: updErr } = await db
    .from('schedule_regular_patterns')
    .update({ effective_until: until })
    .eq('id', patternId);
  if (updErr) {
    console.error('Error setting effective_until on previous pattern:', updErr);
    throw new Error('既存通塾日程の終了日設定に失敗しました');
  }

  // 2. 新規パターンを effective_from=fromDate で作成
  const { data, error } = await db
    .from('schedule_regular_patterns')
    .insert({
      school_id: schoolId,
      student_id: form.student_id,
      day_of_week: form.day_of_week,
      time_slot_id: form.time_slot_id,
      teacher_id: form.teacher_id,
      subject_ids: form.subject_ids || [],
      seat_label: form.seat_label || null,
      period_type: form.period_type,
      is_active: true,
      effective_from: fromDate,
      effective_until: form.effective_until ?? null,
      // 形態：未指定なら個別。指定日から「個別→集団」や「集団→個別」へ切り替えるシナリオもありえる
      formation: form.formation ?? 'individual',
    })
    .select()
    .single();

  if (error) {
    // ロールバック：旧パターンの effective_until を null に戻す
    await db.from('schedule_regular_patterns').update({ effective_until: null }).eq('id', patternId);
    console.error('Error creating new pattern for scheduled change:', error);
    throw new Error('新しい通塾日程の登録に失敗しました');
  }
  return data as ScheduleRegularPattern;
}

/**
 * 通塾日程を「指定日で終了」させる（退塾・コマ削減の予約）
 *
 * effective_until をセットするだけ。null を渡すと予約解除（無期限化）。
 */
export async function endRegularPatternOn(
  patternId: string,
  endDate: string | null
): Promise<void> {
  const { error } = await db
    .from('schedule_regular_patterns')
    .update({ effective_until: endDate })
    .eq('id', patternId);
  if (error) {
    console.error('Error setting effective_until:', error);
    throw new Error('通塾日程の終了日設定に失敗しました');
  }
}

export async function updateRegularPattern(
  id: string,
  form: Partial<ScheduleRegularPatternFormData>
): Promise<ScheduleRegularPattern> {
  if (form.day_of_week !== undefined || form.time_slot_id !== undefined || form.student_id !== undefined) {
    const existing = await db
      .from('schedule_regular_patterns')
      .select('student_id, day_of_week, time_slot_id')
      .eq('id', id)
      .single();
    if (!existing.error && existing.data) {
      const studentId = form.student_id ?? (existing.data as { student_id: string }).student_id;
      const dayOfWeek = form.day_of_week ?? (existing.data as { day_of_week: number }).day_of_week;
      const timeSlotId = form.time_slot_id ?? (existing.data as { time_slot_id: string }).time_slot_id;
      const timeSlot = await getTimeSlotById(timeSlotId);
      if (timeSlot) {
        const conflict = await checkStudentTimeConflict(
          studentId,
          dayOfWeek,
          timeSlot.start_time,
          timeSlot.end_time,
          { excludeRegularPatternId: id }
        );
        if (conflict) throw new Error(conflict.message);
      }
    }
  }

  if (form.teacher_id !== undefined && form.teacher_id !== null) {
    await ensureUserIsTeacher(form.teacher_id);
  }
  const updatePayload: Record<string, unknown> = {};
  if (form.student_id !== undefined) updatePayload.student_id = form.student_id;
  if (form.day_of_week !== undefined) updatePayload.day_of_week = form.day_of_week;
  if (form.time_slot_id !== undefined) updatePayload.time_slot_id = form.time_slot_id;
  if (form.teacher_id !== undefined) updatePayload.teacher_id = form.teacher_id;
  if (form.subject_ids !== undefined) updatePayload.subject_ids = form.subject_ids;
  if (form.seat_label !== undefined) updatePayload.seat_label = form.seat_label || null;
  if (form.period_type !== undefined) updatePayload.period_type = form.period_type;
  if (form.effective_from !== undefined) updatePayload.effective_from = form.effective_from;
  if (form.effective_until !== undefined) updatePayload.effective_until = form.effective_until;

  const { data, error } = await db
    .from('schedule_regular_patterns')
    .update(updatePayload)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('Error updating regular pattern:', error);
    throw new Error('通塾日程の更新に失敗しました');
  }
  return data as ScheduleRegularPattern;
}

/** 論理削除（is_active = false） */
export async function deleteRegularPattern(id: string): Promise<void> {
  const { error } = await db
    .from('schedule_regular_patterns')
    .update({ is_active: false })
    .eq('id', id);

  if (error) {
    console.error('Error deleting regular pattern:', error);
    throw new Error('通塾日程の削除に失敗しました');
  }
}

/** 指定日以降の、指定通常パターンに紐づくスケジュールエントリを一括取消 */
export async function cancelFutureEntriesByRegularPatternId(
  regularPatternId: string,
  fromDate: string
): Promise<number> {
  const { data, error } = await db
    .from('schedule_entries')
    .update({ status: 'cancelled' })
    .eq('regular_pattern_id', regularPatternId)
    .gte('entry_date', fromDate)
    .in('status', ['scheduled', 'completed', 'transferred_in'])
    .select('id');

  if (error) {
    console.error('Error cancelling future entries:', error);
    throw new Error('今後の授業の取消に失敗しました');
  }
  return data?.length ?? 0;
}

// ========================================
// スケジュールエントリ（週次）
// ========================================

export async function getScheduleEntries(
  schoolId: string,
  fromDate: string,
  toDate: string
): Promise<ScheduleEntry[]> {
  const selectWithJoins =
    '*, time_slot:schedule_time_slots(*), student:students(id, last_name, first_name, grade), teacher:user_profiles!schedule_entries_teacher_id_fkey(id, display_name, email)';
  const result = await db
    .from('schedule_entries')
    .select(selectWithJoins)
    .eq('school_id', schoolId)
    .gte('entry_date', fromDate)
    .lte('entry_date', toDate)
    .order('entry_date')
    .order('time_slot_id');

  if (result.error) {
    const err = result.error as { message?: string; code?: string; details?: string };
    const msg = err.message ?? JSON.stringify(result.error);
    const code = err.code;
    console.error('Error fetching schedule entries:', msg, code, err.details ?? '');

    const tryWithoutJoins = await db
      .from('schedule_entries')
      .select('*')
      .eq('school_id', schoolId)
      .gte('entry_date', fromDate)
      .lte('entry_date', toDate)
      .order('entry_date')
      .order('time_slot_id');

    if (!tryWithoutJoins.error && tryWithoutJoins.data) {
      console.warn('Schedule entries loaded without joins (relation error). Run migrations if needed.');
      return (tryWithoutJoins.data || []) as ScheduleEntry[];
    }

    throw new Error(
      code === 'PGRST116'
        ? 'スケジュールの取得に失敗しました（テーブルまたはリレーションが存在しません。マイグレーションを実行してください）'
        : `スケジュールの取得に失敗しました: ${msg}`
    );
  }

  const rows = (result.data || []) as (ScheduleEntry & {
    time_slot?: ScheduleTimeSlot[] | ScheduleTimeSlot;
    student?: { id: string; last_name: string; first_name: string; grade: number }[] | { id: string; last_name: string; first_name: string; grade: number };
    teacher?: { id: string; display_name: string | null; email: string | null }[] | { id: string; display_name: string | null; email: string | null };
  })[];
  return rows.map((r) => ({
    ...r,
    time_slot: Array.isArray(r.time_slot) ? r.time_slot[0] : r.time_slot,
    student: Array.isArray(r.student) ? r.student[0] : r.student,
    teacher: Array.isArray(r.teacher) ? r.teacher[0] : r.teacher,
  })) as ScheduleEntry[];
}

/** 指定週のスケジュールを通塾日程から一括生成。既存は上書き。 */
export async function generateWeeklySchedule(
  schoolId: string,
  weekStartDate: string,
  userId?: string
): Promise<ScheduleGenerationResult> {
  const weekStart = new Date(weekStartDate);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);

  const fromStr = weekStart.toISOString().slice(0, 10);
  const toStr = weekEnd.toISOString().slice(0, 10);

  // 週内に effective_from/until が切り替わる可能性があるので、is_active のパターンを全件取得し
  // 日ごとに有効か判定する
  const patterns = await getRegularPatterns(schoolId);

  // 退塾日マップ：退塾予定日を持つ生徒は、その日以降のエントリ生成対象外
  const studentIds = Array.from(new Set(patterns.map((p) => p.student_id)));
  const withdrawalMap = new Map<string, string>();
  if (studentIds.length > 0) {
    const { data: studs } = await db
      .from('students')
      .select('id, withdrawal_date')
      .in('id', studentIds)
      .not('withdrawal_date', 'is', null);
    for (const s of (studs || []) as { id: string; withdrawal_date: string | null }[]) {
      if (s.withdrawal_date) withdrawalMap.set(s.id, s.withdrawal_date);
    }
  }

  type EntryRow = {
    school_id: string;
    entry_date: string;
    time_slot_id: string;
    teacher_id: string;
    student_id: string;
    subject_ids: string[];
    seat_label: string | null;
    regular_pattern_id: string;
    status: string;
    // 種別（regular/koushu）と形態（individual/group）
    // 通塾日程からの生成は常に regular。formation は将来 p.formation を引き継ぐ予定。
    kind: 'regular' | 'koushu';
    formation: 'individual' | 'group';
  };
  const entryKey = (e: { entry_date: string; time_slot_id: string; teacher_id: string; student_id: string }) =>
    `${e.entry_date}-${e.time_slot_id}-${e.teacher_id}-${e.student_id}`;
  const entriesMap = new Map<string, EntryRow>();

  for (const p of patterns) {
    if (!p.time_slot || !p.teacher_id) continue; // 講師未設定のパターンはスケジュール生成対象外
    for (let d = 0; d < 7; d++) {
      const dDate = new Date(weekStart);
      dDate.setUTCDate(weekStart.getUTCDate() + d);
      if (dDate.getUTCDay() !== p.day_of_week) continue;
      const dateStr = dDate.toISOString().slice(0, 10);
      // effective_from/until で日付が有効範囲内か
      if (p.effective_from && dateStr < p.effective_from) continue;
      if (p.effective_until && dateStr > p.effective_until) continue;
      // 退塾予定日以降は生成しない
      const wd = withdrawalMap.get(p.student_id);
      if (wd && dateStr >= wd) continue;
      const e: EntryRow = {
        school_id: schoolId,
        entry_date: dateStr,
        time_slot_id: p.time_slot_id,
        teacher_id: p.teacher_id,
        student_id: p.student_id,
        subject_ids: p.subject_ids || [],
        seat_label: p.seat_label || null,
        regular_pattern_id: p.id,
        status: 'scheduled',
        // 通塾日程から生成される=通常授業。
        // formation はパターン側の値を引き継ぐ（個別パターンなら個別、集団パターンなら集団のエントリに）。
        kind: 'regular',
        formation: p.formation ?? 'individual',
      };
      entriesMap.set(entryKey(e), e);
    }
  }
  const entries: EntryRow[] = Array.from(entriesMap.values());

  const { error: delError } = await db
    .from('schedule_entries')
    .delete()
    .eq('school_id', schoolId)
    .gte('entry_date', fromStr)
    .lte('entry_date', toStr)
    .in('status', ['scheduled', 'completed']);

  if (delError) {
    console.error('Error clearing existing entries:', delError);
    throw new Error('既存スケジュールの削除に失敗しました');
  }

  const uniqueTeacherIds = Array.from(new Set(entries.map((e) => e.teacher_id)));
  await Promise.all(uniqueTeacherIds.map((tid) => ensureUserIsTeacher(tid)));

  if (entries.length > 0) {
    const { error: insError } = await db.from('schedule_entries').upsert(entries, {
      onConflict: 'school_id,entry_date,time_slot_id,teacher_id,student_id',
      ignoreDuplicates: true,
    });
    if (insError) {
      console.error('Error inserting schedule entries:', insError);
      const msg =
        insError && typeof insError === 'object' && 'message' in insError
          ? String((insError as { message: string }).message)
          : '';
      throw new Error(msg ? `スケジュールの生成に失敗しました: ${msg}` : 'スケジュールの生成に失敗しました');
    }
  }

  const { error: logError } = await db.from('schedule_generation_logs').insert({
    school_id: schoolId,
    week_start_date: weekStartDate,
    entries_created: entries.length,
    created_by: userId || null,
  });
  if (logError) console.warn('Generation log insert failed:', logError);

  return { entries_created: entries.length, week_start_date: weekStartDate };
}

/** 通塾日程から指定週に生成されるエントリのキー一覧を取得（同期チェック用）。generateWeeklySchedule と同一ロジック。 */
export async function getExpectedEntryKeysFromPatterns(
  schoolId: string,
  weekStartDate: string
): Promise<Set<string>> {
  const weekStart = new Date(weekStartDate);
  const keys = new Set<string>();
  const patterns = await getRegularPatterns(schoolId);

  const studentIds = Array.from(new Set(patterns.map((p) => p.student_id)));
  const withdrawalMap = new Map<string, string>();
  if (studentIds.length > 0) {
    const { data: studs } = await db
      .from('students')
      .select('id, withdrawal_date')
      .in('id', studentIds)
      .not('withdrawal_date', 'is', null);
    for (const s of (studs || []) as { id: string; withdrawal_date: string | null }[]) {
      if (s.withdrawal_date) withdrawalMap.set(s.id, s.withdrawal_date);
    }
  }

  for (const p of patterns) {
    if (!p.time_slot) continue;
    for (let d = 0; d < 7; d++) {
      const dDate = new Date(weekStart);
      dDate.setUTCDate(weekStart.getUTCDate() + d);
      if (dDate.getUTCDay() !== p.day_of_week) continue;
      const dateStr = dDate.toISOString().slice(0, 10);
      if (p.effective_from && dateStr < p.effective_from) continue;
      if (p.effective_until && dateStr > p.effective_until) continue;
      const wd = withdrawalMap.get(p.student_id);
      if (wd && dateStr >= wd) continue;
      keys.add(`${dateStr}-${p.time_slot_id}-${p.student_id}`);
    }
  }
  return keys;
}

/** 今日を含む週の月曜日を YYYY-MM-DD で返す（通塾日程変更時の自動反映用） */
export function getCurrentWeekStartDateStr(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const start = new Date(d);
  start.setDate(d.getDate() + diff);
  const y = start.getFullYear();
  const m = String(start.getMonth() + 1).padStart(2, '0');
  const dayNum = String(start.getDate()).padStart(2, '0');
  return `${y}-${m}-${dayNum}`;
}

/** 指定日を含む週の月曜日を YYYY-MM-DD で返す */
export function getWeekStartForDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const start = new Date(d);
  start.setDate(d.getDate() + diff);
  const y = start.getFullYear();
  const m = String(start.getMonth() + 1).padStart(2, '0');
  const dayNum = String(start.getDate()).padStart(2, '0');
  return `${y}-${m}-${dayNum}`;
}

/**
 * 通塾日程変更後に「今週から先4週」分の座席表を自動再生成
 *
 * 未来時点からの変更（effective_from が翌月など）にも反映させるため、
 * 単週ではなく複数週まとめて再生成する。失敗時は無視（手動再生成可能）。
 */
export async function regenerateCurrentWeekIfNeeded(
  schoolId: string,
  userId?: string,
  options?: { weeksAhead?: number }
): Promise<void> {
  const weeks = options?.weeksAhead ?? 4;
  try {
    const baseStart = getCurrentWeekStartDateStr();
    for (let i = 0; i < weeks; i++) {
      const d = new Date(baseStart + 'T12:00:00');
      d.setDate(d.getDate() + i * 7);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      await generateWeeklySchedule(schoolId, `${y}-${m}-${dd}`, userId);
    }
  } catch (e) {
    console.warn('通塾日程の自動反映に失敗しました:', e);
  }
}

/** 指定日を含む週の座席表を通塾日程から再生成。失敗時は無視 */
export async function regenerateWeekForDate(
  schoolId: string,
  dateStr: string,
  userId?: string
): Promise<void> {
  try {
    const weekStart = getWeekStartForDate(dateStr);
    await generateWeeklySchedule(schoolId, weekStart, userId);
  } catch (e) {
    console.warn('通塾日程の自動反映に失敗しました:', e);
  }
}

/** 指定週に既にエントリが存在するか */
export async function hasEntriesForWeek(schoolId: string, weekStartDate: string): Promise<boolean> {
  const start = new Date(weekStartDate);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const fromStr = start.toISOString().slice(0, 10);
  const toStr = end.toISOString().slice(0, 10);
  const { data, error } = await db
    .from('schedule_entries')
    .select('id')
    .eq('school_id', schoolId)
    .gte('entry_date', fromStr)
    .lte('entry_date', toStr)
    .limit(1);
  if (error) return false;
  return (data?.length ?? 0) > 0;
}

// ========================================
// Phase 2: 授業の追加・編集・移動・出席・削除・振替
// ========================================

/** 指定コマ（日付・スロット・講師）の授業一覧（移動可否判定用） */
export async function getSlotEntries(
  schoolId: string,
  date: string,
  slotId: string,
  teacherId: string
): Promise<ScheduleEntry[]> {
  const { data, error } = await db
    .from('schedule_entries')
    .select('*')
    .eq('school_id', schoolId)
    .eq('entry_date', date)
    .eq('time_slot_id', slotId)
    .eq('teacher_id', teacherId)
    .in('status', ['scheduled', 'completed', 'transferred_in'])
    .order('created_at');

  if (error) {
    console.error('Error fetching slot entries:', error);
    throw new Error('授業の取得に失敗しました');
  }
  return (data || []) as ScheduleEntry[];
}

/**
 * 講師の時間重複チェック。
 * 指定日 × 指定時刻範囲に、その講師の別エントリが既にある場合は重複情報を返す。
 *
 * 個別と集団でコマ時間が違っても、時刻範囲が物理的に重なれば NG。
 * （例：講師Aが個別 19:30-21:00 と集団 20:20-21:20 の両方に入っている）
 */
export async function checkTeacherTimeConflict(
  teacherId: string,
  entryDate: string,
  startTime: string,
  endTime: string,
  options?: { excludeScheduleEntryId?: string }
): Promise<TimeConflictResult | null> {
  const excludeEntryId = options?.excludeScheduleEntryId;

  const { data: entries, error } = await db
    .from('schedule_entries')
    .select(
      'id, entry_date, time_slot_id, student_id, time_slot:schedule_time_slots(start_time, end_time), student:students(last_name, first_name)'
    )
    .eq('teacher_id', teacherId)
    .eq('entry_date', entryDate)
    .in('status', ['scheduled', 'completed', 'transferred_in']);

  if (error || !entries?.length) return null;

  for (const row of entries as Array<{
    id: string;
    time_slot_id: string;
    student_id: string;
    time_slot?: { start_time: string; end_time: string }[] | { start_time: string; end_time: string };
    student?: { last_name: string; first_name: string }[] | { last_name: string; first_name: string };
  }>) {
    if (row.id === excludeEntryId) continue;
    const slot = Array.isArray(row.time_slot) ? row.time_slot[0] : row.time_slot;
    const student = Array.isArray(row.student) ? row.student[0] : row.student;
    if (!slot) continue;
    if (timeRangesOverlap(startTime, endTime, slot.start_time ?? '', slot.end_time ?? '')) {
      const studentName = student ? `${student.last_name}${student.first_name}` : '別の生徒';
      return {
        type: 'schedule_entry',
        conflictWith: {
          id: row.id,
          date: entryDate,
          startTime: slot.start_time ?? '',
          endTime: slot.end_time ?? '',
          // 講師重複なので「衝突相手」は生徒（同じ講師がこの生徒のコマと被っている）
          teacherName: studentName,
          subjectName: '',
        },
        message: `この講師は ${entryDate} の ${slot.start_time?.slice(0, 5)}-${slot.end_time?.slice(0, 5)}（${studentName}）と時間が重複しています`,
      };
    }
  }
  return null;
}

/** 授業を1件追加 */
export async function createScheduleEntry(
  schoolId: string,
  date: string,
  slotId: string,
  form: ScheduleEntryFormData,
  options?: { regular_pattern_id?: string | null; status?: string }
): Promise<ScheduleEntry> {
  await ensureUserIsTeacher(form.teacher_id);

  // 同時刻重複チェック：個別と集団でコマ時間が違っても、時刻範囲が重なれば配置不可
  const targetSlot = await getTimeSlotById(slotId);
  if (targetSlot) {
    const studentConflict = await checkStudentTimeConflict(
      form.student_id,
      // dayOfWeek は specificDate を渡せば使われないが、型上必須なので date から計算
      new Date(date + 'T12:00:00').getDay(),
      targetSlot.start_time,
      targetSlot.end_time,
      { specificDate: date }
    );
    if (studentConflict) {
      throw new Error(`生徒の時間重複: ${studentConflict.message}`);
    }
    const teacherConflict = await checkTeacherTimeConflict(
      form.teacher_id,
      date,
      targetSlot.start_time,
      targetSlot.end_time
    );
    if (teacherConflict) {
      throw new Error(`講師の時間重複: ${teacherConflict.message}`);
    }
  }

  const { data, error } = await db
    .from('schedule_entries')
    .insert({
      school_id: schoolId,
      entry_date: date,
      time_slot_id: slotId,
      teacher_id: form.teacher_id,
      student_id: form.student_id,
      subject_ids: form.subject_ids || [],
      seat_label: form.seat_label || null,
      note: form.note || null,
      regular_pattern_id: options?.regular_pattern_id ?? null,
      status: options?.status ?? 'scheduled',
      // 種別・形態：未指定なら DB デフォルト (regular / individual) が入る。
      // 講習コマを手動配置する場合は呼び出し側で kind='koushu' を渡す。
      // 集団コマを作る場合は formation='group' を渡す。
      kind: form.kind ?? 'regular',
      formation: form.formation ?? 'individual',
    })
    .select()
    .single();

  if (error) {
    console.error('Error creating schedule entry:', error);
    const code = error && typeof error === 'object' && 'code' in error ? String((error as { code: string }).code) : '';
    if (code === '23505') {
      throw new Error('この日時・講師・生徒の組み合わせで既に授業が登録されています');
    }
    throw new Error('授業の追加に失敗しました');
  }
  return data as ScheduleEntry;
}

/** 授業を更新（講師・科目・座席・備考） */
export async function updateScheduleEntry(
  id: string,
  form: Partial<ScheduleEntryFormData>
): Promise<ScheduleEntry> {
  if (form.teacher_id !== undefined) {
    await ensureUserIsTeacher(form.teacher_id);
  }
  const payload: Record<string, unknown> = {};
  if (form.teacher_id !== undefined) payload.teacher_id = form.teacher_id;
  if (form.student_id !== undefined) payload.student_id = form.student_id;
  if (form.subject_ids !== undefined) payload.subject_ids = form.subject_ids;
  if (form.seat_label !== undefined) payload.seat_label = form.seat_label || null;
  if (form.note !== undefined) payload.note = form.note || null;

  const { data, error } = await db
    .from('schedule_entries')
    .update(payload)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('Error updating schedule entry:', error);
    throw new Error('授業の更新に失敗しました');
  }
  return data as ScheduleEntry;
}

/** 授業を週内で移動（date, time_slot_id, teacher_id を更新） */
export async function moveScheduleEntry(
  id: string,
  targetDate: string,
  targetSlotId: string,
  targetTeacherId: string
): Promise<ScheduleEntry> {
  await ensureUserIsTeacher(targetTeacherId);
  const { data, error } = await db
    .from('schedule_entries')
    .update({
      entry_date: targetDate,
      time_slot_id: targetSlotId,
      teacher_id: targetTeacherId,
    })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('Error moving schedule entry:', error);
    throw new Error('授業の移動に失敗しました');
  }
  return data as ScheduleEntry;
}

/** 出席を記録（attendance_status, attendance_recorded_at, attendance_recorded_by, status = 'completed'） */
export async function recordAttendance(
  id: string,
  status: 'present' | 'absent' | 'late',
  recordedBy: string
): Promise<ScheduleEntry> {
  const { data, error } = await db
    .from('schedule_entries')
    .update({
      attendance_status: status,
      attendance_recorded_at: new Date().toISOString(),
      attendance_recorded_by: recordedBy,
      status: 'completed',
    })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('Error recording attendance:', error);
    throw new Error('出席の記録に失敗しました');
  }
  return data as ScheduleEntry;
}

/** 授業を論理削除（status = 'cancelled'）。振替先がある場合は振替先も取消。 */
export async function deleteScheduleEntry(id: string): Promise<void> {
  const { data: row, error: fetchErr } = await db
    .from('schedule_entries')
    .select('transfer_to_id')
    .eq('id', id)
    .single();

  if (fetchErr) {
    console.error('Error fetching entry for delete:', fetchErr);
    throw new Error('授業の削除に失敗しました');
  }

  const { error } = await db
    .from('schedule_entries')
    .update({ status: 'cancelled' })
    .eq('id', id);

  if (error) {
    console.error('Error deleting schedule entry:', error);
    throw new Error('授業の削除に失敗しました');
  }

  const transferToId = (row as { transfer_to_id?: string | null })?.transfer_to_id;
  if (transferToId) {
    const { error: err2 } = await db
      .from('schedule_entries')
      .update({ status: 'cancelled' })
      .eq('id', transferToId);
    if (err2) console.warn('Failed to cancel transfer target:', err2);
  }
}

/**
 * 元授業日付（'YYYY-MM-DD'）から振替期限「翌月末日」を計算
 * 例：2026-05-15 → 2026-06-30、2026-12-31 → 2027-01-31
 */
export function calcTransferDeadline(originalDateStr: string): string {
  // ローカルタイムゾーンで Date を作る（'T12:00:00' を付与してDST境界を避ける）
  const d = new Date(originalDateStr + 'T12:00:00');
  // 翌月の0日 = 当月の最終日。翌月+1の0日で翌月末を取得する
  const target = new Date(d.getFullYear(), d.getMonth() + 2, 0);
  const y = target.getFullYear();
  const m = String(target.getMonth() + 1).padStart(2, '0');
  const dd = String(target.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** 振替: 元を transferred_out にし、振替先を transferred_in で作成し相互リンク */
export async function createTransferEntry(
  schoolId: string,
  fromEntryId: string,
  targetDate: string,
  targetSlotId: string,
  targetTeacherId: string,
  seatLabel?: string | null
): Promise<{ from: ScheduleEntry; to: ScheduleEntry }> {
  await ensureUserIsTeacher(targetTeacherId);

  // 元エントリの日付を先に取得（期限計算のため）
  const { data: srcRow, error: srcErr } = await db
    .from('schedule_entries')
    .select('entry_date')
    .eq('id', fromEntryId)
    .single();
  if (srcErr || !srcRow) {
    console.error('Error fetching transfer source:', srcErr);
    throw new Error('振替元の取得に失敗しました');
  }
  const deadline = calcTransferDeadline((srcRow as { entry_date: string }).entry_date);

  const { data: fromRow, error: updateErr } = await db
    .from('schedule_entries')
    .update({
      status: 'transferred_out',
      // 振替期限：元授業日の翌月末日。空きコマで未消化のままだと督促対象になる
      transfer_deadline: deadline,
    })
    .eq('id', fromEntryId)
    .select()
    .single();

  if (updateErr || !fromRow) {
    console.error('Error updating transfer source:', updateErr);
    throw new Error('振替元の更新に失敗しました');
  }

  const fromEntry = fromRow as ScheduleEntry;
  const { data: toRow, error: insertErr } = await db
    .from('schedule_entries')
    .insert({
      school_id: schoolId,
      entry_date: targetDate,
      time_slot_id: targetSlotId,
      teacher_id: targetTeacherId,
      student_id: fromEntry.student_id,
      subject_ids: fromEntry.subject_ids || [],
      seat_label: seatLabel ?? fromEntry.seat_label,
      note: fromEntry.note,
      regular_pattern_id: fromEntry.regular_pattern_id,
      status: 'transferred_in',
      transfer_from_id: fromEntryId,
    })
    .select()
    .single();

  if (insertErr || !toRow) {
    console.error('Error creating transfer target:', insertErr);
    throw new Error('振替先の登録に失敗しました');
  }

  const toEntry = toRow as ScheduleEntry;
  const { error: linkErr } = await db
    .from('schedule_entries')
    .update({ transfer_to_id: toEntry.id })
    .eq('id', fromEntryId);

  if (linkErr) console.warn('Link transfer_to_id failed:', linkErr);

  // 振替確定通知レコードを記録（保護者通知用）
  // 実際の送信は将来 Edge Function が pending 状態のものを拾って送る運用。
  // ここでINSERTが失敗しても振替自体は成立しているので、警告だけにしてthrowしない。
  try {
    // 時刻ラベルを冗長で残す（後でエントリが消えても情報を保持）
    const fromSlotLabel = fromEntry.time_slot
      ? `${fromEntry.time_slot.start_time?.slice(0, 5)}〜${fromEntry.time_slot.end_time?.slice(0, 5)}`
      : null;
    const { data: targetSlot } = await db
      .from('schedule_time_slots')
      .select('start_time, end_time')
      .eq('id', targetSlotId)
      .maybeSingle();
    const toSlotLabel = targetSlot
      ? `${(targetSlot as { start_time: string }).start_time?.slice(0, 5)}〜${(targetSlot as { end_time: string }).end_time?.slice(0, 5)}`
      : null;

    await db.from('transfer_notifications').insert({
      school_id: schoolId,
      student_id: fromEntry.student_id,
      from_entry_id: fromEntryId,
      to_entry_id: toEntry.id,
      from_date: fromEntry.entry_date,
      to_date: targetDate,
      from_time_slot_label: fromSlotLabel,
      to_time_slot_label: toSlotLabel,
      // delivery_status はデフォルト 'pending'
    });
  } catch (notifyErr) {
    console.warn('Failed to record transfer notification:', notifyErr);
  }

  return { from: fromEntry, to: toEntry };
}

/** 振替を元に戻す: 振替先(transferred_in)を削除し、振替元を通常(scheduled)に戻す */
export async function revertTransferEntry(transferredInEntryId: string): Promise<void> {
  const { data: toRow, error: fetchErr } = await db
    .from('schedule_entries')
    .select('id, transfer_from_id')
    .eq('id', transferredInEntryId)
    .single();

  if (fetchErr || !toRow) {
    console.error('Error fetching transfer target:', fetchErr);
    throw new Error('振替先の授業が見つかりません');
  }

  const fromId = (toRow as { transfer_from_id?: string | null }).transfer_from_id;
  if (!fromId) {
    throw new Error('振替元が紐づいていません');
  }

  const { error: updateErr } = await db
    .from('schedule_entries')
    .update({
      status: 'scheduled',
      transfer_to_id: null,
      // 振替を取り消す = 元の通常授業に戻す。期限管理対象外にする
      transfer_deadline: null,
    })
    .eq('id', fromId);

  if (updateErr) {
    console.error('Error reverting transfer source:', updateErr);
    throw new Error('振替元の復元に失敗しました');
  }

  const { error: deleteErr } = await db
    .from('schedule_entries')
    .delete()
    .eq('id', transferredInEntryId);

  if (deleteErr) {
    console.error('Error deleting transfer target:', deleteErr);
    throw new Error('振替先の削除に失敗しました');
  }
}

// ========================================
// ズレ検知（通塾日程 vs 座席表エントリ）
// ========================================
// 振替期限管理（督促ボード用）
// ========================================

/**
 * 「振替元（transferred_out）かつ振替先が未確定」のエントリを取得。
 * 督促ボードで「期限切れ間近の振替: N件」を表示するための一覧。
 *
 * @param schoolIds 表示対象の学校ID（複数校対応）
 * @param thresholdDays 「N日以内に期限が来るもの」を対象にする。デフォルト14日。
 *                      負の値（期限切れ）も含めるため、 transfer_deadline <= today + threshold で絞る。
 */
export async function getPendingTransfers(
  schoolIds: string[],
  thresholdDays = 14
): Promise<ScheduleEntry[]> {
  if (schoolIds.length === 0) return [];
  const now = new Date();
  const limit = new Date(now);
  limit.setDate(limit.getDate() + thresholdDays);
  const limitStr = limit.toISOString().slice(0, 10);

  const { data, error } = await db
    .from('schedule_entries')
    .select(
      '*, time_slot:schedule_time_slots(*), student:students(id, last_name, first_name, grade), teacher:user_profiles!schedule_entries_teacher_id_fkey(id, display_name, email)'
    )
    .in('school_id', schoolIds)
    .eq('status', 'transferred_out')
    .is('transfer_to_id', null) // 振替先未確定のみ
    .not('transfer_deadline', 'is', null)
    .lte('transfer_deadline', limitStr)
    .order('transfer_deadline', { ascending: true });

  if (error) {
    console.error('Error fetching pending transfers:', error);
    throw new Error('未消化振替の取得に失敗しました');
  }
  type Row = ScheduleEntry & {
    time_slot?: ScheduleTimeSlot[] | ScheduleTimeSlot;
    student?: { id: string; last_name: string; first_name: string; grade: number }[] | { id: string; last_name: string; first_name: string; grade: number };
    teacher?: { id: string; display_name: string | null; email: string | null }[] | { id: string; display_name: string | null; email: string | null };
  };
  const rows = (data || []) as Row[];
  return rows.map((r) => ({
    ...r,
    time_slot: Array.isArray(r.time_slot) ? r.time_slot[0] : r.time_slot,
    student: Array.isArray(r.student) ? r.student[0] : r.student,
    teacher: Array.isArray(r.teacher) ? r.teacher[0] : r.teacher,
  })) as ScheduleEntry[];
}

// ========================================

export interface ScheduleDriftWeek {
  /** 週の月曜日 'YYYY-MM-DD' */
  weekStart: string;
  /** 通塾日程に存在するが、座席表に未生成のキー数（missing） */
  missingCount: number;
  /** 座席表に存在するが、通塾日程からは期待されていないキー数（extra）。
   *  振替・手動追加を除いた regular_pattern_id 付きのもののみ */
  extraCount: number;
}

/**
 * 指定週範囲の「通塾日程と座席表のズレ」を検出
 *
 * - missing: 期待されるが座席表に無い（パターンを変更したのに反映されていない）
 * - extra:   regular_pattern_id 付きの座席表エントリのうち、現在のパターンから期待されないもの
 *            （古いパターンで生成されたまま残っている可能性）
 *
 * @param fromWeekStart 検査開始週の月曜日 'YYYY-MM-DD'
 * @param weeksAhead 何週先まで見るか（デフォルト4週）
 */
export async function detectScheduleDrift(
  schoolId: string,
  fromWeekStart: string,
  weeksAhead = 4
): Promise<ScheduleDriftWeek[]> {
  const results: ScheduleDriftWeek[] = [];

  for (let i = 0; i < weeksAhead; i++) {
    const d = new Date(fromWeekStart + 'T12:00:00');
    d.setDate(d.getDate() + i * 7);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const weekStart = `${y}-${m}-${dd}`;

    const weekEnd = new Date(d);
    weekEnd.setDate(weekEnd.getDate() + 6);
    const ey = weekEnd.getFullYear();
    const em = String(weekEnd.getMonth() + 1).padStart(2, '0');
    const ed = String(weekEnd.getDate()).padStart(2, '0');
    const weekEndStr = `${ey}-${em}-${ed}`;

    // 期待されるエントリキー
    const expected = await getExpectedEntryKeysFromPatterns(schoolId, weekStart);

    // 実際の座席表エントリ（regular_pattern_id 付き・cancelled/transferred_out 以外）
    const { data: entries } = await db
      .from('schedule_entries')
      .select('entry_date, time_slot_id, student_id, regular_pattern_id, status')
      .eq('school_id', schoolId)
      .gte('entry_date', weekStart)
      .lte('entry_date', weekEndStr)
      .not('regular_pattern_id', 'is', null)
      .in('status', ['scheduled', 'completed']);

    const actualSet = new Set<string>();
    for (const e of (entries || []) as { entry_date: string; time_slot_id: string; student_id: string }[]) {
      actualSet.add(`${e.entry_date}-${e.time_slot_id}-${e.student_id}`);
    }

    let missing = 0;
    Array.from(expected).forEach((k) => {
      if (!actualSet.has(k)) missing++;
    });
    let extra = 0;
    Array.from(actualSet).forEach((k) => {
      if (!expected.has(k)) extra++;
    });

    if (missing > 0 || extra > 0) {
      results.push({ weekStart, missingCount: missing, extraCount: extra });
    }
  }

  return results;
}
