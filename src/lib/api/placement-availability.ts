/**
 * 配置モード用「出席可能日程ストリップ」データ構築 API
 *
 * 座席表の配置モード（講習 / テスト対策）中に、対象生徒の通塾可能日程を
 * ドットマトリクスで表示するためのデータを組み立てる。
 *
 * 主な責務:
 *   - 生徒の「可能枠(黄)」を収集（講習: shift_submission → regular_pattern フォールバック / テスト対策: zoukoma）
 *   - 配置済み(緑): schedule_entries から kind・status で絞り込み
 *   - 満席(赤): 可能枠に対して「出勤可能講師が全員上限埋まり」判定
 */

import { supabase } from '@/lib/supabase';
import { getStudentRegularSchedule } from '@/lib/api/koushu-period';
import { getScheduleEntries } from '@/lib/api/schedule';
import { getClassCapacity, DEFAULT_CLASS_CAPACITY } from '@/lib/api/school-class-capacity';
import { getAvailabilityDayMap } from '@/lib/api/teacher-availability';
import type { ZoukomaAvailableSlot } from '@/lib/api/zoukoma-placement';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

// =====================================================
// 公開型
// =====================================================

/** ストリップの各セル状態。キーが無い場合は「不可(グレー)」扱い */
export type StripCellStatus = 'available' | 'placed' | 'full';

export interface PlacementStripData {
  /** 期間の開始日 YYYY-MM-DD */
  startDate: string;
  /** 期間の終了日 YYYY-MM-DD */
  endDate: string;
  /** 期間の全日付 YYYY-MM-DD[] */
  dates: string[];
  /** 表示する個別コマの一覧（formation!=group, slot_number 昇順） */
  slots: Array<{ id: string; slot_number: number; start_time: string }>;
  /**
   * セル状態マップ。キー = `${date}_${slotId}`
   * キーが存在しない日×コマは「不可(グレー)」
   */
  statusByKey: Map<string, StripCellStatus>;
  /** 可能枠データの取得元 */
  source: 'shift_submission' | 'regular_pattern' | 'zoukoma';
}

// =====================================================
// 内部ヘルパ
// =====================================================

/**
 * 日付文字列 YYYY-MM-DD から JST 安全に曜日(0=日 〜 6=土)を取得する。
 * T12:00:00 を付けることで時差によるゼロ時跨ぎを避ける。
 */
function getDayOfWeekJST(dateStr: string): number {
  return new Date(dateStr + 'T12:00:00').getDay();
}

/**
 * 期間の全日付リストを生成する。
 * 純粋に文字列演算で組む（タイムゾーン非依存）。
 */
function buildDateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  // JST 12:00 基準で日付を進める
  const cursor = new Date(startDate + 'T12:00:00');
  const end = new Date(endDate + 'T12:00:00');
  while (cursor <= end) {
    const y = cursor.getFullYear();
    const m = String(cursor.getMonth() + 1).padStart(2, '0');
    const d = String(cursor.getDate()).padStart(2, '0');
    dates.push(`${y}-${m}-${d}`);
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

/**
 * 時刻文字列 "HH:MM:SS" / "HH:MM" の先頭5文字を比較して slotId を解決するマップを作る。
 * start_time の先頭5文字 → slot.id
 */
function buildTimeToSlotMap(
  slots: Array<{ id: string; start_time: string }>
): Map<string, string> {
  const map = new Map<string, string>();
  for (const s of slots) {
    const key = (s.start_time ?? '').slice(0, 5);
    if (key && !map.has(key)) map.set(key, s.id);
  }
  return map;
}

/**
 * 満席判定ロジック（可能枠に対してのみ適用）
 *
 * - 可能枠(黄)のキー = `${date}_${slotId}` それぞれについて:
 *   1) その日×コマに出勤可能な講師一覧を byDayAndSlotNumber から取得
 *   2) 出勤可能講師が 0人 → 満席
 *   3) 全員が個別上限(cap) 人以上を担当済み → 満席
 * - 配置済み(緑)は満席より優先するため、available なキーに対してのみ判定を行い
 *   placed キーは呼び出し元で上書き済み
 *
 * @param availableKeys   可能枠(黄)の `${date}_${slotId}` セット
 * @param allEntries      期間内の全 schedule_entries（kind 問わず individual + active status）
 * @param cap             1講師あたりの個別上限
 * @param availabilityByWeek  週月曜日付 → getAvailabilityDayMap の結果 Map
 * @param slots           個別コマ一覧（slotId → slot_number 解決用）
 * @param dates           期間の全日付
 * @returns 満席と判定したキーの Set
 */
function computeFullKeys(
  availableKeys: Set<string>,
  allEntries: Array<{
    entry_date: string;
    time_slot_id: string;
    teacher_id: string | null;
    formation: string;
    status: string;
  }>,
  cap: number,
  availabilityByWeek: Map<string, Awaited<ReturnType<typeof getAvailabilityDayMap>>>,
  slots: Array<{ id: string; slot_number: number }>,
  dates: string[]
): Set<string> {
  // 個別かつ active な配置済みエントリを date×slotId×teacherId ごとに集計
  // teacherId → 担当生徒数
  const occupancyByKey = new Map<string, Map<string, number>>();
  for (const e of allEntries) {
    if (e.formation !== 'individual') continue;
    if (!['scheduled', 'completed', 'transferred_in'].includes(e.status)) continue;
    if (!e.teacher_id) continue;
    const key = `${e.entry_date}_${e.time_slot_id}`;
    if (!occupancyByKey.has(key)) occupancyByKey.set(key, new Map());
    const teacherMap = occupancyByKey.get(key)!;
    teacherMap.set(e.teacher_id, (teacherMap.get(e.teacher_id) ?? 0) + 1);
  }

  // 週月曜日付を取得する関数（JST 安全）
  const getWeekMonday = (dateStr: string): string => {
    const d = new Date(dateStr + 'T12:00:00');
    const dow = d.getDay();
    const diff = dow === 0 ? -6 : 1 - dow;
    d.setDate(d.getDate() + diff);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  // slotId → slot_number の逆引きマップ
  const slotNumById = new Map(slots.map((s) => [s.id, s.slot_number]));

  // 日付リストから週月曜日セットを構築（dates が渡されていれば全週をカバー）
  const mondaySet = new Set<string>();
  for (const d of dates) mondaySet.add(getWeekMonday(d));

  const fullKeys = new Set<string>();

  for (const cellKey of Array.from(availableKeys)) {
    const [dateStr, slotId] = cellKey.split('_');
    const dow = getDayOfWeekJST(dateStr);
    const slotNum = slotNumById.get(slotId);
    if (slotNum == null) continue;

    const monday = getWeekMonday(dateStr);
    const avail = availabilityByWeek.get(monday);
    if (!avail) {
      // 出勤可能講師データが取れなかった場合は満席扱い（置けない）
      fullKeys.add(cellKey);
      continue;
    }

    // その曜日×コマに出勤可能な講師一覧
    const availKey = `${dow}|${slotNum}`;
    const availableTeachers = avail.byDayAndSlotNumber.get(availKey) ?? [];

    if (availableTeachers.length === 0) {
      // 出勤可能講師が0人 → 満席
      fullKeys.add(cellKey);
      continue;
    }

    // 全員が上限に達しているか確認
    const teacherCounts = occupancyByKey.get(cellKey) ?? new Map<string, number>();
    const allFull = availableTeachers.every((tid) => (teacherCounts.get(tid) ?? 0) >= cap);
    if (allFull) {
      fullKeys.add(cellKey);
    }
  }

  return fullKeys;
}

// =====================================================
// 講習用
// =====================================================

/**
 * 講習の配置ストリップデータを構築する。
 *
 * 可能枠の取得順:
 *   1) seasonal_shift_student_submissions（生徒の講習可能表提出）が1件でもあれば優先
 *   2) 0件なら schedule_regular_patterns（通常通塾日程）を期間の全日付に展開
 */
export async function buildKoushuPlacementStrip(
  schoolId: string,
  studentId: string,
  period: { schedule_start_date: string; schedule_end_date: string },
  slots: Array<{ id: string; slot_number: number; start_time: string }>
): Promise<PlacementStripData> {
  const startDate = period.schedule_start_date;
  const endDate = period.schedule_end_date;
  const dates = buildDateRange(startDate, endDate);
  const timeToSlot = buildTimeToSlotMap(slots);

  // ---- 1) 可能枠収集 ----
  const availableKeys = new Set<string>();
  let source: PlacementStripData['source'] = 'shift_submission';

  // seasonal_shift_student_submissions を直接クエリ（setting_id 経由にしない）
  const { data: submissions } = await db
    .from('seasonal_shift_student_submissions')
    .select('id, slots:seasonal_shift_student_submission_slots(shift_date, time_slot, available)')
    .eq('school_id', schoolId)
    .eq('student_id', studentId);

  type SubmissionSlot = { shift_date: string; time_slot: string; available: boolean };
  type Submission = { id: string; slots: SubmissionSlot[] };

  const dateSet = new Set(dates);
  let hasSubmission = false;

  for (const sub of (submissions ?? []) as Submission[]) {
    for (const slot of (sub.slots ?? [])) {
      // 期間内かつ available=true のスロットのみ
      if (!slot.available) continue;
      if (!dateSet.has(slot.shift_date)) continue;
      // time_slot は "HH:MM-HH:MM" 形式なので先頭5文字で slotId に解決
      const startKey = (slot.time_slot ?? '').slice(0, 5);
      const slotId = timeToSlot.get(startKey);
      if (!slotId) continue;
      availableKeys.add(`${slot.shift_date}_${slotId}`);
      hasSubmission = true;
    }
  }

  // 提出0件なら通塾日程パターンにフォールバック
  if (!hasSubmission) {
    source = 'regular_pattern';
    const regularSchedule = await getStudentRegularSchedule(studentId);
    // 週回数分は生徒のパターンの day_of_week と一致する日に展開
    for (const dateStr of dates) {
      const dow = getDayOfWeekJST(dateStr);
      for (const pat of regularSchedule) {
        if (pat.day_of_week !== dow) continue;
        // slot_number で slotId を解決
        const slot = slots.find((s) => s.slot_number === pat.slot_number);
        if (!slot) continue;
        availableKeys.add(`${dateStr}_${slot.id}`);
      }
    }
  }

  // ---- 2) 配置済み(緑) ----
  const placedKeys = new Set<string>();
  const allEntries = await getScheduleEntries(schoolId, startDate, endDate);
  for (const e of allEntries) {
    if (e.student_id !== studentId) continue;
    if (e.kind !== 'koushu') continue;
    // status は型上 string | undefined なので空文字フォールバック
    if (!['scheduled', 'completed', 'transferred_in'].includes(e.status ?? '')) continue;
    placedKeys.add(`${e.entry_date}_${e.time_slot_id}`);
  }

  // ---- 3) 満席判定（可能枠のみ） ----
  const cap =
    (await getClassCapacity(schoolId))?.max_students_per_teacher_individual ??
    DEFAULT_CLASS_CAPACITY.max_students_per_teacher_individual;

  // 期間内の全週月曜日について出勤可能データを並列取得
  const mondaySet = new Set<string>();
  for (const d of dates) {
    const dt = new Date(d + 'T12:00:00');
    const dow = dt.getDay();
    const diff = dow === 0 ? -6 : 1 - dow;
    dt.setDate(dt.getDate() + diff);
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const day = String(dt.getDate()).padStart(2, '0');
    mondaySet.add(`${y}-${m}-${day}`);
  }
  const mondays = Array.from(mondaySet);
  const availResults = await Promise.all(
    mondays.map((monday) => getAvailabilityDayMap(schoolId, monday))
  );
  const availabilityByWeek = new Map<string, Awaited<ReturnType<typeof getAvailabilityDayMap>>>();
  mondays.forEach((monday, i) => availabilityByWeek.set(monday, availResults[i]));

  const fullKeys = computeFullKeys(
    availableKeys,
    allEntries.map((e) => ({
      entry_date: e.entry_date,
      time_slot_id: e.time_slot_id,
      teacher_id: e.teacher_id ?? null,
      formation: e.formation ?? 'individual',
      // status は型上 string | undefined だが実際は常に文字列なので空文字でフォールバック
      status: e.status ?? '',
    })),
    cap,
    availabilityByWeek,
    slots,
    dates
  );

  // ---- 4) ステータスマップ組み立て（優先: placed > full > available） ----
  const statusByKey = new Map<string, StripCellStatus>();
  for (const k of Array.from(availableKeys)) {
    statusByKey.set(k, fullKeys.has(k) ? 'full' : 'available');
  }
  for (const k of Array.from(placedKeys)) {
    // 配置済みは可否問わず緑（配置した実績は常に見せる）
    statusByKey.set(k, 'placed');
  }

  return { startDate, endDate, dates, slots, statusByKey, source };
}

// =====================================================
// テスト対策用
// =====================================================

/**
 * テスト対策の配置ストリップデータを構築する。
 *
 * 可能枠: ZoukomaAvailableSlot[]（増コマフォームの選択枠）から収集。
 * startTime が null のスロットはその日付の全コマを可として扱う。
 * 期間 = availableSlots の min〜max 日付。
 */
export async function buildTestPrepPlacementStrip(
  schoolId: string,
  studentId: string,
  availableSlots: ZoukomaAvailableSlot[],
  slots: Array<{ id: string; slot_number: number; start_time: string }>
): Promise<PlacementStripData> {
  if (availableSlots.length === 0) {
    // スロットが空の場合は空データを返す
    return {
      startDate: '',
      endDate: '',
      dates: [],
      slots,
      statusByKey: new Map(),
      source: 'zoukoma',
    };
  }

  const timeToSlot = buildTimeToSlotMap(slots);

  // 期間 = availableSlots の min〜max 日付
  const sortedDates = [...availableSlots.map((s) => s.date)].sort();
  const startDate = sortedDates[0];
  const endDate = sortedDates[sortedDates.length - 1];
  const dates = buildDateRange(startDate, endDate);

  // ---- 1) 可能枠収集 ----
  const availableKeys = new Set<string>();

  for (const slot of availableSlots) {
    if (slot.startTime === null) {
      // 時限なし → その日付の全コマを可
      for (const s of slots) {
        availableKeys.add(`${slot.date}_${s.id}`);
      }
    } else {
      // startTime 先頭5文字で slotId に解決
      const timeKey = (slot.startTime ?? '').slice(0, 5);
      const slotId = timeToSlot.get(timeKey);
      if (slotId) availableKeys.add(`${slot.date}_${slotId}`);
    }
  }

  // ---- 2) 配置済み(緑) ----
  const placedKeys = new Set<string>();
  const allEntries = await getScheduleEntries(schoolId, startDate, endDate);
  for (const e of allEntries) {
    if (e.student_id !== studentId) continue;
    if (e.kind !== 'test_prep') continue;
    // status は型上 string | undefined なので空文字フォールバック
    if (!['scheduled', 'completed', 'transferred_in'].includes(e.status ?? '')) continue;
    placedKeys.add(`${e.entry_date}_${e.time_slot_id}`);
  }

  // ---- 3) 満席判定（可能枠のみ） ----
  const cap =
    (await getClassCapacity(schoolId))?.max_students_per_teacher_individual ??
    DEFAULT_CLASS_CAPACITY.max_students_per_teacher_individual;

  const mondaySet = new Set<string>();
  for (const d of dates) {
    const dt = new Date(d + 'T12:00:00');
    const dow = dt.getDay();
    const diff = dow === 0 ? -6 : 1 - dow;
    dt.setDate(dt.getDate() + diff);
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const day = String(dt.getDate()).padStart(2, '0');
    mondaySet.add(`${y}-${m}-${day}`);
  }
  const mondays = Array.from(mondaySet);
  const availResults = await Promise.all(
    mondays.map((monday) => getAvailabilityDayMap(schoolId, monday))
  );
  const availabilityByWeek = new Map<string, Awaited<ReturnType<typeof getAvailabilityDayMap>>>();
  mondays.forEach((monday, i) => availabilityByWeek.set(monday, availResults[i]));

  const fullKeys = computeFullKeys(
    availableKeys,
    allEntries.map((e) => ({
      entry_date: e.entry_date,
      time_slot_id: e.time_slot_id,
      teacher_id: e.teacher_id ?? null,
      formation: e.formation ?? 'individual',
      // status は型上 string | undefined だが実際は常に文字列なので空文字でフォールバック
      status: e.status ?? '',
    })),
    cap,
    availabilityByWeek,
    slots,
    dates
  );

  // ---- 4) ステータスマップ組み立て ----
  const statusByKey = new Map<string, StripCellStatus>();
  for (const k of Array.from(availableKeys)) {
    statusByKey.set(k, fullKeys.has(k) ? 'full' : 'available');
  }
  for (const k of Array.from(placedKeys)) {
    statusByKey.set(k, 'placed');
  }

  return { startDate, endDate, dates, slots, statusByKey, source: 'zoukoma' };
}
