/**
 * 講師シフトの統合 API
 *
 * 通常シフト (regular_shift_settings + submissions) と
 * 講習シフト (seasonal_shift_settings + submissions) を統合し、
 * 「指定日時点で有効な講師の出勤可能曜日 × 時間帯」を返す。
 *
 * 期間管理:
 *  - 通常シフト: regular_shift_settings.effective_from / effective_until
 *    (G-1 で追加)。NULL は無期限扱い。published のみ対象。
 *  - 講習シフト: 既存の seasonal_shift_settings.start_date / end_date。
 *
 * teacher_email から user_id への解決:
 *  - 既存提出は teacher_email のみ。user_profiles.email と照合 (case-insensitive)。
 *  - マッチしない提出はスキップ (座席表に出ない)。
 *
 * 統合方針:
 *  - 1講師に通常シフトと講習シフト両方ある場合、time_slot は union (両方OKならOK)
 *  - day_of_week ベースの集約と、`${dow}|${time_slot}` の細粒度集約の両方を返す
 */

import { supabase } from '@/lib/supabase';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface CurrentShiftAvailability {
  /** 曜日 (0=日 〜 6=土) ごとの出勤可能 user_profiles.id */
  byDayOfWeek: Map<number, string[]>;
  /** `${dow}|${time_slot}` ごとの出勤可能 user_profiles.id */
  byDayAndSlot: Map<string, string[]>;
  /** 各 user_id がどのシフトソース由来かをデバッグ用に保持 */
  sourcesByUserId: Map<string, Array<'regular' | 'seasonal'>>;
}

/**
 * 指定日時点で有効な「講師の出勤可能枠」を返す。
 * 通常シフト + 講習シフトを統合（両方の union）。
 */
export async function getCurrentTeacherShifts(
  schoolId: string,
  asOfDate?: string
): Promise<CurrentShiftAvailability> {
  const today = asOfDate ?? new Date().toISOString().slice(0, 10);

  const [regular, seasonal] = await Promise.all([
    fetchRegularShifts(schoolId, today),
    fetchSeasonalShifts(schoolId, today),
  ]);

  // 統合：dow / dow|slot を Set ベースで union
  const dowMerge = new Map<number, Set<string>>();
  const slotMerge = new Map<string, Set<string>>();
  const sourceMap = new Map<string, Set<'regular' | 'seasonal'>>();

  const apply = (
    src: Awaited<ReturnType<typeof fetchRegularShifts>>,
    label: 'regular' | 'seasonal'
  ) => {
    Array.from(src.byDayOfWeek.entries()).forEach(([dow, users]) => {
      if (!dowMerge.has(dow)) dowMerge.set(dow, new Set());
      users.forEach((u) => dowMerge.get(dow)!.add(u));
    });
    Array.from(src.byDayAndSlot.entries()).forEach(([key, users]) => {
      if (!slotMerge.has(key)) slotMerge.set(key, new Set());
      users.forEach((u) => slotMerge.get(key)!.add(u));
    });
    Array.from(src.userIds).forEach((uid) => {
      if (!sourceMap.has(uid)) sourceMap.set(uid, new Set());
      sourceMap.get(uid)!.add(label);
    });
  };

  apply(regular, 'regular');
  apply(seasonal, 'seasonal');

  const byDayOfWeek = new Map<number, string[]>();
  Array.from(dowMerge.entries()).forEach(([k, v]) => byDayOfWeek.set(k, Array.from(v)));
  const byDayAndSlot = new Map<string, string[]>();
  Array.from(slotMerge.entries()).forEach(([k, v]) => byDayAndSlot.set(k, Array.from(v)));
  const sourcesByUserId = new Map<string, Array<'regular' | 'seasonal'>>();
  Array.from(sourceMap.entries()).forEach(([k, v]) => sourcesByUserId.set(k, Array.from(v)));

  return { byDayOfWeek, byDayAndSlot, sourcesByUserId };
}

// --------------------------------------------------
// 内部ヘルパー: 通常シフトと講習シフトをそれぞれ取得
// --------------------------------------------------

