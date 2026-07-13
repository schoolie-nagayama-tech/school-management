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
// Phase A: 形態キーの直書きを定数参照に置換。lane_type ベース判定は isGroupLane を使う。
import { INDIVIDUAL_FORMATION } from '@/types/schedule';
import type { HalfPosition } from '@/types/schedule';
import { isGroupLane } from '@/lib/utils/formations';
// Phase R: 個別の席占有（1対1/1対2・45分半コマ）
import {
  computeEffectiveTimeRange,
  canPlaceEntry,
  type SeatEntryInput,
} from '@/lib/utils/seatOccupancy';
import { getClassCapacity, DEFAULT_CLASS_CAPACITY } from '@/lib/api/school-class-capacity';

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
      formation: form.formation ?? INDIVIDUAL_FORMATION,
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
    // Phase R: 追加しようとしているコマの実効時間帯を絞るための半コマ情報。
    // 未指定なら (startTime,endTime) をそのまま使う＝コマ丸ごと＝既存挙動不変。
    durationMinutes?: number | null;
    halfPosition?: HalfPosition;
  }
): Promise<TimeConflictResult | null> {
  const excludePatternId = options?.excludeRegularPatternId;
  const excludeEntryId = options?.excludeScheduleEntryId;
  const specificDate = options?.specificDate;
  // Phase R: 追加側の実効時間帯（前半/後半なら45分に絞る。全コマなら (startTime,endTime)）。
  const incoming = computeEffectiveTimeRange(
    startTime,
    endTime,
    options?.durationMinutes ?? null,
    options?.halfPosition ?? null
  );

  if (specificDate) {
    // 特定日の schedule_entries をチェック
    const { data: entries, error } = await db
      .from('schedule_entries')
      .select(
        'id, entry_date, time_slot_id, teacher_id, subject_ids, duration_minutes, half_position, time_slot:schedule_time_slots(start_time, end_time), teacher:user_profiles(display_name, email)'
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
      // Phase R: 既存エントリ側も半コマなら実効時間帯に絞る（前半45と後半45は重ならない）。
      const rowEff = computeEffectiveTimeRange(st, et, row.duration_minutes, row.half_position);
      if (timeRangesOverlap(incoming.start, incoming.end, rowEff.start, rowEff.end)) {
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
      'id, day_of_week, time_slot_id, teacher_id, duration_minutes, half_position, time_slot:schedule_time_slots(start_time, end_time), teacher:user_profiles(display_name, email)'
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
    duration_minutes: number | null;
    half_position: HalfPosition;
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
    // Phase R: 既存パターン側も半コマなら実効時間帯に絞って比較。
    const rowEff = computeEffectiveTimeRange(st, et, row.duration_minutes, row.half_position);
    if (timeRangesOverlap(incoming.start, incoming.end, rowEff.start, rowEff.end)) {
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
      timeSlot.end_time,
      // Phase R: 半コマ授業なら実効時間帯で重複判定（前半45/後半45を別コマ扱いにする）。
      { durationMinutes: form.duration_minutes ?? null, halfPosition: form.half_position ?? null }
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
      formation: form.formation ?? INDIVIDUAL_FORMATION,
      // Phase R: 指導比率・半コマ。未指定は ratio=2・全コマ（既存挙動不変）。
      ratio: form.ratio ?? 2,
      duration_minutes: form.duration_minutes ?? null,
      half_position: form.half_position ?? null,
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
      formation: form.formation ?? INDIVIDUAL_FORMATION,
      // Phase R: 指導比率・半コマも指定日から切り替えられる（1対2→1対1 等）。未指定は据え置きの既定。
      ratio: form.ratio ?? 2,
      duration_minutes: form.duration_minutes ?? null,
      half_position: form.half_position ?? null,
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
  // Phase T: 体験の見込み客（student を持たない行）向けに inquiry リレーションも取得する。
  const selectWithJoins =
    '*, time_slot:schedule_time_slots(*), student:students(id, last_name, first_name, grade, preferred_teacher_gender, fixed_teacher_ids, excluded_teacher_ids), teacher:user_profiles!schedule_entries_teacher_id_fkey(id, display_name, last_name, email), inquiry:inquiries(id, student_name, student_name_kana, grade)';
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

  type InquiryRel = {
    id: string;
    student_name: string | null;
    student_name_kana: string | null;
    grade: string | null;
  };
  const rows = (result.data || []) as (ScheduleEntry & {
    time_slot?: ScheduleTimeSlot[] | ScheduleTimeSlot;
    student?:
      | { id: string; last_name: string; first_name: string; grade: number }[]
      | { id: string; last_name: string; first_name: string; grade: number };
    teacher?:
      | { id: string; display_name: string | null; email: string | null }[]
      | { id: string; display_name: string | null; email: string | null };
    inquiry?: InquiryRel[] | InquiryRel | null;
  })[];
  return rows.map((r) => ({
    ...r,
    time_slot: Array.isArray(r.time_slot) ? r.time_slot[0] : r.time_slot,
    student: Array.isArray(r.student) ? r.student[0] : r.student,
    teacher: Array.isArray(r.teacher) ? r.teacher[0] : r.teacher,
    // Phase T: PostgREST は 1:1 リレーションも配列で返すことがあるため単一化する。
    inquiry: Array.isArray(r.inquiry) ? (r.inquiry[0] ?? null) : (r.inquiry ?? null),
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
    // 種別（regular/koushu）と形態。
    // 通塾日程からの生成は常に regular。formation はパターン側 p.formation を引き継ぐ。
    // Phase A: 形態は動的マスタ化したため union ではなく string。
    kind: 'regular' | 'koushu';
    formation: string;
    // Phase R: 指導比率・授業時間・半コマもパターンからスナップショット継承する。
    ratio: 1 | 2;
    duration_minutes: number | null;
    half_position: HalfPosition;
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
        formation: p.formation ?? INDIVIDUAL_FORMATION,
        // Phase R: ratio/duration/half をパターンから継承。既存パターンは ratio=2・全コマなので挙動不変。
        ratio: p.ratio ?? 2,
        duration_minutes: p.duration_minutes ?? null,
        half_position: p.half_position ?? null,
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
  options?: {
    excludeScheduleEntryId?: string;
    // Phase R: 追加側の半コマ情報。未指定ならコマ丸ごと＝既存挙動不変。
    durationMinutes?: number | null;
    halfPosition?: HalfPosition;
    // Phase R: このコマ(time_slot_id)の重複は除外する。同一コマ内の複数生徒（1対2・半コマ順次）は
    // 容量計算(computeSeatOccupancy)側で扱うため、講師の「別コマとの物理重複」だけをここで弾く用途。
    excludeSlotId?: string;
  }
): Promise<TimeConflictResult | null> {
  const excludeEntryId = options?.excludeScheduleEntryId;
  const incoming = computeEffectiveTimeRange(
    startTime,
    endTime,
    options?.durationMinutes ?? null,
    options?.halfPosition ?? null
  );

  const { data: entries, error } = await db
    .from('schedule_entries')
    .select(
      'id, entry_date, time_slot_id, student_id, duration_minutes, half_position, time_slot:schedule_time_slots(start_time, end_time), student:students(last_name, first_name)'
    )
    .eq('teacher_id', teacherId)
    .eq('entry_date', entryDate)
    .in('status', ['scheduled', 'completed', 'transferred_in']);

  if (error || !entries?.length) return null;

  for (const row of entries as Array<{
    id: string;
    time_slot_id: string;
    student_id: string;
    duration_minutes: number | null;
    half_position: HalfPosition;
    time_slot?:
      | { start_time: string; end_time: string }[]
      | { start_time: string; end_time: string };
    student?:
      | { last_name: string; first_name: string }[]
      | { last_name: string; first_name: string };
  }>) {
    if (row.id === excludeEntryId) continue;
    // 同一コマは容量計算に委譲するので、ここではスキップ（別コマとの物理重複のみ判定）。
    if (options?.excludeSlotId && row.time_slot_id === options.excludeSlotId) continue;
    const slot = Array.isArray(row.time_slot) ? row.time_slot[0] : row.time_slot;
    const student = Array.isArray(row.student) ? row.student[0] : row.student;
    if (!slot) continue;
    const rowEff = computeEffectiveTimeRange(
      slot.start_time ?? '',
      slot.end_time ?? '',
      row.duration_minutes,
      row.half_position
    );
    if (timeRangesOverlap(incoming.start, incoming.end, rowEff.start, rowEff.end)) {
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

  // Phase T: 体験の見込み客（未入会）は inquiry_id で参照し student_id を持たない。
  // 見込み客は他コマを持たない＝生徒重複チェックの対象外、席占有もハードブロックしない
  //（体験は例外扱い）。よって時刻重複・容量チェックを丸ごとスキップする。
  // 講師確認（ensureUserIsTeacher）は上で実施済み＝維持。
  const isInquiryTrial = !!form.inquiry_id && !form.student_id;

  // 同時刻重複チェック：個別と集団でコマ時間が違っても、時刻範囲が重なれば配置不可
  const targetSlot = await getTimeSlotById(slotId);
  const incomingHalf = form.half_position ?? null;
  const incomingDuration = form.duration_minutes ?? null;
  const incomingRatio: 1 | 2 = form.ratio === 1 ? 1 : 2;
  // form.student_id を条件に含めることで、以降のブロック内では student_id が string に絞られる
  //（inquiry 経路は上でスキップ済み・既存の生徒経路は挙動不変）。
  if (targetSlot && form.student_id && !isInquiryTrial) {
    const studentConflict = await checkStudentTimeConflict(
      form.student_id,
      // dayOfWeek は specificDate を渡せば使われないが、型上必須なので date から計算
      new Date(date + 'T12:00:00').getDay(),
      targetSlot.start_time,
      targetSlot.end_time,
      // Phase R: 半コマなら実効時間帯で判定（前半45と後半45を別枠扱い）。
      { specificDate: date, durationMinutes: incomingDuration, halfPosition: incomingHalf }
    );
    if (studentConflict) {
      // メッセージ自体が「なぜ登録できないか」を説明するので接頭辞は付けない
      throw new Error(studentConflict.message);
    }
    // group レーン（集団・小集団・プログラミング等）は「1講師に複数生徒が同じコマ」が前提なので、
    // 講師の重複チェックはしない（生徒側の重複だけ全形態でチェック済み）。
    // Phase A: 'group' 直値ではなく lane_type ベース判定。
    if (!isGroupLane(form.formation ?? INDIVIDUAL_FORMATION)) {
      // Phase R: 個別は「1講師に最大N名（1対2）＋45分の前後半詰め」を許すため、
      // 同一コマは席占有(computeSeatOccupancy)で、別コマとの物理重複は checkTeacherTimeConflict で判定する。
      // (a) 同一（講師×日付×コマ）の席が空いているか
      const { data: sameSlotRows } = await db
        .from('schedule_entries')
        .select('ratio, half_position')
        .eq('school_id', schoolId)
        .eq('entry_date', date)
        .eq('time_slot_id', slotId)
        .eq('teacher_id', form.teacher_id)
        .eq('formation', INDIVIDUAL_FORMATION)
        .in('status', ['scheduled', 'completed', 'transferred_in']);
      const existingSeats: SeatEntryInput[] = (
        (sameSlotRows ?? []) as Array<{ ratio: number | null; half_position: HalfPosition }>
      ).map((r) => ({
        ratio: r.ratio === 1 ? 1 : 2,
        halfPosition: r.half_position ?? null,
      }));
      const cap = (await getClassCapacity(schoolId)) ?? DEFAULT_CLASS_CAPACITY;
      const canPlace = canPlaceEntry(
        existingSeats,
        { ratio: incomingRatio, halfPosition: incomingHalf },
        cap.max_students_per_teacher_individual
      );
      if (!canPlace) {
        throw new Error(
          existingSeats.some((s) => s.ratio === 1)
            ? 'この講師のこのコマは1対1授業のため、他の生徒を追加できません'
            : `この講師はこのコマで満席です（1講師あたり最大${cap.max_students_per_teacher_individual}名／45分は前後半で1席共有）`
        );
      }
      // (b) 別コマとの物理的な時間重複（例: 個別19:30-21:00 と別コマ20:20-21:20）。同一コマは除外。
      const teacherConflict = await checkTeacherTimeConflict(
        form.teacher_id,
        date,
        targetSlot.start_time,
        targetSlot.end_time,
        {
          durationMinutes: incomingDuration,
          halfPosition: incomingHalf,
          excludeSlotId: slotId,
        }
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
      // Phase T: 体験×問合せは student_id=NULL / inquiry_id=値。既存経路は student_id のみ（inquiry_id=NULL）。
      student_id: form.student_id ?? null,
      inquiry_id: form.inquiry_id ?? null,
      subject_ids: form.subject_ids || [],
      seat_label: form.seat_label || null,
      note: form.note || null,
      regular_pattern_id: options?.regular_pattern_id ?? null,
      status: options?.status ?? 'scheduled',
      // 種別・形態：未指定なら DB デフォルト (regular / individual) が入る。
      // 講習コマを手動配置する場合は呼び出し側で kind='koushu' を渡す。
      // 集団コマを作る場合は formation='group' を渡す。
      kind: form.kind ?? 'regular',
      formation: form.formation ?? INDIVIDUAL_FORMATION,
      // Phase R: 指導比率・半コマ。未指定は ratio=2・全コマ（既存挙動不変）。
      ratio: incomingRatio,
      duration_minutes: incomingDuration,
      half_position: incomingHalf,
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
    const cap = (await getClassCapacity(schoolId)) ?? DEFAULT_CLASS_CAPACITY;
    const { data: sameTeacher } = await db
      .from('schedule_entries')
      .select('id')
      .eq('school_id', schoolId)
      .eq('entry_date', date)
      .eq('time_slot_id', slotId)
      .eq('teacher_id', teacherId)
      // 講習・テスト対策の落とし込みは個別のみ対象なので individual 固定で数える（現状維持が正しい）
      .eq('formation', INDIVIDUAL_FORMATION)
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
      // 講習・テスト対策の落とし込みは個別レーン固定（集団は別経路）
      formation: INDIVIDUAL_FORMATION,
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

/**
 * Phase P2: 授業追加（追加授業 / 体験授業）の座席表配置用の1コマ登録。
 *
 * 「授業を追加」モーダルの Step1 を確定後、座席表のセル/講師カードをクリックするたびに呼ばれる。
 * - teacherId 指定あり（講師カードクリック）: createScheduleEntry に委譲し、
 *   生徒重複・容量チェック・体験×問合せ(inquiry XOR)・比率/半コマを既存ロジックで処理する。
 * - teacherId=null（セル背景クリック=担当未決定）: createScheduleEntry は講師必須のため使えず、
 *   ここで直接 INSERT する。生徒重複だけチェック（見込み客=inquiry はスキップ）。
 */
export async function createLessonPlacement(
  schoolId: string,
  date: string,
  slotId: string,
  opts: {
    /** 既存生徒（追加授業 / 体験×既存生徒）。見込み客のときは null。 */
    studentId?: string | null;
    /** 体験の見込み客（問合せ）。studentId と排他。 */
    inquiryId?: string | null;
    subjectIds: string[];
    /** 講師。null=担当未決定（セル背景クリック）。 */
    teacherId?: string | null;
    /** 授業種別。追加授業='additional' / 体験='trial'。 */
    kind: 'additional' | 'trial';
    ratio?: 1 | 2;
    durationMinutes?: number | null;
    halfPosition?: HalfPosition;
  }
): Promise<ScheduleEntry> {
  // 講師指定あり: createScheduleEntry に委譲（重複・容量・inquiry XOR・比率/半コマを再利用）
  if (opts.teacherId) {
    return createScheduleEntry(schoolId, date, slotId, {
      teacher_id: opts.teacherId,
      student_id: opts.studentId ?? undefined,
      inquiry_id: opts.inquiryId ?? null,
      subject_ids: opts.subjectIds,
      seat_label: '',
      note: '',
      kind: opts.kind,
      formation: INDIVIDUAL_FORMATION,
      ratio: opts.ratio,
      duration_minutes: opts.durationMinutes ?? null,
      half_position: opts.halfPosition ?? null,
    });
  }

  // 担当未決定（teacher null）: 過去日ガード＋生徒重複チェック後に直接 INSERT。
  const todayJst = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' });
  if (date < todayJst) {
    throw new Error(`過去の日付（${date}）には配置できません。今日以降の日付を選んでください。`);
  }
  // 見込み客（inquiry のみ）は他コマを持たない＝重複チェック対象外（体験は例外扱い）。
  const isInquiry = !!opts.inquiryId && !opts.studentId;
  const targetSlot = await getTimeSlotById(slotId);
  if (targetSlot && opts.studentId && !isInquiry) {
    const studentConflict = await checkStudentTimeConflict(
      opts.studentId,
      new Date(date + 'T12:00:00').getDay(),
      targetSlot.start_time,
      targetSlot.end_time,
      {
        specificDate: date,
        durationMinutes: opts.durationMinutes ?? null,
        halfPosition: opts.halfPosition ?? null,
      }
    );
    if (studentConflict) throw new Error(studentConflict.message);
  }

  const { data, error } = await db
    .from('schedule_entries')
    .insert({
      school_id: schoolId,
      entry_date: date,
      time_slot_id: slotId,
      teacher_id: null, // 担当未決定
      // 体験×問合せは student_id=NULL / inquiry_id=値（DB の XOR CHECK 準拠）
      student_id: opts.studentId ?? null,
      inquiry_id: opts.inquiryId ?? null,
      subject_ids: opts.subjectIds || [],
      status: 'scheduled',
      kind: opts.kind,
      formation: INDIVIDUAL_FORMATION,
      ratio: opts.ratio === 1 ? 1 : 2,
      duration_minutes: opts.durationMinutes ?? null,
      half_position: opts.halfPosition ?? null,
    })
    .select()
    .single();

  if (error) {
    console.error('Error creating lesson placement:', error);
    const detail =
      error && typeof error === 'object' && 'message' in error
        ? String((error as { message: string }).message)
        : '';
    throw new Error(detail ? `配置できませんでした：${detail}` : '配置できませんでした');
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

// ========================================
// 生徒の入れ替え（同コマ内・別講師）— §2.12
// ========================================

/** 入れ替え検証に使うエントリの最小形（純関数テスト用に DB 非依存で切り出す）。 */
export interface SwapEntryData {
  id: string;
  school_id: string;
  entry_date: string;
  time_slot_id: string;
  teacher_id: string | null;
  student_id: string | null;
  subject_ids: string[] | null;
  status: string;
}

/** 入れ替え検証に使う講師の最小形。teachable_subject_ids が空/未設定なら全科目可（既存慣習）。 */
export interface SwapTeacherData {
  id: string;
  name: string;
  teachable_subject_ids: string[] | null | undefined;
}

/**
 * 講師が対象コマの科目を指導できるか。
 * teachable が空/未設定なら全科目可。subject_ids が空なら制約なし＝可。
 * 既存 D&D（TeacherCard）と同じく「1つでも指導可能な科目があれば可（some）」で判定する。
 */
function teacherCanTeachSubjects(
  teachable: string[] | null | undefined,
  subjectIds: string[] | null
): boolean {
  if (!teachable || teachable.length === 0) return true;
  if (!subjectIds || subjectIds.length === 0) return true;
  const set = new Set(teachable);
  return subjectIds.some((sid) => set.has(sid));
}

/**
 * 入れ替えの検証（純関数・DB非依存）。違反時は分かりやすい日本語エラーを throw。
 *
 * 検証順序（先に失敗するものほど基本的な前提）:
 *  1. 同一エントリ同士でない
 *  2. 同一 school_id
 *  3. 同一 entry_date かつ 同一 time_slot_id（＝同じ日・同じコマ）
 *  4. 両方 teacher_id が非NULL
 *  5. teacher_id が互いに異なる（別講師）
 *  6. 両方 status が cancelled/transferred_out でない（振替元・取消は対象外）
 *  7. teachable 双方向: 受け入れ側 T_B が A の科目を、T_A が B の科目を指導できる
 *
 * teacherA/teacherB は entryA/entryB の現担当講師（入れ替え後の受け入れ側は逆になる）。
 */
export function validateSwapEntries(
  entryA: SwapEntryData,
  entryB: SwapEntryData,
  teacherA: SwapTeacherData,
  teacherB: SwapTeacherData,
  subjectNameById: Map<string, string>
): void {
  if (entryA.id === entryB.id) {
    throw new Error('同じ授業同士は入れ替えできません');
  }
  if (entryA.school_id !== entryB.school_id) {
    throw new Error('別の教室の授業とは入れ替えできません');
  }
  if (entryA.entry_date !== entryB.entry_date || entryA.time_slot_id !== entryB.time_slot_id) {
    throw new Error('入れ替えは同じ日・同じコマの授業同士でのみできます');
  }
  if (!entryA.teacher_id || !entryB.teacher_id) {
    throw new Error('担当講師が未決定の授業は入れ替えできません');
  }
  if (entryA.teacher_id === entryB.teacher_id) {
    throw new Error('同じ講師の授業同士は入れ替えできません');
  }
  const cannotSwapStatus = (s: string) => s === 'cancelled' || s === 'transferred_out';
  if (cannotSwapStatus(entryA.status) || cannotSwapStatus(entryB.status)) {
    throw new Error('取消・振替元の授業は入れ替えできません');
  }

  const subjLabel = (ids: string[] | null) =>
    (ids ?? []).map((id) => subjectNameById.get(id) ?? id).join('・') || '担当科目';

  // 受け入れ側 T_B は A の生徒（＝Aの科目）を担当することになるので、A の科目を指導できる必要がある。
  if (!teacherCanTeachSubjects(teacherB.teachable_subject_ids, entryA.subject_ids)) {
    throw new Error(
      `${teacherB.name}は${subjLabel(entryA.subject_ids)}を指導できないため入れ替えできません`
    );
  }
  // 逆方向: T_A は B の科目を指導できる必要がある。
  if (!teacherCanTeachSubjects(teacherA.teachable_subject_ids, entryB.subject_ids)) {
    throw new Error(
      `${teacherA.name}は${subjLabel(entryB.subject_ids)}を指導できないため入れ替えできません`
    );
  }
}

/**
 * 生徒の入れ替え（§2.12）。同じ日・同じコマ・別講師の2エントリの teacher_id を交換する。
 * 時間は変わらず担当講師だけが入れ替わる（同コマ内のみ）。
 *
 * UNIQUE(school_id, entry_date, time_slot_id, teacher_id, student_id) との衝突回避:
 *   A(student_a, T_A) と B(student_b, T_B) を交換する。student_a ≠ student_b なので
 *   1回目の UPDATE で A→T_B にした時点でも (T_B, student_a) と既存 (T_B, student_b) は
 *   student が異なり衝突しない。2回目で B→T_A にしても同様。よって順次 UPDATE で安全
 *   （中間状態でユニークキーが重複しない）。
 */
export async function swapScheduleEntries(entryAId: string, entryBId: string): Promise<void> {
  const { data: rows, error } = await db
    .from('schedule_entries')
    .select('id, school_id, entry_date, time_slot_id, teacher_id, student_id, subject_ids, status')
    .in('id', [entryAId, entryBId]);
  if (error || !rows || rows.length !== 2) {
    console.error('Error fetching entries for swap:', error);
    throw new Error('入れ替え対象の授業の取得に失敗しました');
  }
  const list = rows as SwapEntryData[];
  const a = list.find((r) => r.id === entryAId);
  const b = list.find((r) => r.id === entryBId);
  if (!a || !b) {
    throw new Error('入れ替え対象の授業の取得に失敗しました');
  }

  // 担当講師のプロファイル（指導可能科目・表示名）を取得。
  const teacherIds = [a.teacher_id, b.teacher_id].filter((id): id is string => !!id);
  const { data: profiles } = await db
    .from('user_profiles')
    .select('id, display_name, email, teachable_subject_ids')
    .in('id', teacherIds);
  const profileById = new Map<
    string,
    { display_name?: string; email?: string; teachable_subject_ids?: string[] | null }
  >(
    (
      (profiles ?? []) as Array<{
        id: string;
        display_name?: string;
        email?: string;
        teachable_subject_ids?: string[] | null;
      }>
    ).map((p) => [p.id, p])
  );
  const toTeacher = (id: string | null): SwapTeacherData => {
    const p = id ? profileById.get(id) : undefined;
    return {
      id: id ?? '',
      name: p?.display_name || p?.email || '講師',
      teachable_subject_ids: p?.teachable_subject_ids ?? null,
    };
  };

  // メッセージ用の科目名。両エントリの subject_ids をまとめて解決する。
  const subjIds = Array.from(new Set([...(a.subject_ids ?? []), ...(b.subject_ids ?? [])]));
  const subjectNameById = new Map<string, string>();
  if (subjIds.length > 0) {
    const { data: subs } = await db.from('subjects').select('id, name').in('id', subjIds);
    for (const s of (subs ?? []) as Array<{ id: string; name: string }>) {
      subjectNameById.set(s.id, s.name);
    }
  }

  // 検証（違反時は throw）。
  validateSwapEntries(a, b, toTeacher(a.teacher_id), toTeacher(b.teacher_id), subjectNameById);

  // teacher_id を交換する2回の UPDATE。上のコメントの根拠により順次でも UNIQUE 衝突しない。
  const { error: e1 } = await db
    .from('schedule_entries')
    .update({ teacher_id: b.teacher_id })
    .eq('id', a.id);
  if (e1) {
    console.error('Error swapping entry A:', e1);
    throw new Error('入れ替えに失敗しました');
  }
  const { error: e2 } = await db
    .from('schedule_entries')
    .update({ teacher_id: a.teacher_id })
    .eq('id', b.id);
  if (e2) {
    console.error('Error swapping entry B:', e2);
    // 2回目が失敗したら1回目を元に戻し、両者が同じ講師になる不整合を避ける。
    await db.from('schedule_entries').update({ teacher_id: a.teacher_id }).eq('id', a.id);
    throw new Error('入れ替えに失敗しました');
  }
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

/**
 * Phase P2: 振替の「保留（プール入り）」。
 * 元エントリを transferred_out にして振替期限だけ設定する（transfer_to_id は張らない＝振替先未定）。
 * createTransferEntry の前半を切り出したもので、保留プールの入口としても使う。
 * 既に transferred_out なら二重処理せず no-op（期限も上書きしない）。
 *
 * @param schoolId シグネチャ統一のため受けるが、id が一意なので更新自体には使わない。
 */
export async function holdTransfer(schoolId: string, fromEntryId: string): Promise<void> {
  void schoolId;
  const { data: srcRow, error: srcErr } = await db
    .from('schedule_entries')
    .select('entry_date, status')
    .eq('id', fromEntryId)
    .single();
  if (srcErr || !srcRow) {
    console.error('Error fetching transfer source (hold):', srcErr);
    throw new Error('振替元の取得に失敗しました');
  }
  const row = srcRow as { entry_date: string; status: string };
  // 既に振替元化されている場合は何もしない（保留の再登録で期限を上書きしないため）
  if (row.status === 'transferred_out') return;
  const deadline = calcTransferDeadline(row.entry_date);
  const { error: updateErr } = await db
    .from('schedule_entries')
    .update({
      status: 'transferred_out',
      // 振替期限：元授業日の翌月末日。空きコマで未消化のままだと督促対象になる
      transfer_deadline: deadline,
    })
    .eq('id', fromEntryId);
  if (updateErr) {
    console.error('Error holding transfer source:', updateErr);
    throw new Error('振替元の更新に失敗しました');
  }
}

/**
 * Phase P2: 保留中（または通常フローの）振替を確定する。
 * 振替先を transferred_in で作成し、元エントリと相互リンクする。createTransferEntry の後半を切り出したもの。
 * targetTeacherId=null で「担当未決定の振替」も作れる（保留プールからの配置で講師を後回しにできる）。
 * targetTeacherId 指定時のみ講師ロール検証を行う（null 時はスキップ）。
 */
export async function completeHeldTransfer(
  schoolId: string,
  fromEntryId: string,
  targetDate: string,
  targetSlotId: string,
  targetTeacherId: string | null,
  seatLabel?: string | null
): Promise<{ from: ScheduleEntry; to: ScheduleEntry }> {
  // 担当未決定(null)のときは講師検証をスキップ。指定ありなら従来どおり teacher ロールを確認する。
  if (targetTeacherId) await ensureUserIsTeacher(targetTeacherId);

  // 振替元の全カラムを取得（比率・半コマ・形態などを振替先へ引き継ぐため）
  const { data: fromRow, error: fromErr } = await db
    .from('schedule_entries')
    .select('*')
    .eq('id', fromEntryId)
    .single();
  if (fromErr || !fromRow) {
    console.error('Error fetching transfer source (complete):', fromErr);
    throw new Error('振替元の取得に失敗しました');
  }
  const fromEntry = fromRow as ScheduleEntry;

  const { data: toRow, error: insertErr } = await db
    .from('schedule_entries')
    .insert({
      school_id: schoolId,
      entry_date: targetDate,
      time_slot_id: targetSlotId,
      teacher_id: targetTeacherId, // null=担当未決定 / 指定あり=その講師
      student_id: fromEntry.student_id,
      subject_ids: fromEntry.subject_ids || [],
      seat_label: seatLabel ?? fromEntry.seat_label,
      note: fromEntry.note,
      regular_pattern_id: fromEntry.regular_pattern_id,
      status: 'transferred_in',
      transfer_from_id: fromEntryId,
      // 形態も引き継ぐ（形態ボードの振替先が個別ボードに化けるのを防ぐ）。
      // 未設定なら DB デフォルト individual だが、明示継承で形態タブ内の振替を正しく表示する。
      formation: fromEntry.formation ?? INDIVIDUAL_FORMATION,
      // Phase R: 指導比率・半コマは振替先にも引き継ぐ（45分/1対1が全コマ1対2に化けないように）。
      ratio: fromEntry.ratio ?? 2,
      duration_minutes: fromEntry.duration_minutes ?? null,
      half_position: fromEntry.half_position ?? null,
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
    // 時刻ラベルを冗長で残す（後でエントリが消えても情報を保持）。
    // select('*') では time_slot リレーションが無いので元コマの時刻は別途引く。
    const { data: srcSlot } = await db
      .from('schedule_time_slots')
      .select('start_time, end_time')
      .eq('id', fromEntry.time_slot_id)
      .maybeSingle();
    const fromSlotLabel = srcSlot
      ? `${(srcSlot as { start_time: string }).start_time?.slice(0, 5)}〜${(srcSlot as { end_time: string }).end_time?.slice(0, 5)}`
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
 * 振替: 元を transferred_out にし、振替先を transferred_in で作成し相互リンク。
 *
 * Phase P2 で内部を holdTransfer(前半) + completeHeldTransfer(後半) の2段に分割したが、
 * 外部シグネチャ（targetTeacherId は必須 string）と成功時の挙動は不変：
 *   holdTransfer が元を transferred_out＋期限化 → completeHeldTransfer が振替先作成＋リンク＋通知。
 * teacher ロール検証は completeHeldTransfer 内（targetTeacherId 非null時）で従来どおり実施される。
 */
export async function createTransferEntry(
  schoolId: string,
  fromEntryId: string,
  targetDate: string,
  targetSlotId: string,
  targetTeacherId: string,
  seatLabel?: string | null
): Promise<{ from: ScheduleEntry; to: ScheduleEntry }> {
  await holdTransfer(schoolId, fromEntryId);
  return completeHeldTransfer(
    schoolId,
    fromEntryId,
    targetDate,
    targetSlotId,
    targetTeacherId,
    seatLabel
  );
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
      '*, time_slot:schedule_time_slots(*), student:students(id, last_name, first_name, grade, preferred_teacher_gender, fixed_teacher_ids, excluded_teacher_ids), teacher:user_profiles!schedule_entries_teacher_id_fkey(id, display_name, last_name, email)'
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

/**
 * Phase P2: 保留中の振替（振替先未定）を「期限制限なし」で全件取得。
 *
 * getPendingTransfers は期限14日以内フィルタ付き（督促ボード用）で現状のまま。
 * こちらは保留プールUI用で、期限が先でも「まだ配置していない振替」を全部見せる。
 * 条件: status='transferred_out' AND transfer_to_id IS NULL。
 */
export async function getHeldTransfers(schoolIds: string[]): Promise<ScheduleEntry[]> {
  if (schoolIds.length === 0) return [];

  const { data, error } = await db
    .from('schedule_entries')
    .select(
      '*, time_slot:schedule_time_slots(*), student:students(id, last_name, first_name, grade, preferred_teacher_gender, fixed_teacher_ids, excluded_teacher_ids), teacher:user_profiles!schedule_entries_teacher_id_fkey(id, display_name, last_name, email)'
    )
    .in('school_id', schoolIds)
    .eq('status', 'transferred_out')
    .is('transfer_to_id', null) // 振替先未確定のみ
    .order('transfer_deadline', { ascending: true });

  if (error) {
    console.error('Error fetching held transfers:', error);
    throw new Error('保留中の振替の取得に失敗しました');
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
