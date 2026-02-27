/**
 * 講習期間シフト提出 API
 */
import { supabase } from '@/lib/supabase';
import type {
  SeasonalShiftSetting,
  SeasonalShiftSettingInsert,
  SlotSetting,
  SeasonalShiftSubmission,
  SeasonalShiftSubmissionInsert,
  SeasonalShiftSubmissionSlot,
  SeasonalShiftSubmissionSlotInsert,
  SubmissionWithSlots,
} from '@/types/seasonal-shift';

// ========== 設定 ==========

export async function getSeasonalShiftSettings(schoolId: string): Promise<SeasonalShiftSetting[]> {
  const { data, error } = await supabase
    .from('seasonal_shift_settings')
    .select('*')
    .eq('school_id', schoolId)
    .order('start_date', { ascending: false });

  if (error) throw new Error(`シフト設定の取得に失敗しました: ${error.message}`);
  return (data || []) as SeasonalShiftSetting[];
}

export async function getSeasonalShiftSetting(id: string): Promise<SeasonalShiftSetting | null> {
  const { data, error } = await supabase
    .from('seasonal_shift_settings')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw new Error(`シフト設定の取得に失敗しました: ${error.message}`);
  return data as SeasonalShiftSetting | null;
}

/** 公開用：公開中の設定を1件取得 */
export async function getPublishedSeasonalShiftSetting(
  id: string
): Promise<SeasonalShiftSetting | null> {
  const { data, error } = await supabase
    .from('seasonal_shift_settings')
    .select('*')
    .eq('id', id)
    .eq('status', 'published')
    .maybeSingle();

  if (error) throw new Error(`シフト設定の取得に失敗しました: ${error.message}`);
  return data as SeasonalShiftSetting | null;
}

export async function createSeasonalShiftSetting(
  input: SeasonalShiftSettingInsert
): Promise<SeasonalShiftSetting> {
  const { data, error } = await supabase
    .from('seasonal_shift_settings')
    .insert({
      school_id: input.school_id,
      name: input.name,
      start_date: input.start_date,
      end_date: input.end_date,
      deadline: input.deadline,
      description: input.description ?? '',
      weekday_slots: input.weekday_slots,
      saturday_slots: input.saturday_slots,
      status: input.status ?? 'draft',
    })
    .select()
    .single();

  if (error) throw new Error(`シフト設定の作成に失敗しました: ${error.message}`);
  return data as SeasonalShiftSetting;
}