interface ShiftSubset {
  byDayOfWeek: Map<number, Set<string>>;
  byDayAndSlot: Map<string, Set<string>>;
  userIds: Set<string>;
}

async function fetchRegularShifts(schoolId: string, asOf: string): Promise<ShiftSubset> {
  // 1. asOf が期間内に入っている published setting を取得
  //    effective_from が NULL なら過去から有効、effective_until が NULL なら無期限
  const { data: settings } = await db
    .from('regular_shift_settings')
    .select('id, effective_from, effective_until')
    .eq('school_id', schoolId)
    .eq('status', 'published');

  const validSettingIds = ((settings || []) as Array<{
    id: string;
    effective_from: string | null;
    effective_until: string | null;
  }>)
    .filter(
      (s) =>
        (!s.effective_from || s.effective_from <= asOf) &&
        (!s.effective_until || s.effective_until >= asOf)
    )
    .map((s) => s.id);

  if (validSettingIds.length === 0) return emptySubset();

  // 2. submissions を取得
  const { data: subs } = await db
    .from('regular_shift_submissions')
    .select('id, teacher_email')
    .in('setting_id', validSettingIds);

  return await aggregateShiftFromSubmissions(
    (subs || []) as Array<{ id: string; teacher_email: string | null }>,
    'regular_shift_submission_slots'
  );
}

async function fetchSeasonalShifts(schoolId: string, asOf: string): Promise<ShiftSubset> {
  // 講習シフトは start_date / end_date を持つ
  const { data: settings } = await db
    .from('seasonal_shift_settings')
    .select('id, start_date, end_date')
    .eq('school_id', schoolId)
    .eq('status', 'published');

  const validSettingIds = ((settings || []) as Array<{
    id: string;
    start_date: string | null;
    end_date: string | null;
  }>)
    .filter(
      (s) => (!s.start_date || s.start_date <= asOf) && (!s.end_date || s.end_date >= asOf)
    )
    .map((s) => s.id);

  if (validSettingIds.length === 0) return emptySubset();

  const { data: subs } = await db
    .from('seasonal_shift_submissions')
    .select('id, teacher_email')
    .in('setting_id', validSettingIds);

  // 講習シフトは slot に shift_date を持つので day_of_week は date から計算する
  return await aggregateSeasonalShiftFromSubmissions(
    (subs || []) as Array<{ id: string; teacher_email: string | null }>
  );
}

function emptySubset(): ShiftSubset {
  return {
    byDayOfWeek: new Map(),
    byDayAndSlot: new Map(),
    userIds: new Set(),
  };
}

/** 提出 -> email -> user_id 解決 -> day_of_week の slots を集約（通常シフト用） */
async function aggregateShiftFromSubmissions(
  subs: Array<{ id: string; teacher_email: string | null }>,
  slotsTable: string
): Promise<ShiftSubset> {
  if (subs.length === 0) return emptySubset();

  // email -> user_id 解決
  const emails = Array.from(
    new Set(subs.map((s) => s.teacher_email?.toLowerCase()).filter((e): e is string => !!e))
  );
  const submissionToUser = await resolveSubmissionUserIds(subs, emails);

  const validSubmissionIds = Array.from(submissionToUser.keys());
  if (validSubmissionIds.length === 0) return emptySubset();

  const { data: slots } = await db
    .from(slotsTable)
    .select('submission_id, day_of_week, time_slot, available')
    .in('submission_id', validSubmissionIds)
    .eq('available', true);

  const result: ShiftSubset = emptySubset();
  for (const s of (slots || []) as Array<{
    submission_id: string;
    day_of_week: number;
    time_slot: string;
  }>) {
    const uid = submissionToUser.get(s.submission_id);
    if (!uid) continue;
    result.userIds.add(uid);
    if (!result.byDayOfWeek.has(s.day_of_week)) result.byDayOfWeek.set(s.day_of_week, new Set());
    result.byDayOfWeek.get(s.day_of_week)!.add(uid);
    const key = `${s.day_of_week}|${s.time_slot}`;
    if (!result.byDayAndSlot.has(key)) result.byDayAndSlot.set(key, new Set());
    result.byDayAndSlot.get(key)!.add(uid);
  }
  return result;
}

