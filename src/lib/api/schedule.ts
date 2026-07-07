import { supabase } from '@/lib/supabase';
import { fetchAllPaged } from '@/lib/utils/supabasePaging';
import { normalizePersonName } from '@/lib/utils/personName';
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
function timeRangesOverlap(startA: string, endA: string, startB: string, endB: string): boolean {
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
      time_slot?:
        | { start_time: string; end_time: string }[]
        | { start_time: string; end_time: string };
      teacher?:
        | { display_name: string | null; email: string | null }[]
        | { display_name: string | null; email: string | null };
    })[]) {
      if (row.id === excludeEntryId) continue;
      const slot = Array.isArray(row.time_slot) ? row.time_slot[0] : row.time_slot;
      const teacher = Array.isArray(row.teacher) ? row.teacher[0] : row.teacher;
      if (slot) {
        timeSlotsMap.set(row.time_slot_id, slot);
        if (teacher) teachersMap.set(row.teacher_id, teacher.display_name || teacher.email || '—');
      }
    }

    for (const row of entries as (ScheduleEntry & {
      time_slot?:
        | { start_time: string; end_time: string }[]
        | { start_time: string; end_time: string };
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
          message: `この生徒は ${specificDate} ${st.slice(0, 5)}〜${et.slice(0, 5)} に既に別の授業（担当: ${teacherName}）があるため、同じ時間帯には登録できません`,
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
    time_slot?:
      | { start_time: string; end_time: string }[]
      | { start_time: string; end_time: string };
    teacher?:
      | { display_name: string | null; email: string | null }[]
      | { display_name: string | null; email: string | null };
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
        message: `この生徒は毎週${dayLabel}曜 ${st.slice(0, 5)}〜${et.slice(0, 5)} に通常授業（担当: ${teacherName}）があるため、同じ時間帯には登録できません`,
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
  type RawRow = ScheduleRegularPattern & {
    time_slot?: ScheduleTimeSlot[];
    student?: { id: string; last_name: string; first_name: string; grade: number }[];
    teacher?: { id: string; display_name: string | null; email: string | null }[];
  };

  // schedule_regular_patterns は (生徒数 × 曜日 × 履歴) でスケールし1000行を超えうる。
  // studentId 未指定（座席表の週次生成・ズレ検知）で全件走査されるため、切り捨てると
  // 一部生徒の通塾日程が座席表生成から静かに欠落する。全件ページング取得し、既存の
  // 並び順(day_of_week, time_slot_id)に id を第2ソートキーとして足して安定ページング。
  let rows: RawRow[];
  try {
    rows = await fetchAllPaged<RawRow>((from, to) => {
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

      return query
        .order('day_of_week')
        .order('time_slot_id')
        .order('id', { ascending: true })
        .range(from, to);
    });
  } catch (e) {
    console.error('Error fetching regular patterns:', e);
    throw new Error('通塾日程の取得に失敗しました');
  }

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
    await db
      .from('schedule_regular_patterns')
      .update({ effective_until: null })
      .eq('id', patternId);
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
  if (
    form.day_of_week !== undefined ||
    form.time_slot_id !== undefined ||
    form.student_id !== undefined
  ) {
    const existing = await db
      .from('schedule_regular_patterns')
      .select('student_id, day_of_week, time_slot_id')
      .eq('id', id)
      .single();
    if (!existing.error && existing.data) {
      const studentId = form.student_id ?? (existing.data as { student_id: string }).student_id;
      const dayOfWeek = form.day_of_week ?? (existing.data as { day_of_week: number }).day_of_week;
      const timeSlotId =
        form.time_slot_id ?? (existing.data as { time_slot_id: string }).time_slot_id;
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
    '*, time_slot:schedule_time_slots(*), student:students(id, last_name, first_name, grade, preferred_teacher_gender, fixed_teacher_ids, excluded_teacher_ids), teacher:user_profiles!schedule_entries_teacher_id_fkey(id, display_name, email)';
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
      console.warn(
        'Schedule entries loaded without joins (relation error). Run migrations if needed.'
      );
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
    student?:
      | { id: string; last_name: string; first_name: string; grade: number }[]
      | { id: string; last_name: string; first_name: string; grade: number };
    teacher?:
      | { id: string; display_name: string | null; email: string | null }[]
      | { id: string; display_name: string | null; email: string | null };
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
    // 担当未決定パターンも生成対象になったため nullable
    teacher_id: string | null;
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
  // 【重要】再生成は対象週を全削除→再INSERT する破壊的処理。
  // 「このコマだけ」割当 (schedule_entries.teacher_id を直接更新するが
  // パターンの teacher_id は NULL のまま) が再生成で消える事故を防ぐため、
  // 削除前に既存エントリの「手動割当された teacher_id」を退避し、
  // パターンが NULL の場合はそれを引き継ぐ。
  //   キー: entry_date-time_slot_id-student_id (teacher は含めない＝同一コマ同一生徒で一意)
  const { data: existingForCarry } = await db
    .from('schedule_entries')
    .select('entry_date, time_slot_id, student_id, teacher_id')
    .eq('school_id', schoolId)
    .eq('kind', 'regular')
    .gte('entry_date', fromStr)
    .lte('entry_date', toStr)
    .in('status', ['scheduled', 'completed']);
  const manualTeacherCarry = new Map<string, string>();
  for (const e of (existingForCarry ?? []) as Array<{
    entry_date: string;
    time_slot_id: string;
    student_id: string;
    teacher_id: string | null;
  }>) {
    if (e.teacher_id) {
      manualTeacherCarry.set(`${e.entry_date}-${e.time_slot_id}-${e.student_id}`, e.teacher_id);
    }
  }

  // 再生成スキップ対象の枠 (student-date-slot) を退避。
  // DELETE は kind='regular' かつ status IN ('scheduled','completed') のみ消すので、それ以外は行が残る:
  //  - 通常授業の transferred_out / transferred_in / cancelled（N-4 振替戻し重複対策）
  //  - regular 以外の kind（koushu / test_prep / additional / trial）全ステータス
  //    （DELETE 対象外。残った行と同 (school,date,slot,teacher,student) を INSERT すると
  //     UNIQUE 違反で再生成が丸ごと失敗するため＝講習・追加授業の巻き込み対策）
  // 残る行と同じ枠を生成すると UNIQUE 違反になるので、これらは生成スキップする。
  const { data: skipRows } = await db
    .from('schedule_entries')
    .select('entry_date, time_slot_id, student_id')
    .eq('school_id', schoolId)
    .gte('entry_date', fromStr)
    .lte('entry_date', toStr)
    .or('kind.neq.regular,status.in.(transferred_out,transferred_in,cancelled)');
  const transferredKeys = new Set(
    (
      (skipRows ?? []) as Array<{ entry_date: string; time_slot_id: string; student_id: string }>
    ).map((e) => `${e.entry_date}-${e.time_slot_id}-${e.student_id}`)
  );

  // teacher_id が NULL のものは ハイフン+null で識別。NULL 同士のキー衝突を防ぐ
  const entryKey = (e: {
    entry_date: string;
    time_slot_id: string;
    teacher_id: string | null;
    student_id: string;
  }) => `${e.entry_date}-${e.time_slot_id}-${e.teacher_id ?? 'null'}-${e.student_id}`;
  const entriesMap = new Map<string, EntryRow>();

  for (const p of patterns) {
    // 時間帯マスタ未設定のパターンだけスキップ。teacher_id NULL は「担当未決定」エントリとして生成する。
    if (!p.time_slot) continue;
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
      // 振替済みの枠は再生成しない（重複防止 N-4）
      const carryKey = `${dateStr}-${p.time_slot_id}-${p.student_id}`;
      if (transferredKeys.has(carryKey)) continue;
      // パターンの teacher_id が NULL でも、既存エントリで手動割当されていればそれを維持する
      const teacherId = p.teacher_id ?? manualTeacherCarry.get(carryKey) ?? null;
      const e: EntryRow = {
        school_id: schoolId,
        entry_date: dateStr,
        time_slot_id: p.time_slot_id,
        teacher_id: teacherId,
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

  // kind='regular' のみ削除する。講習コマ (kind='koushu') は通塾日程の再生成対象外なので残す
  // （講習配置が通塾日程の再生成で消える事故を防ぐ）。
  const { error: delError } = await db
    .from('schedule_entries')
    .delete()
    .eq('school_id', schoolId)
    .eq('kind', 'regular')
    .gte('entry_date', fromStr)
    .lte('entry_date', toStr)
    .in('status', ['scheduled', 'completed']);

  if (delError) {
    console.error('Error clearing existing entries:', delError);
    throw new Error('既存スケジュールの削除に失敗しました');
  }

  // 担当未決定エントリは teacher_id=NULL のためスキップ。設定済み講師だけ teacher ロール検証する
  const uniqueTeacherIds = Array.from(
    new Set(entries.map((e) => e.teacher_id).filter((id): id is string => !!id))
  );
  await Promise.all(uniqueTeacherIds.map((tid) => ensureUserIsTeacher(tid)));

  if (entries.length > 0) {
    // teacher_id が NULL の行は ON CONFLICT が機能しないため、純粋な INSERT で扱う。
    // 重複は事前に entriesMap で除去済み、かつ上の DELETE で対象週は空になっているので衝突しない。
    const { error: insError } = await db.from('schedule_entries').insert(entries);
    if (insError) {
      console.error('Error inserting schedule entries:', insError);
      const msg =
        insError && typeof insError === 'object' && 'message' in insError
          ? String((insError as { message: string }).message)
          : '';
      throw new Error(
        msg ? `スケジュールの生成に失敗しました: ${msg}` : 'スケジュールの生成に失敗しました'
      );
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
    time_slot?:
      | { start_time: string; end_time: string }[]
      | { start_time: string; end_time: string };
    student?:
      | { last_name: string; first_name: string }[]
      | { last_name: string; first_name: string };
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
        message: `この講師は ${entryDate} ${slot.start_time?.slice(0, 5)}〜${slot.end_time?.slice(0, 5)} に既に別の授業（${studentName}）があるため、同じ時間帯には登録できません`,
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
  // 過去の日付には登録不可。なぜ登録できないかが分かる明示メッセージを返す（JST基準で判定）。
  const todayJst = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' });
  if (date < todayJst) {
    throw new Error(
      `過去の日付（${date}）には授業を登録できません。今日以降の日付を選んでください。`
    );
  }

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
      // メッセージ自体が「なぜ登録できないか」を説明するので接頭辞は付けない
      throw new Error(studentConflict.message);
    }
    // 集団は「1講師に複数生徒が同じコマ」が前提なので、講師の時間重複チェックはしない
    // （個別だけ講師の二重予約を弾く）。生徒側の重複は集団でも引き続きチェックする。
    if (form.formation !== 'group') {
      const teacherConflict = await checkTeacherTimeConflict(
        form.teacher_id,
        date,
        targetSlot.start_time,
        targetSlot.end_time
      );
      if (teacherConflict) {
        throw new Error(teacherConflict.message);
      }
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
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String((error as { code: string }).code)
        : '';
    if (code === '23505') {
      throw new Error('同じ生徒・講師・コマの組み合わせが既に登録されているため追加できません');
    }
    // それ以外は DB が返した理由をそのまま見せる（過去日付の制約など、原因が分かるように握りつぶさない）
    const detail =
      error && typeof error === 'object' && 'message' in error
        ? String((error as { message: string }).message)
        : '';
    throw new Error(
      detail ? `授業を追加できませんでした：${detail}` : '授業を追加できませんでした'
    );
  }
  return data as ScheduleEntry;
}

/**
 * 講習コマを「担当未決定」で1件配置する（手動の落とし込み用）。
 * 空きセルクリックで生徒を落とし込み、講師は後でマッチング/ドラッグで割り当てる想定。
 * teacher_id NULL で作成するため createScheduleEntry（講師必須）は使わず直接 INSERT する。
 * 配置できない場合は「なぜできないか」が分かるメッセージで throw する。
 */
export async function createKoushuPlacement(
  schoolId: string,
  date: string,
  slotId: string,
  studentId: string,
  subjectIds: string[],
  teacherId: string | null = null,
  // 配置するコマの種別。講習=koushu / テスト対策=test_prep（落とし込みロジックは共通）。
  kind: 'koushu' | 'test_prep' = 'koushu'
): Promise<ScheduleEntry> {
  // 過去日付ガード
  const todayJst = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' });
  if (date < todayJst) {
    throw new Error(`過去の日付（${date}）には配置できません。今日以降の日付を選んでください。`);
  }
  // 生徒の時間重複チェック（同じ時間帯に既に別の授業があれば理由つきで弾く）
  const targetSlot = await getTimeSlotById(slotId);
  if (targetSlot) {
    const studentConflict = await checkStudentTimeConflict(
      studentId,
      new Date(date + 'T12:00:00').getDay(),
      targetSlot.start_time,
      targetSlot.end_time,
      { specificDate: date }
    );
    if (studentConflict) throw new Error(studentConflict.message);
  }

  // 講師指定ありの場合：その講師がこのコマで人数上限に達していないか確認（個別は1講師N名まで）。
  // ※個別は同一講師に複数生徒を持てるので、createScheduleEntry の講師時間重複は使わず容量で判定する。
  if (teacherId) {
    await ensureUserIsTeacher(teacherId);
    const { getClassCapacity, DEFAULT_CLASS_CAPACITY } =
      await import('@/lib/api/school-class-capacity');
    const cap = (await getClassCapacity(schoolId)) ?? DEFAULT_CLASS_CAPACITY;
    const { data: sameTeacher } = await db
      .from('schedule_entries')
      .select('id')
      .eq('school_id', schoolId)
      .eq('entry_date', date)
      .eq('time_slot_id', slotId)
      .eq('teacher_id', teacherId)
      .eq('formation', 'individual')
      .in('status', ['scheduled', 'completed', 'transferred_in']);
    if ((sameTeacher?.length ?? 0) >= cap.max_students_per_teacher_individual) {
      throw new Error(
        `この講師はこのコマで満員です（1講師あたり最大${cap.max_students_per_teacher_individual}名）`
      );
    }
  }

  const { data, error } = await db
    .from('schedule_entries')
    .insert({
      school_id: schoolId,
      entry_date: date,
      time_slot_id: slotId,
      teacher_id: teacherId, // null=担当未決定 / 指定あり=その講師
      student_id: studentId,
      subject_ids: subjectIds || [],
      status: 'scheduled',
      kind,
      formation: 'individual',
    })
    .select()
    .single();

  if (error) {
    console.error('Error creating manual placement:', error);
    const detail =
      error && typeof error === 'object' && 'message' in error
        ? String((error as { message: string }).message)
        : '';
    throw new Error(detail ? `配置できませんでした：${detail}` : '配置できませんでした');
  }
  return data as ScheduleEntry;
}

/**
 * テスト対策コマを1件配置する（増コマ申込の落とし込み用）。
 * 配置ロジックは講習(createKoushuPlacement)と共通で、kind='test_prep' で作る。
 * teacher_id NULL=担当未決定（後でドラッグ/講師カードクリックで割当）。
 */
export async function createTestPrepPlacement(
  schoolId: string,
  date: string,
  slotId: string,
  studentId: string,
  subjectIds: string[],
  teacherId: string | null = null
): Promise<ScheduleEntry> {
  return createKoushuPlacement(
    schoolId,
    date,
    slotId,
    studentId,
    subjectIds,
    teacherId,
    'test_prep'
  );
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

  // teacher_id 等の更新は冪等なので、一過性の通信エラーに備えて1回だけ再試行する。
  const runUpdate = () =>
    db.from('schedule_entries').update(payload).eq('id', id).select().single();
  let { data, error } = await runUpdate();
  if (error) {
    ({ data, error } = await runUpdate());
  }

  if (error) {
    console.error('Error updating schedule entry:', error);
    // DB が返した理由をそのまま見せる（一過性か制約違反かを切り分けられるように握りつぶさない）
    const detail =
      error && typeof error === 'object' && 'message' in error
        ? String((error as { message: string }).message)
        : '';
    throw new Error(detail ? `授業の更新に失敗しました：${detail}` : '授業の更新に失敗しました');
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

  const { error } = await db.from('schedule_entries').update({ status: 'cancelled' }).eq('id', id);

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

/**
 * 当月の振替上限・使用回数を返す。
 *
 * - 上限 = 生徒の通塾日程パターン (schedule_regular_patterns) の有効行数。
 *   「週N回授業がある生徒は月N回まで振替できる」というルール。
 * - 使用 = 当月内に entry_date が含まれる「振替元 (status=transferred_out)」の件数。
 *   schedule_entries.transfer_from_id を辿ると元の月にカウントされるので、
 *   ここでは「振替元エントリ」を月で数える。
 *
 * 戻り値: { limit, used, isExceeded }
 *  - isExceeded: 既に超過しているか (== used > limit)
 *  - すでに上限ぴったりの場合 isExceeded=false、追加振替で +1 すると超過。
 *
 * monthAnchor: 月の判定に使う任意日 (YYYY-MM-DD)。省略時は今日。
 */
export async function getMonthlyTransferUsage(
  studentId: string,
  monthAnchor?: string
): Promise<{ limit: number; used: number; isExceeded: boolean; monthLabel: string }> {
  const anchor = monthAnchor ? new Date(monthAnchor + 'T12:00:00') : new Date();
  const y = anchor.getFullYear();
  const m = anchor.getMonth(); // 0-11
  const monthStart = `${y}-${String(m + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(y, m + 1, 0).getDate();
  const monthEnd = `${y}-${String(m + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  const monthLabel = `${y}年${m + 1}月`;

  // 上限：その生徒の有効な通塾日程パターン数
  const { data: patterns } = await db
    .from('schedule_regular_patterns')
    .select('id')
    .eq('student_id', studentId)
    .eq('is_active', true);
  const limit = (patterns as Array<{ id: string }> | null)?.length ?? 0;

  // 使用：その月内に entry_date が含まれる「振替元」(transferred_out) の件数
  const { data: usedEntries } = await db
    .from('schedule_entries')
    .select('id')
    .eq('student_id', studentId)
    .eq('status', 'transferred_out')
    .gte('entry_date', monthStart)
    .lte('entry_date', monthEnd);
  const used = (usedEntries as Array<{ id: string }> | null)?.length ?? 0;

  return { limit, used, isExceeded: used > limit, monthLabel };
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
// 講師シフトからの「出勤可能講師」自動表示
// ========================================

export interface ShiftAvailability {
  /** day_of_week (0=日, 1=月, ..., 6=土) ごとの「出勤可能な user_profiles.id」一覧 */
  byDayOfWeek: Map<number, string[]>;
  /**
   * 細かい時間帯までマッチさせたい用途向け：
   *   キー: `${day_of_week}|${time_slot_label}` （例: "1|14:00-15:30"）
   *   値: その曜日・時間帯に出勤可能な user_profiles.id 配列
   */
  byDayAndSlot: Map<string, string[]>;
}

/** 教室の講師 display_name → user_id（同名が2人以上いる名前は除外） */
function buildTeacherNameIndex(
  teachers: { id: string; display_name: string | null }[]
): Map<string, string> {
  const counts = new Map<string, number>();
  const firstId = new Map<string, string>();
  for (const t of teachers) {
    const key = normalizePersonName(t.display_name);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (!firstId.has(key)) firstId.set(key, t.id);
  }
  const result = new Map<string, string>();
  firstId.forEach((id, key) => {
    if (counts.get(key) === 1) result.set(key, id);
  });
  return result;
}

/**
 * 通常シフト提出から「出勤可能な講師の (曜日 / 時間帯)」を集約して返す。
 *
 * 提出 → user_profiles.id の解決順:
 *  1. regular_shift_submissions.user_id（管理画面で紐づけ済み）
 *  2. teacher_email ↔ user_profiles.email（大文字小文字無視）
 *  3. 同一教室の teacher_name ↔ display_name（空白除去後の完全一致、同名は除外）
 *
 * 対象:
 *  - status='published' のシフト設定を集約。
 *  - 同じ school_id に複数 published があれば全部 union。
 */
export async function getShiftAvailableTeachers(schoolId: string): Promise<ShiftAvailability> {
  // 1. published な setting を全部取得
  const { data: settings, error: setErr } = await db
    .from('regular_shift_settings')
    .select('id')
    .eq('school_id', schoolId)
    .eq('status', 'published');
  if (setErr) {
    console.warn('getShiftAvailableTeachers: settings fetch error', setErr);
    return { byDayOfWeek: new Map(), byDayAndSlot: new Map() };
  }
  const settingIds = ((settings || []) as { id: string }[]).map((s) => s.id);
  if (settingIds.length === 0) return { byDayOfWeek: new Map(), byDayAndSlot: new Map() };

  // 2. 提出ヘッダを取得
  const { data: subs, error: subErr } = await db
    .from('regular_shift_submissions')
    .select('id, teacher_email, teacher_name, user_id, school_id')
    .in('setting_id', settingIds);
  if (subErr) {
    console.warn('getShiftAvailableTeachers: submissions fetch error', subErr);
    return { byDayOfWeek: new Map(), byDayAndSlot: new Map() };
  }
  const submissions = (subs || []) as {
    id: string;
    teacher_email: string | null;
    teacher_name: string;
    user_id: string | null;
    school_id: string;
  }[];
  if (submissions.length === 0) return { byDayOfWeek: new Map(), byDayAndSlot: new Map() };

  // 3. メアド逆引き
  const emails = Array.from(
    new Set(submissions.map((s) => s.teacher_email?.toLowerCase()).filter((e): e is string => !!e))
  );
  const emailToUserId = new Map<string, string>();
  if (emails.length > 0) {
    const { data: users } = await db.from('user_profiles').select('id, email').in('email', emails);
    for (const u of (users || []) as { id: string; email: string }[]) {
      if (u.email) emailToUserId.set(u.email.toLowerCase(), u.id);
    }
  }

  // 4. 教室の講師一覧（氏名フォールバック用）
  const { data: schoolLinks } = await db
    .from('user_schools')
    .select('user_id')
    .eq('school_id', schoolId);
  const schoolUserIds = ((schoolLinks || []) as { user_id: string }[]).map((r) => r.user_id);
  let nameToUserId = new Map<string, string>();
  if (schoolUserIds.length > 0) {
    const { data: schoolTeachers } = await db
      .from('user_profiles')
      .select('id, display_name')
      .in('id', schoolUserIds)
      .eq('role', 'teacher')
      .eq('is_active', true);
    nameToUserId = buildTeacherNameIndex(
      (schoolTeachers || []) as { id: string; display_name: string | null }[]
    );
  }

  // 5. submission_id → user_id
  const submissionToUserId = new Map<string, string>();
  for (const s of submissions) {
    if (s.user_id) {
      submissionToUserId.set(s.id, s.user_id);
      continue;
    }
    const byEmail = s.teacher_email ? emailToUserId.get(s.teacher_email.toLowerCase()) : undefined;
    if (byEmail) {
      submissionToUserId.set(s.id, byEmail);
      continue;
    }
    const byName = nameToUserId.get(normalizePersonName(s.teacher_name));
    if (byName) submissionToUserId.set(s.id, byName);
  }

  // 6. 該当 submission の available スロット全部取得
  const submissionIds = Array.from(submissionToUserId.keys());
  if (submissionIds.length === 0) return { byDayOfWeek: new Map(), byDayAndSlot: new Map() };

  const { data: slots } = await db
    .from('regular_shift_submission_slots')
    .select('submission_id, day_of_week, time_slot, available')
    .in('submission_id', submissionIds)
    .eq('available', true);

  // 6. (曜日) と (曜日|時間帯) で集約
  const byDayOfWeek = new Map<number, Set<string>>();
  const byDayAndSlot = new Map<string, Set<string>>();
  for (const s of (slots || []) as {
    submission_id: string;
    day_of_week: number;
    time_slot: string;
  }[]) {
    const uid = submissionToUserId.get(s.submission_id);
    if (!uid) continue;
    if (!byDayOfWeek.has(s.day_of_week)) byDayOfWeek.set(s.day_of_week, new Set());
    byDayOfWeek.get(s.day_of_week)!.add(uid);
    const key = `${s.day_of_week}|${s.time_slot}`;
    if (!byDayAndSlot.has(key)) byDayAndSlot.set(key, new Set());
    byDayAndSlot.get(key)!.add(uid);
  }

  // Set → Array 化
  const dayResult = new Map<number, string[]>();
  for (const [k, v] of Array.from(byDayOfWeek.entries())) dayResult.set(k, Array.from(v));
  const slotResult = new Map<string, string[]>();
  for (const [k, v] of Array.from(byDayAndSlot.entries())) slotResult.set(k, Array.from(v));

  return { byDayOfWeek: dayResult, byDayAndSlot: slotResult };
}

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
      '*, time_slot:schedule_time_slots(*), student:students(id, last_name, first_name, grade, preferred_teacher_gender, fixed_teacher_ids, excluded_teacher_ids), teacher:user_profiles!schedule_entries_teacher_id_fkey(id, display_name, email)'
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
    student?:
      | { id: string; last_name: string; first_name: string; grade: number }[]
      | { id: string; last_name: string; first_name: string; grade: number };
    teacher?:
      | { id: string; display_name: string | null; email: string | null }[]
      | { id: string; display_name: string | null; email: string | null };
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
    for (const e of (entries || []) as {
      entry_date: string;
      time_slot_id: string;
      student_id: string;
    }[]) {
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
