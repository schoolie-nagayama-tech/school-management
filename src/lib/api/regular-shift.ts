/**
 * Regular shift submission API (通常シフト — 曜日×時間帯マトリクス)
 */
import { supabase } from '@/lib/supabase';
import { fetchWithAuth } from '@/lib/api/auth';
import type {
  RegularShiftSetting,
  RegularShiftSettingInsert,
  RegularShiftSlotSetting,
  RegularShiftSubmission,
  RegularShiftSubmissionInsert,
  RegularShiftSubmissionSlot,
  RegularShiftSubmissionSlotInsert,
  RegularShiftSubmissionWithSlots,
} from '@/types/regular-shift';

// ========== Settings ==========

export async function getRegularShiftSettings(schoolId: string): Promise<RegularShiftSetting[]> {
  const { data, error } = await supabase
    .from('regular_shift_settings')
    .select('*')
    .eq('school_id', schoolId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Failed to get regular shift settings: ${error.message}`);
  return (data || []) as RegularShiftSetting[];
}

export async function getRegularShiftSetting(id: string): Promise<RegularShiftSetting | null> {
  const { data, error } = await supabase
    .from('regular_shift_settings')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw new Error(`Failed to get regular shift setting: ${error.message}`);
  return data as RegularShiftSetting | null;
}

/** Get published setting by id */
export async function getPublishedRegularShiftSetting(
  id: string
): Promise<RegularShiftSetting | null> {
  const { data, error } = await supabase
    .from('regular_shift_settings')
    .select('*')
    .eq('id', id)
    .eq('status', 'published')
    .maybeSingle();

  if (error) throw new Error(`Failed to get regular shift setting: ${error.message}`);
  return data as RegularShiftSetting | null;
}

/** Get published setting with slot settings via public API (no auth required) */
export async function getPublishedRegularShiftSettingPublic(
  settingId: string
): Promise<{ setting: RegularShiftSetting; slotSettings: RegularShiftSlotSetting[] } | null> {
  const res = await fetch(`/api/regular-shift/public?settingId=${encodeURIComponent(settingId)}`, {
    cache: 'no-store',
  });

  if (res.status === 404) return null;

  const payload = (await res.json().catch(() => ({}))) as {
    error?: string;
    setting?: RegularShiftSetting;
    slotSettings?: RegularShiftSlotSetting[];
  };

  if (!res.ok || !payload.setting) return null;

  return { setting: payload.setting, slotSettings: payload.slotSettings ?? [] };
}

export async function createRegularShiftSetting(
  input: RegularShiftSettingInsert
): Promise<RegularShiftSetting> {
  const { data, error } = await supabase
    .from('regular_shift_settings')
    .insert({
      school_id: input.school_id,
      name: input.name,
      deadline: input.deadline ?? null,
      description: input.description ?? '',
      weekday_slots: input.weekday_slots,
      saturday_slots: input.saturday_slots,
      status: input.status ?? 'draft',
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create regular shift setting: ${error.message}`);
  return data as RegularShiftSetting;
}

