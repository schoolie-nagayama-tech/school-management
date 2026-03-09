/**
 * 隰帷ｿ呈悄髢薙す繝輔ヨ謠仙・ API
 */
import { supabase } from '@/lib/supabase';
import { fetchWithAuth } from '@/lib/api/auth';
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

// ========== 險ｭ螳・==========

export async function getSeasonalShiftSettings(schoolId: string): Promise<SeasonalShiftSetting[]> {
  const { data, error } = await supabase
    .from('seasonal_shift_settings')
    .select('*')
    .eq('school_id', schoolId)
    .order('start_date', { ascending: false });

  if (error) throw new Error(`繧ｷ繝輔ヨ險ｭ螳壹・蜿門ｾ励↓螟ｱ謨励＠縺ｾ縺励◆: ${error.message}`);
  return (data || []) as SeasonalShiftSetting[];
}

export async function getSeasonalShiftSetting(id: string): Promise<SeasonalShiftSetting | null> {
  const { data, error } = await supabase
    .from('seasonal_shift_settings')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw new Error(`繧ｷ繝輔ヨ險ｭ螳壹・蜿門ｾ励↓螟ｱ謨励＠縺ｾ縺励◆: ${error.message}`);
  return data as SeasonalShiftSetting | null;
}

/** 蜈ｬ髢狗畑・壼・髢倶ｸｭ縺ｮ險ｭ螳壹ｒ1莉ｶ蜿門ｾ・*/
export async function getPublishedSeasonalShiftSetting(
  id: string
): Promise<SeasonalShiftSetting | null> {
  const { data, error } = await supabase
    .from('seasonal_shift_settings')
    .select('*')
    .eq('id', id)
    .eq('status', 'published')
    .maybeSingle();

  if (error) throw new Error(`繧ｷ繝輔ヨ險ｭ螳壹・蜿門ｾ励↓螟ｱ謨励＠縺ｾ縺励◆: ${error.message}`);
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

  if (error) throw new Error(`繧ｷ繝輔ヨ險ｭ螳壹・菴懈・縺ｫ螟ｱ謨励＠縺ｾ縺励◆: ${error.message}`);
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

  if (error) throw new Error(`繧ｷ繝輔ヨ險ｭ螳壹・譖ｴ譁ｰ縺ｫ螟ｱ謨励＠縺ｾ縺励◆: ${error.message}`);
  return data as SeasonalShiftSetting;
}

export async function deleteSeasonalShiftSetting(id: string): Promise<void> {
  const { error } = await supabase.from('seasonal_shift_settings').delete().eq('id', id);
  if (error) throw new Error(`繧ｷ繝輔ヨ險ｭ螳壹・蜑企勁縺ｫ螟ｱ謨励＠縺ｾ縺励◆: ${error.message}`);
}

// ========== 髢玖ｬ帙さ繝櫁ｨｭ螳・==========

export async function getSeasonalShiftSlotSettings(
  settingId: string
): Promise<SlotSetting[]> {
  const { data, error } = await supabase
    .from('seasonal_shift_slot_settings')
    .select('*')
    .eq('setting_id', settingId);

  if (error) throw new Error(`髢玖ｬ帙さ繝櫁ｨｭ螳壹・蜿門ｾ励↓螟ｱ謨励＠縺ｾ縺励◆: ${error.message}`);
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
  if (delError) throw new Error(`髢玖ｬ帙さ繝櫁ｨｭ螳壹・蜑企勁縺ｫ螟ｱ謨励＠縺ｾ縺励◆: ${delError.message}`);

  if (items.length === 0) return;

  const rows = items.map((item) => ({
    setting_id: settingId,
    slot_date: item.slot_date,
    time_slot: item.time_slot,
    is_open: item.is_open,
  }));

  const { error: insError } = await supabase.from('seasonal_shift_slot_settings').insert(rows);
  if (insError) throw new Error(`髢玖ｬ帙さ繝櫁ｨｭ螳壹・菫晏ｭ倥↓螟ｱ謨励＠縺ｾ縺励◆: ${insError.message}`);
}

