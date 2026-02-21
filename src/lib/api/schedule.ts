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

export async function getTimeSlots(schoolId: string): Promise<ScheduleTimeSlot[]> {
  const { data, error } = await db
    .from('schedule_time_slots')
    .select('*')
    .eq('school_id', schoolId)
    .order('display_order', { ascending: true })
    .order('slot_number', { ascending: true });

  if (error) {
    console.error('Error fetching time slots:', error);
    throw new Error('コマ時間の取得に失敗しました');
  }
  return (data || []) as ScheduleTimeSlot[];
}

export async function getActiveTimeSlots(schoolId: string): Promise<ScheduleTimeSlot[]> {
  const { data, error } = await db
    .from('schedule_time_slots')
    .select('*')
    .eq('school_id', schoolId)
    .eq('is_active', true)
    .order('display_order', { ascending: true })
    .order('slot_number', { ascending: true });

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

export async function deleteTimeSlot(id: string): Promise<void> {
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

export async function getRegularPatterns(
  schoolId: string,
  filters?: { studentId?: string; dayOfWeek?: number; periodType?: string }
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
  await ensureUserIsTeacher(form.teacher_id);
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
    })
    .select()
    .single();

  if (error) {
    console.error('Error creating regular pattern:', error);
    throw new Error('通塾日程の登録に失敗しました');
  }
  return data as ScheduleRegularPattern;
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

  if (form.teacher_id !== undefined) {
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

  const patterns = await getRegularPatterns(schoolId);

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
  };
  const entryKey = (e: { entry_date: string; time_slot_id: string; teacher_id: string; student_id: string }) =>
    `${e.entry_date}-${e.time_slot_id}-${e.teacher_id}-${e.student_id}`;
  const entriesMap = new Map<string, EntryRow>();

  for (const p of patterns) {
    if (!p.time_slot) continue;
    for (let d = 0; d < 7; d++) {
      const dDate = new Date(weekStart);
      dDate.setUTCDate(weekStart.getUTCDate() + d);
      if (dDate.getUTCDay() !== p.day_of_week) continue;
      const dateStr = dDate.toISOString().slice(0, 10);
      const e = {
        school_id: schoolId,
        entry_date: dateStr,
        time_slot_id: p.time_slot_id,
        teacher_id: p.teacher_id,
        student_id: p.student_id,
        subject_ids: p.subject_ids || [],
        seat_label: p.seat_label || null,
        regular_pattern_id: p.id,
        status: 'scheduled',
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
  for (const tid of uniqueTeacherIds) {
    await ensureUserIsTeacher(tid);
  }

  if (entries.length > 0) {
    const { error: insError } = await db.from('schedule_entries').insert(entries);
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
  for (const p of patterns) {
    if (!p.time_slot) continue;
    for (let d = 0; d < 7; d++) {
      const dDate = new Date(weekStart);
      dDate.setUTCDate(weekStart.getUTCDate() + d);
      if (dDate.getUTCDay() !== p.day_of_week) continue;
      const dateStr = dDate.toISOString().slice(0, 10);
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

/** 通塾日程変更後に今週の座席表を自動再生成。失敗時は無視（ユーザーは手動で再生成可能） */
export async function regenerateCurrentWeekIfNeeded(
  schoolId: string,
  userId?: string
): Promise<void> {
  try {
    const weekStart = getCurrentWeekStartDateStr();
    await generateWeeklySchedule(schoolId, weekStart, userId);
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

/** 授業を1件追加 */
export async function createScheduleEntry(
  schoolId: string,
  date: string,
  slotId: string,
  form: ScheduleEntryFormData,
  options?: { regular_pattern_id?: string | null; status?: string }
): Promise<ScheduleEntry> {
  await ensureUserIsTeacher(form.teacher_id);
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
  const { data: fromRow, error: updateErr } = await db
    .from('schedule_entries')
    .update({ status: 'transferred_out' })
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
    .update({ status: 'scheduled', transfer_to_id: null })
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
