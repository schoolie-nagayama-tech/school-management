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
  /** key: "0".."6", value: 1〜N の slot_number 配列 */
  available_slot_numbers_by_day: Record<string, number[]>;
  /** key: "0".."6", value: ["HH:MM-HH:MM", ...] */
  available_time_slots_by_day: Record<string, string[]>;
  source: AvailabilitySource;
  source_submission_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
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

  // 5) schedule_time_slots と突合して slot_number を解決
  //    time_slot 文字列 "HH:MM-HH:MM" → start_time/end_time で逆引き
  //    formation 個別/集団どちらも対応（同じ時間帯の slot_number は同じ前提）
  const { data: timeSlotRows } = await db
    .from('schedule_time_slots')
    .select('slot_number, start_time, end_time')
    .eq('school_id', sub.school_id);

  const slotNumberByLabel = new Map<string, number>();
  for (const r of (timeSlotRows ?? []) as Array<{
    slot_number: number;
    start_time: string;
    end_time: string;
  }>) {
    const label = `${(r.start_time || '').slice(0, 5)}-${(r.end_time || '').slice(0, 5)}`;
    if (!slotNumberByLabel.has(label)) slotNumberByLabel.set(label, r.slot_number);
  }

  const available_slot_numbers_by_day: Record<string, number[]> = {};
  for (const [dowKey, times] of Object.entries(available_time_slots_by_day)) {
    const nums = new Set<number>();
    for (const t of times) {
      const n = slotNumberByLabel.get(t);
      if (n != null) nums.add(n);
    }
    available_slot_numbers_by_day[dowKey] = Array.from(nums).sort((a, b) => a - b);
  }

  // 6) upsert (source_submission_id ベース)
  const row = {
    user_id: userId,
    school_id: sub.school_id,
    effective_from: setting.effective_from ?? '2026-01-01',
    effective_until: setting.effective_until ?? null,
    available_days_of_week,
    available_slot_numbers_by_day,
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
  let query = db.from('regular_shift_submissions').select('id, school_id');
  if (schoolId) query = query.eq('school_id', schoolId);
  const { data: subs } = await query;
  const list = (subs ?? []) as Array<{ id: string }>;

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

/**
 * 学校全体の availability を dow / dow|slot_number ベースに展開して返す。
 * 座席表 (WeeklyScheduleGrid) の shiftAvailableByDow と互換の形式。
 *
 * - byDayOfWeek: 曜日 (0-6) → 出勤可能 user_id[]
 * - byDayAndSlotNumber: `${dow}|${slot_number}` → 出勤可能 user_id[]（細粒度フィルタ用）
 */
export async function getAvailabilityDayMap(
  schoolId: string,
  asOfDate?: string,
  options?: { client?: AnyClient }
): Promise<{
  byDayOfWeek: Map<number, string[]>;
  byDayAndSlotNumber: Map<string, string[]>;
  sourcesByUserId: Map<string, AvailabilitySource>;
}> {
  const byUser = await getCurrentAvailabilityBySchool(schoolId, asOfDate, options);
  const dowMap = new Map<number, Set<string>>();
  const slotMap = new Map<string, Set<string>>();
  const sources = new Map<string, AvailabilitySource>();

  for (const [uid, p] of Array.from(byUser.entries())) {
    sources.set(uid, p.source);
    for (const dow of p.available_days_of_week) {
      if (!dowMap.has(dow)) dowMap.set(dow, new Set());
      dowMap.get(dow)!.add(uid);

      const slotNums = p.available_slot_numbers_by_day?.[String(dow)] ?? [];
      for (const n of slotNums) {
        const key = `${dow}|${n}`;
        if (!slotMap.has(key)) slotMap.set(key, new Set());
        slotMap.get(key)!.add(uid);
      }
    }
  }

  const byDayOfWeek = new Map<number, string[]>();
  Array.from(dowMap.entries()).forEach(([k, v]) => byDayOfWeek.set(k, Array.from(v)));
  const byDayAndSlotNumber = new Map<string, string[]>();
  Array.from(slotMap.entries()).forEach(([k, v]) => byDayAndSlotNumber.set(k, Array.from(v)));

  return { byDayOfWeek, byDayAndSlotNumber, sourcesByUserId: sources };
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
  available_slot_numbers_by_day: Record<string, number[]>;
  available_time_slots_by_day?: Record<string, string[]>;
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

  const row = {
    user_id: input.user_id,
    school_id: input.school_id,
    effective_from: input.effective_from,
    effective_until: input.effective_until ?? null,
    available_days_of_week: input.available_days_of_week,
    available_slot_numbers_by_day: input.available_slot_numbers_by_day,
    available_time_slots_by_day: input.available_time_slots_by_day ?? {},
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