// ========== 謠仙・ ==========

export async function getSeasonalShiftSubmissions(
  settingId: string
): Promise<SeasonalShiftSubmission[]> {
  const { data, error } = await supabase
    .from('seasonal_shift_submissions')
    .select('*')
    .eq('setting_id', settingId)
    .order('submitted_at', { ascending: false });

  if (error) throw new Error(`謠仙・荳隕ｧ縺ｮ蜿門ｾ励↓螟ｱ謨励＠縺ｾ縺励◆: ${error.message}`);
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
  if (subError) throw new Error(`謠仙・縺ｮ蜿門ｾ励↓螟ｱ謨励＠縺ｾ縺励◆: ${subError.message}`);
  if (!submission) return null;

  const { data: slots, error: slotsError } = await supabase
    .from('seasonal_shift_submission_slots')
    .select('*')
    .eq('submission_id', submissionId);
  if (slotsError) throw new Error(`繧ｷ繝輔ヨ隧ｳ邏ｰ縺ｮ蜿門ｾ励↓螟ｱ謨励＠縺ｾ縺励◆: ${slotsError.message}`);

  return {
    ...(submission as SeasonalShiftSubmission),
    slots: (slots || []) as SeasonalShiftSubmissionSlot[],
  };
}

/** 菫ｮ豁｣逕ｨ繝医・繧ｯ繝ｳ縺ｧ謠仙・繧貞叙蠕暦ｼ・llow_edit 縺・true 縺ｮ縺ｨ縺阪・縺ｿ譛牙柑・・*/
export async function getSeasonalShiftSubmissionByEditToken(
  editToken: string
): Promise<SubmissionWithSlots | null> {
  const res = await fetch(`/api/seasonal-shift/public/${encodeURIComponent(editToken)}`, {
    cache: 'no-store',
  });

  if (res.status === 404) return null;

  const payload = (await res.json().catch(() => ({}))) as {
    error?: string;
    submission?: SubmissionWithSlots | null;
  };

  if (!res.ok) {
    throw new Error(payload.error ?? '提出情報の取得に失敗しました');
  }

  return payload.submission ?? null;
}

/** 驕句霧繝繝・す繝･繝懊・繝臥畑・壽律莉佚励さ繝槭＃縺ｨ縺ｮ蜃ｺ蜍､蜿ｯ閭ｽ莠ｺ謨ｰ繧帝寔險・*/
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

  if (error) throw new Error(`蜃ｺ蜍､迥ｶ豕√・髮・ｨ医↓螟ｱ謨励＠縺ｾ縺励◆: ${error.message}`);

  const counts: Record<string, number> = {};
  for (const s of slots || []) {
    const key = `${s.shift_date}|${s.time_slot}`;
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

/** 隰帛ｸｫ蛻･繧ｳ繝樊焚・亥､壹＞鬆・ｼ・*/
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

  if (error) throw new Error(`隰帛ｸｫ蛻･繧ｳ繝樊焚縺ｮ蜿門ｾ励↓螟ｱ謨励＠縺ｾ縺励◆: ${error.message}`);

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

/** 蠎ｧ蟶ｭ陦ｨ蜈･蜉帙ヵ繝ｩ繧ｰ繧呈峩譁ｰ */
export async function updateSeasonalShiftSeatChartEntered(
  submissionId: string,
  entered: boolean
): Promise<void> {
  const { error } = await supabase
    .from('seasonal_shift_submissions')
    .update({ seat_chart_entered: entered, updated_at: new Date().toISOString() })
    .eq('id', submissionId);
  if (error) throw new Error(`蠎ｧ蟶ｭ陦ｨ蜈･蜉帙・譖ｴ譁ｰ縺ｫ螟ｱ謨励＠縺ｾ縺励◆: ${error.message}`);
}

/** 謠仙・繧貞炎髯､・医せ繝ｭ繝・ヨ縺ｯ CASCADE 縺ｧ閾ｪ蜍募炎髯､・・*/
export async function deleteSeasonalShiftSubmission(submissionId: string): Promise<void> {
  const { error } = await supabase
    .from('seasonal_shift_submissions')
    .delete()
    .eq('id', submissionId);
  if (error) throw new Error(`謠仙・縺ｮ蜑企勁縺ｫ螟ｱ謨励＠縺ｾ縺励◆: ${error.message}`);
}

export async function createSeasonalShiftSubmission(
  input: SeasonalShiftSubmissionInsert,
  slots: Omit<SeasonalShiftSubmissionSlotInsert, 'submission_id'>[]
): Promise<SeasonalShiftSubmission> {
  const res = await fetch('/api/seasonal-shift/public', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...input,
      slots,
    }),
  });

  const payload = (await res.json().catch(() => ({}))) as {
    error?: string;
    submission?: SeasonalShiftSubmission;
  };

  if (!res.ok || !payload.submission) {
    throw new Error(payload.error ?? '提出の送信に失敗しました');
  }

  return payload.submission;
}