/** 講習シフト用：slot は shift_date を持つので date から day_of_week 算出 */
async function aggregateSeasonalShiftFromSubmissions(
  subs: Array<{ id: string; teacher_email: string | null }>
): Promise<ShiftSubset> {
  if (subs.length === 0) return emptySubset();

  const emails = Array.from(
    new Set(subs.map((s) => s.teacher_email?.toLowerCase()).filter((e): e is string => !!e))
  );
  const submissionToUser = await resolveSubmissionUserIds(subs, emails);
  const validSubmissionIds = Array.from(submissionToUser.keys());
  if (validSubmissionIds.length === 0) return emptySubset();

  const { data: slots } = await db
    .from('seasonal_shift_submission_slots')
    .select('submission_id, shift_date, time_slot, available')
    .in('submission_id', validSubmissionIds)
    .eq('available', true);

  const result: ShiftSubset = emptySubset();
  for (const s of (slots || []) as Array<{
    submission_id: string;
    shift_date: string;
    time_slot: string;
  }>) {
    const uid = submissionToUser.get(s.submission_id);
    if (!uid) continue;
    result.userIds.add(uid);
    const dow = new Date(s.shift_date + 'T12:00:00').getDay();
    if (!result.byDayOfWeek.has(dow)) result.byDayOfWeek.set(dow, new Set());
    result.byDayOfWeek.get(dow)!.add(uid);
    const key = `${dow}|${s.time_slot}`;
    if (!result.byDayAndSlot.has(key)) result.byDayAndSlot.set(key, new Set());
    result.byDayAndSlot.get(key)!.add(uid);
  }
  return result;
}

async function resolveSubmissionUserIds(
  subs: Array<{ id: string; teacher_email: string | null }>,
  emails: string[]
): Promise<Map<string, string>> {
  const emailToUserId = new Map<string, string>();
  if (emails.length > 0) {
    const { data: users } = await db
      .from('user_profiles')
      .select('id, email')
      .in('email', emails);
    for (const u of (users || []) as Array<{ id: string; email: string }>) {
      if (u.email) emailToUserId.set(u.email.toLowerCase(), u.id);
    }
  }
  const submissionToUser = new Map<string, string>();
  for (const s of subs) {
    const uid = s.teacher_email ? emailToUserId.get(s.teacher_email.toLowerCase()) : null;
    if (uid) submissionToUser.set(s.id, uid);
  }
  return submissionToUser;
}

// --------------------------------------------------
// 講師詳細ページ用：単一講師の現在シフトを返す
// --------------------------------------------------

export interface SingleTeacherShift {
  user_id: string;
  daysOfWeek: number[]; // 出勤可能曜日
  slotsByDay: Map<number, string[]>; // 曜日 → ['HH:MM-HH:MM', ...]
  sources: Array<'regular' | 'seasonal'>;
}

export async function getSingleTeacherShift(
  schoolId: string,
  userId: string,
  asOfDate?: string
): Promise<SingleTeacherShift> {
  const all = await getCurrentTeacherShifts(schoolId, asOfDate);
  const days: number[] = [];
  const slotsByDay = new Map<number, string[]>();

  Array.from(all.byDayOfWeek.entries()).forEach(([dow, users]) => {
    if (users.includes(userId)) days.push(dow);
  });
  Array.from(all.byDayAndSlot.entries()).forEach(([key, users]) => {
    if (!users.includes(userId)) return;
    const [dowStr, slot] = key.split('|');
    const dow = parseInt(dowStr, 10);
    if (!slotsByDay.has(dow)) slotsByDay.set(dow, []);
    slotsByDay.get(dow)!.push(slot);
  });

  return {
    user_id: userId,
    daysOfWeek: days.sort((a, b) => a - b),
    slotsByDay,
    sources: all.sourcesByUserId.get(userId) ?? [],
  };
}
