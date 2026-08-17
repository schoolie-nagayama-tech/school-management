/**
 * 講師の出勤可能期間 API (teacher_availability_periods)
 *
 * 「期間バージョン管理」付きで講師の出勤可能曜日/コマを保管。
 *  - source='regular_shift' は通常シフト提出由来（自動反映、再提出時は upsert）
 *  - source='manual' は手動編集（講師詳細ページから）
 *
 * リード時の優先順位（同じ日に複数 period があるとき）:
 *  1) manual ＞ regular_shift
 *  2) 同じ source なら最新の effective_from
 *
 * シフト提出フックの組込み箇所:
 *  - src/app/api/regular-shift/public/route.ts (POST) — 新規提出
 *  - src/app/api/regular-shift/public/[editToken]/route.ts (PUT) — 編集再提出
 *  - regular_shift_submissions の削除時は API 側で対応 period も削除
 */

import { supabase } from '@/lib/supabase';
import { fetchAllPaged } from '@/lib/utils/supabasePaging';
import { INDIVIDUAL_FORMATION } from '@/types/schedule';
import type { SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any> | any;

export type AvailabilitySource = 'regular_shift' | 'manual';

export interface TeacherAvailabilityPeriod {
  id: string;
  user_id: string;
  school_id: string;
  effective_from: string; // YYYY-MM-DD
  effective_until: string | null;
  available_days_of_week: number[];
  /**
   * @deprecated 旧・派生値。形態(formation)ごとに slot_number が独立採番されるため
   * 「同じ1限」が形態間で別時間になり意味が壊れる。新規書き込みはせず、読み取りも
   * available_time_slots_by_day が空の旧レコードを救済する時だけ使う。
   * key: "0".."6", value: 1〜N の slot_number 配列
   */
  available_slot_numbers_by_day: Record<string, number[]>;
  /** 正典。key: "0".."6", value: ["HH:MM-HH:MM", ...] */
  available_time_slots_by_day: Record<string, string[]>;
  source: AvailabilitySource;
  source_submission_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// =====================================================
// 時間帯ベースの可否判定（正典ロジック）
//
// 出勤可否は「その時間に教室に居られるか」という物理的事実であり、形態の属性ではない。
// そのため slot_number ではなく実時刻の区間で判定する。
// 詳細は docs/teacher-availability-time-based-plan.md
// =====================================================

/** 分単位の時刻区間 [start, end) */
export interface TimeInterval {
  start: number;
  end: number;
}

/**
 * 連続とみなす休憩の上限（分）。
 * 個別 17:00-18:30 と 18:40-20:10 に○を付けた講師は 17:00-20:10 に在室しているとみなし、
 * 休憩をまたぐ集団コマ 18:00-19:00 にも入れる。単なるオーバーラップ判定にしないのは
 * 「18:00-18:30 しか居ない講師が 18:00-19:00 のコマに合致する」誤判定を防ぐため。
 */
export const DEFAULT_BRIDGE_GAP_MINUTES = 15;

/** "HH:MM" / "HH:MM:SS" → 0時からの分。解釈できなければ null */
export function parseTimeToMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  return h * 60 + min;
}

/** "HH:MM-HH:MM" → 区間。解釈できなければ null */
function parseLabelToInterval(label: string): TimeInterval | null {
  const parts = String(label ?? '').split('-');
  if (parts.length < 2) return null;
  const start = parseTimeToMinutes(parts[0]);
  const end = parseTimeToMinutes(parts[1]);
  if (start == null || end == null || end <= start) return null;
  return { start, end };
}

/**
 * "HH:MM-HH:MM" のリストを、bridgeGapMinutes 以下の隙間を橋渡ししてマージした区間列にする。
 * 開始時刻昇順で返す。
 */
export function mergeTimeSlotLabels(
  labels: string[] | null | undefined,
  bridgeGapMinutes: number = DEFAULT_BRIDGE_GAP_MINUTES
): TimeInterval[] {
  const parsed = (labels ?? [])
    .map(parseLabelToInterval)
    .filter((iv): iv is TimeInterval => iv !== null)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const merged: TimeInterval[] = [];
  for (const iv of parsed) {
    const last = merged[merged.length - 1];
    if (last && iv.start <= last.end + bridgeGapMinutes) {
      last.end = Math.max(last.end, iv.end);
    } else {
      merged.push({ ...iv });
    }
  }
  return merged;
}

/** マージ済み区間列が [start, end] を丸ごと含むか */
export function isIntervalCovered(
  intervals: TimeInterval[],
  startTime: string,
  endTime: string
): boolean {
  const start = parseTimeToMinutes(startTime);
  const end = parseTimeToMinutes(endTime);
  if (start == null || end == null) return false;
  // 終了時刻が壊れている場合は開始時刻が含まれるかだけを見る
  const effectiveEnd = end > start ? end : start;
  return intervals.some((iv) => iv.start <= start && iv.end >= effectiveEnd);
}

/** slot_number → "HH:MM-HH:MM" の解決関数（旧レコード救済用） */
export type SlotNumberLabelResolver = (slotNumber: number) => string | undefined;

/**
 * 期間レコードから、指定曜日の在室区間を組み立てる。
 *
 * 戻り値 null は「その曜日は全時間可」を意味する（DBコメント由来の既存意味論。
 * 2027-02 の本格稼働時に「空=不可」へ改定予定）。
 *
 * available_time_slots_by_day が空でも旧 available_slot_numbers_by_day が入っている
 * レコード（2026-06 以前の手動入力）は、resolver でコマ番号を実時刻に解決して救済する。
 * resolver が無い/解決できない場合のみ「全時間可」に落ちる。
 */
export function buildDayIntervals(
  period: Pick<
    TeacherAvailabilityPeriod,
    'available_days_of_week' | 'available_time_slots_by_day' | 'available_slot_numbers_by_day'
  >,
  dayOfWeek: number,
  options?: { resolveSlotNumber?: SlotNumberLabelResolver; bridgeGapMinutes?: number }
): TimeInterval[] | null {
  if (!period.available_days_of_week?.includes(dayOfWeek)) return null;

  const key = String(dayOfWeek);
  const labels = period.available_time_slots_by_day?.[key] ?? [];
  if (labels.length > 0) {
    return mergeTimeSlotLabels(labels, options?.bridgeGapMinutes);
  }

  const legacySlotNumbers = period.available_slot_numbers_by_day?.[key] ?? [];
  const resolver = options?.resolveSlotNumber;
  if (legacySlotNumbers.length > 0 && resolver) {
    const legacyLabels = legacySlotNumbers
      .map((n) => resolver(n))
      .filter((l): l is string => Boolean(l));
    if (legacyLabels.length > 0) {
      return mergeTimeSlotLabels(legacyLabels, options?.bridgeGapMinutes);
    }
  }

  // 時間帯の指定が無い＝その曜日は全時間可
  return null;
}

/**
 * 講師がその曜日の [startTime, endTime] のコマに入れるか。
 * 曜日が対象外なら不可、時間帯未指定なら全時間可、それ以外は区間包含で判定する。
 */
export function isAvailableForInterval(
  period: Pick<
    TeacherAvailabilityPeriod,
    'available_days_of_week' | 'available_time_slots_by_day' | 'available_slot_numbers_by_day'
  >,
  dayOfWeek: number,
  startTime: string,
  endTime: string,
  options?: { resolveSlotNumber?: SlotNumberLabelResolver; bridgeGapMinutes?: number }
): boolean {
  if (!period.available_days_of_week?.includes(dayOfWeek)) return false;
  const intervals = buildDayIntervals(period, dayOfWeek, options);
  if (intervals === null) return true; // 時間帯未指定＝全時間可
  return isIntervalCovered(intervals, startTime, endTime);
}

// =====================================================
// 自動反映: regular_shift_submissions → teacher_availability_periods
// =====================================================

/**
 * 通常シフト提出 1件を teacher_availability_periods に同期する。
 *
 * - submission に紐づく setting の effective_from/until を期間として使う
 * - teacher_email を user_profiles.email と照合して user_id 解決（マッチしなければ noop）
 * - 提出スロット (available=true) から dow → time_slot[] / slot_number[] を集約
 * - source_submission_id で upsert（再提出時は同じレコードを更新）
 *
 * 失敗時は throw しない（呼び出し元で warn ログ）
 */
export async function syncRegularShiftToAvailability(
  submissionId: string,
  options?: { client?: AnyClient }
): Promise<{ ok: boolean; reason?: string; periodId?: string }> {
  const db: AnyClient = options?.client ?? supabase;

  // 1) submission 取得
  const { data: sub, error: subErr } = await db
    .from('regular_shift_submissions')
    .select('id, setting_id, school_id, teacher_email, user_id')
    .eq('id', submissionId)
    .maybeSingle();
  if (subErr || !sub) return { ok: false, reason: 'submission_not_found' };

  // 2) setting 取得（期間 + published 状態）
  const { data: setting, error: settingErr } = await db
    .from('regular_shift_settings')
    .select('id, effective_from, effective_until, status')
    .eq('id', sub.setting_id)
    .maybeSingle();
  if (settingErr || !setting) return { ok: false, reason: 'setting_not_found' };
  // draft の場合は同期しない（published のみ運用に反映）
  if (setting.status !== 'published') return { ok: false, reason: 'setting_not_published' };

  // 3) user_id を解決（submission.user_id 優先、なければ email 逆引き）
  let userId: string | null = sub.user_id ?? null;
  if (!userId && sub.teacher_email) {
    const { data: prof } = await db
      .from('user_profiles')
      .select('id')
      .ilike('email', sub.teacher_email)
      .maybeSingle();
    userId = prof?.id ?? null;
  }
  if (!userId) return { ok: false, reason: 'user_not_resolved' };

  // 4) スロット集約
  const { data: slots } = await db
    .from('regular_shift_submission_slots')
    .select('day_of_week, time_slot, available')
    .eq('submission_id', submissionId)
    .eq('available', true);

  const dowSet = new Set<number>();
  const timeSlotsByDow = new Map<number, Set<string>>();
  for (const s of (slots ?? []) as Array<{ day_of_week: number; time_slot: string }>) {
    dowSet.add(s.day_of_week);
    if (!timeSlotsByDow.has(s.day_of_week)) timeSlotsByDow.set(s.day_of_week, new Set());
    timeSlotsByDow.get(s.day_of_week)!.add(s.time_slot);
  }

  const available_days_of_week = Array.from(dowSet).sort((a, b) => a - b);
  const available_time_slots_by_day: Record<string, string[]> = {};
  for (const [dow, set] of Array.from(timeSlotsByDow.entries())) {
    available_time_slots_by_day[String(dow)] = Array.from(set).sort();
  }

  // 5) upsert (source_submission_id ベース)
  //
  //    available_slot_numbers_by_day は意図的に書かない。以前はここで
  //    schedule_time_slots を time_slot 文字列で逆引きして slot_number を導出していたが、
  //    形態(formation)ごとに slot_number が独立採番されるため「同じ時間帯＝同じ slot_number」
  //    という前提が成立せず、先勝ちで別形態のコマ番号を握りつぶしていた。
  //    判定は available_time_slots_by_day（提出そのままの実時刻）で行う。
  const row = {
    user_id: userId,
    school_id: sub.school_id,
    effective_from: setting.effective_from ?? '2026-01-01',
    effective_until: setting.effective_until ?? null,
    available_days_of_week,
    available_time_slots_by_day,
    source: 'regular_shift' as const,
    source_submission_id: submissionId,
    notes: 'シフト提出から自動反映',
  };

  const { data: existing } = await db
    .from('teacher_availability_periods')
    .select('id')
    .eq('source', 'regular_shift')
    .eq('source_submission_id', submissionId)
    .maybeSingle();

  if (existing?.id) {
    const { error } = await db
      .from('teacher_availability_periods')
      .update(row)
      .eq('id', existing.id);
    if (error) return { ok: false, reason: error.message };
    return { ok: true, periodId: existing.id };
  }

  const { data: inserted, error } = await db
    .from('teacher_availability_periods')
    .insert(row)
    .select('id')
    .single();
  if (error) return { ok: false, reason: error.message };
  return { ok: true, periodId: inserted?.id };
}

/** 提出が削除されたとき、対応する period も削除する */
export async function deleteAvailabilityForSubmission(
  submissionId: string,
  options?: { client?: AnyClient }
): Promise<void> {
  const db: AnyClient = options?.client ?? supabase;
  await db
    .from('teacher_availability_periods')
    .delete()
    .eq('source', 'regular_shift')
    .eq('source_submission_id', submissionId);
}

/**
 * 既存の通常シフト提出全部を一括同期する（手動「再同期」ボタン用）
 * - schoolId 指定で絞れる
 */
export async function syncAllRegularShifts(
  schoolId?: string,
  options?: { client?: AnyClient }
): Promise<{ total: number; synced: number; skipped: number }> {
  const db: AnyClient = options?.client ?? supabase;
  // 提出は全期間累積し1000行を超えうる。切り捨てると再同期対象が漏れるため全件
  // ページング取得（id 昇順で安定ページング）。
  const list = await fetchAllPaged<{ id: string }>((from, to) => {
    let query = db.from('regular_shift_submissions').select('id, school_id');
    if (schoolId) query = query.eq('school_id', schoolId);
    return query.order('id', { ascending: true }).range(from, to);
  });

  let synced = 0;
  let skipped = 0;
  for (const s of list) {
    const r = await syncRegularShiftToAvailability(s.id, options);
    if (r.ok) synced++;
    else skipped++;
  }
  return { total: list.length, synced, skipped };
}

// =====================================================
// リード API
// =====================================================

/**
 * 指定日時点で有効な「講師の出勤可能」を1件返す。
 * 同一日に複数 period がある場合: manual > regular_shift、同 source 内では effective_from が新しい順。
 */
export async function getEffectiveAvailability(
  userId: string,
  asOfDate?: string,
  options?: { schoolId?: string; client?: AnyClient }
): Promise<TeacherAvailabilityPeriod | null> {
  const db: AnyClient = options?.client ?? supabase;
  const today = asOfDate ?? new Date().toISOString().slice(0, 10);

  let query = db
    .from('teacher_availability_periods')
    .select('*')
    .eq('user_id', userId)
    .lte('effective_from', today)
    .or(`effective_until.is.null,effective_until.gte.${today}`);
  if (options?.schoolId) query = query.eq('school_id', options.schoolId);
  const { data } = await query;
  const list = (data ?? []) as TeacherAvailabilityPeriod[];
  if (list.length === 0) return null;

  // manual > regular_shift、同 source 内は effective_from 新しい順
  list.sort((a, b) => {
    if (a.source !== b.source) return a.source === 'manual' ? -1 : 1;
    return b.effective_from.localeCompare(a.effective_from);
  });
  return list[0];
}

/** 講師詳細用：当該講師の全期間を effective_from 降順で返す */
export async function getAvailabilityPeriods(
  userId: string,
  options?: { schoolId?: string; client?: AnyClient }
): Promise<TeacherAvailabilityPeriod[]> {
  const db: AnyClient = options?.client ?? supabase;
  let query = db
    .from('teacher_availability_periods')
    .select('*')
    .eq('user_id', userId)
    .order('effective_from', { ascending: false });
  if (options?.schoolId) query = query.eq('school_id', options.schoolId);
  const { data } = await query;
  return (data ?? []) as TeacherAvailabilityPeriod[];
}

export interface AvailabilityDayMap {
  /** 曜日 (0-6) → 出勤可能 user_id[] */
  byDayOfWeek: Map<number, string[]>;
  /**
   * `${dow}|${user_id}` → その曜日の在室区間（開始時刻昇順・マージ済み）。
   * 値が null のときは「その曜日は全時間可」を意味する。
   */
  intervalsByDayAndUser: Map<string, TimeInterval[] | null>;
  sourcesByUserId: Map<string, AvailabilitySource>;
}

/**
 * 旧レコード救済用に、その学校の slot_number → "HH:MM-HH:MM" 解決関数を作る。
 * 形態別にコマ番号が独立採番されるため、個別(individual)のコマ時間を基準にする
 * （旧 available_slot_numbers_by_day は個別しか無かった時代の値のため）。
 */
async function buildLegacySlotResolver(
  schoolId: string,
  db: AnyClient
): Promise<SlotNumberLabelResolver | undefined> {
  const { data } = await db
    .from('schedule_time_slots')
    .select('slot_number, start_time, end_time, formation')
    .eq('school_id', schoolId);

  const rows = (data ?? []) as Array<{
    slot_number: number;
    start_time: string;
    end_time: string;
    formation: string | null;
  }>;
  if (rows.length === 0) return undefined;

  const individual = rows.filter((r) => r.formation === INDIVIDUAL_FORMATION);
  const source = individual.length > 0 ? individual : rows;

  const byNumber = new Map<number, string>();
  for (const r of source) {
    if (byNumber.has(r.slot_number)) continue;
    byNumber.set(
      r.slot_number,
      `${(r.start_time || '').slice(0, 5)}-${(r.end_time || '').slice(0, 5)}`
    );
  }
  return (slotNumber: number) => byNumber.get(slotNumber);
}

/**
 * 学校全体の availability を「曜日 → 講師」「曜日×講師 → 在室区間」に展開して返す。
 * 座席表 (WeeklyScheduleGrid) の shiftAvailableByDow と互換の形式。
 *
 * コマ番号(slot_number)ベースの展開は廃止した。形態ごとにコマ番号が独立採番される
 * ため、同じ番号でも形態が違えば別時間になり判定が壊れるため。
 * 具体的なコマに入れるかは availableUserIdsForInterval / isAvailableForInterval で判定する。
 */
export async function getAvailabilityDayMap(
  schoolId: string,
  asOfDate?: string,
  options?: { client?: AnyClient }
): Promise<AvailabilityDayMap> {
  const db: AnyClient = options?.client ?? supabase;
  const [byUser, resolveSlotNumber] = await Promise.all([
    getCurrentAvailabilityBySchool(schoolId, asOfDate, options),
    buildLegacySlotResolver(schoolId, db),
  ]);

  const dowMap = new Map<number, Set<string>>();
  const intervalsByDayAndUser = new Map<string, TimeInterval[] | null>();
  const sources = new Map<string, AvailabilitySource>();

  for (const [uid, p] of Array.from(byUser.entries())) {
    sources.set(uid, p.source);
    for (const dow of p.available_days_of_week) {
      if (!dowMap.has(dow)) dowMap.set(dow, new Set());
      dowMap.get(dow)!.add(uid);
      intervalsByDayAndUser.set(`${dow}|${uid}`, buildDayIntervals(p, dow, { resolveSlotNumber }));
    }
  }

  const byDayOfWeek = new Map<number, string[]>();
  Array.from(dowMap.entries()).forEach(([k, v]) => byDayOfWeek.set(k, Array.from(v)));

  return { byDayOfWeek, intervalsByDayAndUser, sourcesByUserId: sources };
}

/**
 * その曜日の [startTime, endTime] のコマに入れる講師 user_id を返す。
 * 在室区間が null（時間帯未指定）の講師は全時間可として含める。
 */
export function availableUserIdsForInterval(
  map: AvailabilityDayMap,
  dayOfWeek: number,
  startTime: string,
  endTime: string
): string[] {
  const candidates = map.byDayOfWeek.get(dayOfWeek) ?? [];
  return candidates.filter((uid) => {
    const intervals = map.intervalsByDayAndUser.get(`${dayOfWeek}|${uid}`);
    if (intervals == null) return true; // 未登録 or 全時間可
    return isIntervalCovered(intervals, startTime, endTime);
  });
}

/** 学校全体の「今日有効な」availability を user_id ごとに返す。座席表/マッチング向け */
export async function getCurrentAvailabilityBySchool(
  schoolId: string,
  asOfDate?: string,
  options?: { client?: AnyClient }
): Promise<Map<string, TeacherAvailabilityPeriod>> {
  const db: AnyClient = options?.client ?? supabase;
  const today = asOfDate ?? new Date().toISOString().slice(0, 10);

  const { data } = await db
    .from('teacher_availability_periods')
    .select('*')
    .eq('school_id', schoolId)
    .lte('effective_from', today)
    .or(`effective_until.is.null,effective_until.gte.${today}`);
  const list = (data ?? []) as TeacherAvailabilityPeriod[];

  const byUser = new Map<string, TeacherAvailabilityPeriod[]>();
  for (const p of list) {
    if (!byUser.has(p.user_id)) byUser.set(p.user_id, []);
    byUser.get(p.user_id)!.push(p);
  }

  const result = new Map<string, TeacherAvailabilityPeriod>();
  for (const [uid, periods] of Array.from(byUser.entries())) {
    periods.sort((a, b) => {
      if (a.source !== b.source) return a.source === 'manual' ? -1 : 1;
      return b.effective_from.localeCompare(a.effective_from);
    });
    result.set(uid, periods[0]);
  }
  return result;
}

// =====================================================
// 手動編集
// =====================================================

export interface ManualAvailabilityInput {
  user_id: string;
  school_id: string;
  effective_from: string;
  effective_until?: string | null;
  available_days_of_week: number[];
  /** 正典。"HH:MM-HH:MM" のリストを曜日ごとに持つ */
  available_time_slots_by_day: Record<string, string[]>;
  notes?: string | null;
}

/**
 * 手動編集の保存。
 * 同じ (user_id, school_id, effective_from, source=manual) があれば update、なければ insert。
 */
export async function upsertManualAvailability(
  input: ManualAvailabilityInput,
  options?: { client?: AnyClient }
): Promise<TeacherAvailabilityPeriod> {
  const db: AnyClient = options?.client ?? supabase;

  // 旧 available_slot_numbers_by_day は明示的に空へ落とす。
  // 残したままだと「時間帯を空にした曜日」で旧コマ番号が復活し（buildDayIntervals の
  // 旧レコード救済が効いてしまう）、手動で外したはずの枠が可に戻る事故になる。
  const row = {
    user_id: input.user_id,
    school_id: input.school_id,
    effective_from: input.effective_from,
    effective_until: input.effective_until ?? null,
    available_days_of_week: input.available_days_of_week,
    available_time_slots_by_day: input.available_time_slots_by_day,
    available_slot_numbers_by_day: {},
    source: 'manual' as const,
    source_submission_id: null,
    notes: input.notes ?? null,
  };

  // 同 (user, school, effective_from, manual) を検索
  const { data: existing } = await db
    .from('teacher_availability_periods')
    .select('id')
    .eq('user_id', input.user_id)
    .eq('school_id', input.school_id)
    .eq('effective_from', input.effective_from)
    .eq('source', 'manual')
    .maybeSingle();

  if (existing?.id) {
    const { data, error } = await db
      .from('teacher_availability_periods')
      .update(row)
      .eq('id', existing.id)
      .select('*')
      .single();
    if (error) throw new Error(`Failed to update availability: ${error.message}`);
    return data as TeacherAvailabilityPeriod;
  }

  const { data, error } = await db
    .from('teacher_availability_periods')
    .insert(row)
    .select('*')
    .single();
  if (error) throw new Error(`Failed to insert availability: ${error.message}`);
  return data as TeacherAvailabilityPeriod;
}

export async function deleteAvailabilityPeriod(
  id: string,
  options?: { client?: AnyClient }
): Promise<void> {
  const db: AnyClient = options?.client ?? supabase;
  const { error } = await db.from('teacher_availability_periods').delete().eq('id', id);
  if (error) throw new Error(`Failed to delete availability: ${error.message}`);
}