/** 菫ｮ豁｣險ｱ蜿ｯ繧剃ｻ倅ｸ趣ｼ・llow_edit=true 縺ｫ縺励‘dit_token 繧定ｿ斐☆・・*/
export async function allowSeasonalShiftEdit(submissionId: string): Promise<string> {
  const { data, error } = await supabase
    .from('seasonal_shift_submissions')
    .update({ allow_edit: true, updated_at: new Date().toISOString() })
    .eq('id', submissionId)
    .select('edit_token')
    .single();
  if (error) throw new Error(`菫ｮ豁｣險ｱ蜿ｯ縺ｮ譖ｴ譁ｰ縺ｫ螟ｱ謨励＠縺ｾ縺励◆: ${error.message}`);

  const res = await fetchWithAuth('/api/seasonal-shift/notify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'allow_edit', submissionId }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err?.error ?? '菫ｮ豁｣險ｱ蜿ｯ繝｡繝ｼ繝ｫ縺ｮ騾∽ｿ｡縺ｫ螟ｱ謨励＠縺ｾ縺励◆');
  }

  return data.edit_token as string;
}

/** 菫ｮ豁｣險ｱ蜿ｯ繝｡繝ｼ繝ｫ繧貞・騾・ｼ・llow_edit=true 縺ｮ謠仙・蜷代￠・・*/
export async function resendSeasonalShiftEditEmail(submissionId: string): Promise<void> {
  const res = await fetchWithAuth('/api/seasonal-shift/notify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'allow_edit', submissionId }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err?.error ?? '菫ｮ豁｣險ｱ蜿ｯ繝｡繝ｼ繝ｫ縺ｮ蜀埼√↓螟ｱ謨励＠縺ｾ縺励◆');
  }
}

/** 繝医・繧ｯ繝ｳ縺ｧ謠仙・繧呈峩譁ｰ・亥・謠仙・蠕後・ allow_edit 繧・false 縺ｫ・・*/
export async function updateSeasonalShiftSubmissionByToken(
  editToken: string,
  input: { teacher_name: string; teacher_email: string; notes?: string },
  slots: Omit<SeasonalShiftSubmissionSlotInsert, 'submission_id'>[]
): Promise<SeasonalShiftSubmission | null> {
  const res = await fetch(`/api/seasonal-shift/public/${encodeURIComponent(editToken)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...input,
      slots,
    }),
  });

  if (res.status === 404) return null;

  const payload = (await res.json().catch(() => ({}))) as {
    error?: string;
    submission?: SubmissionWithSlots | null;
  };

  if (!res.ok) {
    throw new Error(payload.error ?? '提出内容の更新に失敗しました');
  }

  return (payload.submission as SeasonalShiftSubmission | null) ?? null;
}