export async function updateSeasonalShiftSetting(
  id: string,
  input: Partial<Omit<SeasonalShiftSettingInsert, 'school_id'>>
): Promise<SeasonalShiftSetting> {
  const { data, error } = await supabase
    .from('seasonal_shift_settings')
    .update({
      ...input,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error(`シフト設定の更新に失敗しました: ${error.message}`);
  return data as SeasonalShiftSetting;
}

export async function deleteSeasonalShiftSetting(id: string): Promise<void> {
  const { error } = await supabase.from('seasonal_shift_settings').delete().eq('id', id);
  if (error) throw new Error(`シフト設定の削除に失敗しました: ${error.message}`);
}

// ========== 開講コマ設定 ==========

export async function getSeasonalShiftSlotSettings(
  settingId: string
): Promise<SlotSetting[]> {
  const { data, error } = await supabase
    .from('seasonal_shift_slot_settings')
    .select('*')
    .eq('setting_id', settingId);

  if (error) throw new Error(`開講コマ設定の取得に失敗しました: ${error.message}`);
  return (data || []) as SlotSetting[];
}

export async function setSeasonalShiftSlotSettings(
  settingId: string,
  items: Omit<SlotSetting, 'id' | 'created_at'>[]
): Promise<void> {
  const { error: delError } = await supabase
    .from('seasonal_shift_slot_settings')
    .delete()
    .eq('setting_id', settingId);
  if (delError) throw new Error(`開講コマ設定の削除に失敗しました: ${delError.message}`);

  if (items.length === 0) return;

  const rows = items.map((item) => ({
    setting_id: settingId,
    slot_date: item.slot_date,
    time_slot: item.time_slot,
    is_open: item.is_open,
  }));

  const { error: insError } = await supabase.from('seasonal_shift_slot_settings').insert(rows);
  if (insError) throw new Error(`開講コマ設定の保存に失敗しました: ${insError.message}`);
}

// ========== 提出 ==========

export async function getSeasonalShiftSubmissions(
  settingId: string
): Promise<SeasonalShiftSubmission[]> {
  const { data, error } = await supabase
    .from('seasonal_shift_submissions')
    .select('*')
    .eq('setting_id', settingId)
    .order('submitted_at', { ascending: false });

  if (error) throw new Error(`提出一覧の取得に失敗しました: ${error.message}`);
  return (data || []) as SeasonalShiftSubmission[];
}

export async function getSeasonalShiftSubmissionWithSlots(
  submissionId: string
): Promise<SubmissionWithSlots | null> {
  const { data: submission, error: subError } = await supabase
    .from('seasonal_shift_submissions')
    .select('*')
    .eq('id', submissionId)
    .maybeSingle();
  if (subError) throw new Error(`提出の取得に失敗しました: ${subError.message}`);
  if (!submission) return null;

  const { data: slots, error: slotsError } = await supabase
    .from('seasonal_shift_submission_slots')
    .select('*')
    .eq('submission_id', submissionId);
  if (slotsError) throw new Error(`シフト詳細の取得に失敗しました: ${slotsError.message}`);

  return {
    ...(submission as SeasonalShiftSubmission),
    slots: (slots || []) as SeasonalShiftSubmissionSlot[],
  };
}

/** 修正用トークンで提出を取得（allow_edit が true のときのみ有効） */
export async function getSeasonalShiftSubmissionByEditToken(
  editToken: string
): Promise<SubmissionWithSlots | null> {
  const { data: submission, error: subError } = await supabase
    .from('seasonal_shift_submissions')
    .select('*')
    .eq('edit_token', editToken)
    .eq('allow_edit', true)
    .maybeSingle();
  if (subError) throw new Error(`提出の取得に失敗しました: ${subError.message}`);
  if (!submission) return null;

  const sub = submission as SeasonalShiftSubmission;
  const { data: slots, error: slotsError } = await supabase
    .from('seasonal_shift_submission_slots')
    .select('*')
    .eq('submission_id', sub.id);
  if (slotsError) throw new Error(`シフト詳細の取得に失敗しました: ${slotsError.message}`);

  return {
    ...sub,
    slots: (slots || []) as SeasonalShiftSubmissionSlot[],
  };
}

/** 運営ダッシュボード用：日付×コマごとの出勤可能人数を集計 */
export async function getSeasonalShiftAttendanceCounts(
  settingId: string
): Promise<Record<string, number>> {
  const submissions = await getSeasonalShiftSubmissions(settingId);
  const ids = submissions.map((s) => s.id);
  if (ids.length === 0) return {};

  const { data: slots, error } = await supabase
    .from('seasonal_shift_submission_slots')
    .select('shift_date, time_slot')
    .in('submission_id', ids)
    .eq('available', true);

  if (error) throw new Error(`出勤状況の集計に失敗しました: ${error.message}`);

  const counts: Record<string, number> = {};
  for (const s of slots || []) {
    const key = `${s.shift_date}|${s.time_slot}`;
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

/** 講師別コマ数（多い順） */
export async function getSeasonalShiftTeacherSlotCounts(
  settingId: string
): Promise<{ teacher_name: string; teacher_email: string; count: number }[]> {
  const submissions = await getSeasonalShiftSubmissions(settingId);
  const ids = submissions.map((s) => s.id);
  if (ids.length === 0) return [];

  const { data: slots, error } = await supabase
    .from('seasonal_shift_submission_slots')
    .select('submission_id')
    .in('submission_id', ids)
    .eq('available', true);

  if (error) throw new Error(`講師別コマ数の取得に失敗しました: ${error.message}`);

  const countBySubId: Record<string, number> = {};
  for (const s of slots || []) {
    countBySubId[s.submission_id] = (countBySubId[s.submission_id] || 0) + 1;
  }

  return submissions
    .map((sub) => ({
      teacher_name: sub.teacher_name,
      teacher_email: sub.teacher_email,
      count: countBySubId[sub.id] ?? 0,
    }))
    .sort((a, b) => b.count - a.count);
}

/** 提出を削除（スロットは CASCADE で自動削除） */
export async function deleteSeasonalShiftSubmission(submissionId: string): Promise<void> {
  const { error } = await supabase
    .from('seasonal_shift_submissions')
    .delete()
    .eq('id', submissionId);
  if (error) throw new Error(`提出の削除に失敗しました: ${error.message}`);
}

export async function createSeasonalShiftSubmission(
  input: SeasonalShiftSubmissionInsert,
  slots: Omit<SeasonalShiftSubmissionSlotInsert, 'submission_id'>[]
): Promise<SeasonalShiftSubmission> {
  const { data: submission, error: subError } = await supabase
    .from('seasonal_shift_submissions')
    .insert({
      setting_id: input.setting_id,
      school_id: input.school_id,
      teacher_name: input.teacher_name,
      teacher_email: input.teacher_email,
      notes: input.notes ?? '',
    })
    .select()
    .single();
  if (subError) {
    if (subError.code === '23505') {
      throw new Error('この内容は既に送信されています。');
    }
    throw new Error(`提出の保存に失敗しました: ${subError.message}`);
  }

  const sub = submission as SeasonalShiftSubmission;
  if (slots.length > 0) {
    const slotRows = slots.map((s) => ({
      submission_id: sub.id,
      shift_date: s.shift_date,
      time_slot: s.time_slot,
      available: s.available,
    }));
    const { error: slotsError } = await supabase
      .from('seasonal_shift_submission_slots')
      .insert(slotRows);
    if (slotsError) throw new Error(`シフト詳細の保存に失敗しました: ${slotsError.message}`);
  }

  try {
    const res = await fetch('/api/seasonal-shift/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'submitted', submissionId: sub.id }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.warn('提出通知メールの送信に失敗しました:', res.status, err);
    }
  } catch (e) {
    console.warn('提出通知メールの送信に失敗しました:', e);
  }

  return sub;
}

/** 修正許可を付与（allow_edit=true にし、edit_token を返す） */
export async function allowSeasonalShiftEdit(submissionId: string): Promise<string> {
  const { data, error } = await supabase
    .from('seasonal_shift_submissions')
    .update({ allow_edit: true, updated_at: new Date().toISOString() })
    .eq('id', submissionId)
    .select('edit_token')
    .single();
  if (error) throw new Error(`修正許可の更新に失敗しました: ${error.message}`);

  const res = await fetch('/api/seasonal-shift/notify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'allow_edit', submissionId }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err?.error ?? '修正許可メールの送信に失敗しました');
  }

  return data.edit_token as string;
}

/** 修正許可メールを再送（allow_edit=true の提出向け） */
export async function resendSeasonalShiftEditEmail(submissionId: string): Promise<void> {
  const res = await fetch('/api/seasonal-shift/notify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'allow_edit', submissionId }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err?.error ?? '修正許可メールの再送に失敗しました');
  }
}

/** トークンで提出を更新（再提出後は allow_edit を false に） */
export async function updateSeasonalShiftSubmissionByToken(
  editToken: string,
  input: { teacher_name: string; teacher_email: string; notes?: string },
  slots: Omit<SeasonalShiftSubmissionSlotInsert, 'submission_id'>[]
): Promise<SeasonalShiftSubmission | null> {
  const sub = await getSeasonalShiftSubmissionByEditToken(editToken);
  if (!sub) return null;

  const { error: subError } = await supabase
    .from('seasonal_shift_submissions')
    .update({
      teacher_name: input.teacher_name,
      teacher_email: input.teacher_email,
      notes: input.notes ?? '',
      allow_edit: false,
      submitted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', sub.id);
  if (subError) throw new Error(`提出の更新に失敗しました: ${subError.message}`);

  const { error: delError } = await supabase
    .from('seasonal_shift_submission_slots')
    .delete()
    .eq('submission_id', sub.id);
  if (delError) throw new Error(`既存シフトの削除に失敗しました: ${delError.message}`);

  if (slots.length > 0) {
    const slotRows = slots.map((s) => ({
      submission_id: sub.id,
      shift_date: s.shift_date,
      time_slot: s.time_slot,
      available: s.available,
    }));
    const { error: insError } = await supabase
      .from('seasonal_shift_submission_slots')
      .insert(slotRows);
    if (insError) throw new Error(`シフト詳細の保存に失敗しました: ${insError.message}`);
  }

  const updated = await getSeasonalShiftSubmissionWithSlots(sub.id);
  return updated;
}