export async function updateRegularShiftSetting(
  id: string,
  input: Partial<Omit<RegularShiftSettingInsert, 'school_id'>>
): Promise<RegularShiftSetting> {
  const { data, error } = await supabase
    .from('regular_shift_settings')
    .update({
      ...input,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error(`Failed to update regular shift setting: ${error.message}`);
  return data as RegularShiftSetting;
}

export async function deleteRegularShiftSetting(id: string): Promise<void> {
  const { error } = await supabase.from('regular_shift_settings').delete().eq('id', id);
  if (error) throw new Error(`Failed to delete regular shift setting: ${error.message}`);
}

// ========== Slot settings ==========

export async function getRegularShiftSlotSettings(
  settingId: string
): Promise<RegularShiftSlotSetting[]> {
  const { data, error } = await supabase
    .from('regular_shift_slot_settings')
    .select('*')
    .eq('setting_id', settingId);

  if (error) throw new Error(`Failed to get regular shift slot settings: ${error.message}`);
  return (data || []) as RegularShiftSlotSetting[];
}

export async function setRegularShiftSlotSettings(
  settingId: string,
  items: Omit<RegularShiftSlotSetting, 'id' | 'created_at'>[]
): Promise<void> {
  const { error: delError } = await supabase
    .from('regular_shift_slot_settings')
    .delete()
    .eq('setting_id', settingId);
  if (delError) throw new Error(`Failed to delete slot settings: ${delError.message}`);

  if (items.length === 0) return;

  const rows = items.map((item) => ({
    setting_id: settingId,
    day_of_week: item.day_of_week,
    time_slot: item.time_slot,
    is_open: item.is_open,
  }));

  const { error: insError } = await supabase.from('regular_shift_slot_settings').insert(rows);
  if (insError) throw new Error(`Failed to save slot settings: ${insError.message}`);
}

// ========== Submissions ==========

export async function getRegularShiftSubmissions(
  settingId: string
): Promise<RegularShiftSubmission[]> {
  const { data, error } = await supabase
    .from('regular_shift_submissions')
    .select('*')
    .eq('setting_id', settingId)
    .order('submitted_at', { ascending: false });

  if (error) throw new Error(`Failed to get submissions: ${error.message}`);
  return (data || []) as RegularShiftSubmission[];
}

export async function getRegularShiftSubmissionWithSlots(
  submissionId: string
): Promise<RegularShiftSubmissionWithSlots | null> {
  const { data: submission, error: subError } = await supabase
    .from('regular_shift_submissions')
    .select('*')
    .eq('id', submissionId)
    .maybeSingle();
  if (subError) throw new Error(`Failed to get submission: ${subError.message}`);
  if (!submission) return null;

  const { data: slots, error: slotsError } = await supabase
    .from('regular_shift_submission_slots')
    .select('*')
    .eq('submission_id', submissionId);
  if (slotsError) throw new Error(`Failed to get shift details: ${slotsError.message}`);

  return {
    ...(submission as RegularShiftSubmission),
    slots: (slots || []) as RegularShiftSubmissionSlot[],
  };
}

/** Get submission by edit token (valid when allow_edit is true) */
export async function getRegularShiftSubmissionByEditToken(
  editToken: string
): Promise<RegularShiftSubmissionWithSlots | null> {
  const res = await fetch(`/api/regular-shift/public/${encodeURIComponent(editToken)}`, {
    cache: 'no-store',
  });

  if (res.status === 404) return null;

  const payload = (await res.json().catch(() => ({}))) as {
    error?: string;
    submission?: RegularShiftSubmissionWithSlots | null;
  };

  if (!res.ok) {
    throw new Error(payload.error ?? 'Failed to get submission');
  }

  return payload.submission ?? null;
}

/** Count attendance by day_of_week and slot */
export async function getRegularShiftAttendanceCounts(
  settingId: string
): Promise<Record<string, number>> {
  const submissions = await getRegularShiftSubmissions(settingId);
  const ids = submissions.map((s) => s.id);
  if (ids.length === 0) return {};

  const { data: slots, error } = await supabase
    .from('regular_shift_submission_slots')
    .select('day_of_week, time_slot')
    .in('submission_id', ids)
    .eq('available', true);

  if (error) throw new Error(`Failed to count attendance: ${error.message}`);

  const counts: Record<string, number> = {};
  for (const s of slots || []) {
    const key = `${s.day_of_week}|${s.time_slot}`;
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

/** Teacher slot counts (most first) */
export async function getRegularShiftTeacherSlotCounts(
  settingId: string
): Promise<{ teacher_name: string; teacher_email: string; count: number }[]> {
  const submissions = await getRegularShiftSubmissions(settingId);
  const ids = submissions.map((s) => s.id);
  if (ids.length === 0) return [];

  const { data: slots, error } = await supabase
    .from('regular_shift_submission_slots')
    .select('submission_id')
    .in('submission_id', ids)
    .eq('available', true);

  if (error) throw new Error(`Failed to get slot counts: ${error.message}`);

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

/** Toggle seat_chart_entered flag */
export async function toggleRegularShiftSeatChartEntered(
  submissionId: string,
  entered: boolean
): Promise<void> {
  const { error } = await supabase
    .from('regular_shift_submissions')
    .update({ seat_chart_entered: entered, updated_at: new Date().toISOString() })
    .eq('id', submissionId);
  if (error) throw new Error(`座席表反映の更新に失敗しました: ${error.message}`);
}

/** Delete submission (slots are cascade deleted) */
export async function deleteRegularShiftSubmission(submissionId: string): Promise<void> {
  const { error } = await supabase
    .from('regular_shift_submissions')
    .delete()
    .eq('id', submissionId);
  if (error) throw new Error(`Failed to delete submission: ${error.message}`);
}

export async function createRegularShiftSubmission(
  input: RegularShiftSubmissionInsert,
  slots: Omit<RegularShiftSubmissionSlotInsert, 'submission_id'>[]
): Promise<RegularShiftSubmission> {
  const res = await fetch('/api/regular-shift/public', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...input,
      slots,
    }),
  });

  const payload = (await res.json().catch(() => ({}))) as {
    error?: string;
    submission?: RegularShiftSubmission;
  };

  if (!res.ok || !payload.submission) {
    throw new Error(payload.error ?? 'Failed to submit');
  }

  return payload.submission;
}

/** Grant edit permission (allow_edit=true, returns edit_token) */
export async function allowRegularShiftEdit(submissionId: string): Promise<string> {
  const { data, error } = await supabase
    .from('regular_shift_submissions')
    .update({ allow_edit: true, updated_at: new Date().toISOString() })
    .eq('id', submissionId)
    .select('edit_token')
    .single();
  if (error) throw new Error(`Failed to update edit permission: ${error.message}`);

  return data.edit_token as string;
}

/** Resend edit permission email */
export async function resendRegularShiftEditEmail(submissionId: string): Promise<void> {
  const res = await fetchWithAuth('/api/regular-shift/notify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'allow_edit', submissionId }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err?.error ?? 'Failed to resend edit email');
  }
}

/** Update submission by id (used from edit page after token lookup) */
export async function updateRegularShiftSubmission(
  submissionId: string,
  input: { teacher_name: string; teacher_email: string; notes?: string },
  slots: Omit<RegularShiftSubmissionSlotInsert, 'submission_id'>[]
): Promise<RegularShiftSubmission | null> {
  // Update via the edit-token route is preferred for public use;
  // this variant looks up the token from the submission id then delegates.
  const { data, error } = await supabase
    .from('regular_shift_submissions')
    .select('edit_token')
    .eq('id', submissionId)
    .maybeSingle();

  if (error) throw new Error(`Failed to get submission: ${error.message}`);
  if (!data?.edit_token) return null;

  return updateRegularShiftSubmissionByToken(data.edit_token, input, slots);
}

/** Update submission by token (after resubmit, allow_edit becomes false) */
export async function updateRegularShiftSubmissionByToken(
  editToken: string,
  input: { teacher_name: string; teacher_email: string; notes?: string },
  slots: Omit<RegularShiftSubmissionSlotInsert, 'submission_id'>[]
): Promise<RegularShiftSubmission | null> {
  const res = await fetch(`/api/regular-shift/public/${encodeURIComponent(editToken)}`, {
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
    submission?: RegularShiftSubmissionWithSlots | null;
  };

  if (!res.ok) {
    throw new Error(payload.error ?? 'Failed to update submission');
  }

  return (payload.submission as RegularShiftSubmission | null) ?? null;
}
