/**
 * Seasonal shift submission API
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

// ========== Settings ==========

export async function getSeasonalShiftSettings(schoolId: string): Promise<SeasonalShiftSetting[]> {
  const { data, error } = await supabase
    .from('seasonal_shift_settings')
    .select('*')
    .eq('school_id', schoolId)
    .order('start_date', { ascending: false });

  if (error) throw new Error(`Failed to get shift settings: ${error.message}`);
  return (data || []) as SeasonalShiftSetting[];
}

export async function getSeasonalShiftSetting(id: string): Promise<SeasonalShiftSetting | null> {
  const { data, error } = await supabase
    .from('seasonal_shift_settings')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw new Error(`Failed to get shift settings: ${error.message}`);
  return data as SeasonalShiftSetting | null;
}

/** Get published setting by id */
export async function getPublishedSeasonalShiftSetting(
  id: string
): Promise<SeasonalShiftSetting | null> {
  const { data, error } = await supabase
    .from('seasonal_shift_settings')
    .select('*')
    .eq('id', id)
    .eq('status', 'published')
    .maybeSingle();

  if (error) throw new Error(`Failed to get shift settings: ${error.message}`);
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

  if (error) throw new Error(`Failed to get shift settings: ${error.message}`);
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

  if (error) throw new Error(`Failed to update shift setting: ${error.message}`);
  return data as SeasonalShiftSetting;
}

export async function deleteSeasonalShiftSetting(id: string): Promise<void> {
  const { error } = await supabase.from('seasonal_shift_settings').delete().eq('id', id);
  if (error) throw new Error(`Failed to delete shift setting: ${error.message}`);
}

// ========== Slot settings ==========

export async function getSeasonalShiftSlotSettings(
  settingId: string
): Promise<SlotSetting[]> {
  const { data, error } = await supabase
    .from('seasonal_shift_slot_settings')
    .select('*')
    .eq('setting_id', settingId);

  if (error) throw new Error(`Failed to get shift settings: ${error.message}`);
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
  if (delError) throw new Error(`Failed to delete slot settings: ${delError.message}`);

  if (items.length === 0) return;

  const rows = items.map((item) => ({
    setting_id: settingId,
    slot_date: item.slot_date,
    time_slot: item.time_slot,
    is_open: item.is_open,
  }));

  const { error: insError } = await supabase.from('seasonal_shift_slot_settings').insert(rows);
  if (insError) throw new Error(`Failed to save slot settings: ${insError.message}`);
}

// ========== Submissions ==========

export async function getSeasonalShiftSubmissions(
  settingId: string
): Promise<SeasonalShiftSubmission[]> {
  const { data, error } = await supabase
    .from('seasonal_shift_submissions')
    .select('*')
    .eq('setting_id', settingId)
    .order('submitted_at', { ascending: false });

  if (error) throw new Error(`Failed to get submissions: ${error.message}`);
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
  if (subError) throw new Error(`Failed to get submission: ${subError.message}`);
  if (!submission) return null;

  const { data: slots, error: slotsError } = await supabase
    .from('seasonal_shift_submission_slots')
    .select('*')
    .eq('submission_id', submissionId);
  if (slotsError) throw new Error(`Failed to get shift details: ${slotsError.message}`);

  return {
    ...(submission as SeasonalShiftSubmission),
    slots: (slots || []) as SeasonalShiftSubmissionSlot[],
  };
}

/** Get submission by edit token (valid when allow_edit is true) */
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
    throw new Error(payload.error ?? 'Failed to get submission');
  }

  return payload.submission ?? null;
}

/** Count attendance by date and slot */
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

  if (error) throw new Error(`Failed to count attendance: ${error.message}`);

  const counts: Record<string, number> = {};
  for (const s of slots || []) {
    const key = `${s.shift_date}|${s.time_slot}`;
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

/** Teacher slot counts (most first) */
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

  if (error) throw new Error(`Failed to get shift settings: ${error.message}`);

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

/** Update seat chart entered flag */
export async function updateSeasonalShiftSeatChartEntered(
  submissionId: string,
  entered: boolean
): Promise<void> {
  const { error } = await supabase
    .from('seasonal_shift_submissions')
    .update({ seat_chart_entered: entered, updated_at: new Date().toISOString() })
    .eq('id', submissionId);
  if (error) throw new Error(`Failed to update seat chart: ${error.message}`);
}

/** Delete submission (slots are cascade deleted) */
export async function deleteSeasonalShiftSubmission(submissionId: string): Promise<void> {
  const { error } = await supabase
    .from('seasonal_shift_submissions')
    .delete()
    .eq('id', submissionId);
  if (error) throw new Error(`Failed to delete submission: ${error.message}`);
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
    throw new Error(payload.error ?? 'Failed to submit');
  }

  return payload.submission;
}

/** Grant edit permission (allow_edit=true, returns edit_token) */
export async function allowSeasonalShiftEdit(submissionId: string): Promise<string> {
  const { data, error } = await supabase
    .from('seasonal_shift_submissions')
    .update({ allow_edit: true, updated_at: new Date().toISOString() })
    .eq('id', submissionId)
    .select('edit_token')
    .single();
  if (error) throw new Error(`Failed to update edit permission: ${error.message}`);

  const res = await fetchWithAuth('/api/seasonal-shift/notify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'allow_edit', submissionId }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err?.error ?? 'Failed to send edit permission email');
  }

  return data.edit_token as string;
}

/** Resend edit permission email (for allow_edit=true submissions) */
export async function resendSeasonalShiftEditEmail(submissionId: string): Promise<void> {
  const res = await fetchWithAuth('/api/seasonal-shift/notify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'allow_edit', submissionId }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err?.error ?? 'Failed to resend edit email');
  }
}

// ========== Account-based submission (teacher logged in) ==========

/** Get current user's submission for a setting (null if not submitted) */
export async function getMySeasonalShiftSubmission(
  settingId: string
): Promise<SubmissionWithSlots | null> {
  const res = await fetchWithAuth(
    `/api/seasonal-shift/me?setting_id=${encodeURIComponent(settingId)}`
  );
  if (res.status === 401) throw new Error('認証が必要です');
  const payload = (await res.json().catch(() => ({}))) as {
    error?: string;
    submission?: SubmissionWithSlots | null;
  };
  if (!res.ok) throw new Error(payload.error ?? 'Failed to fetch submission');
  return payload.submission ?? null;
}

/** Submit shift as logged-in teacher (name/email auto-filled from profile) */
export async function createMySeasonalShiftSubmission(
  input: Pick<SeasonalShiftSubmissionInsert, 'setting_id' | 'school_id' | 'notes'>,
  slots: Omit<SeasonalShiftSubmissionSlotInsert, 'submission_id'>[]
): Promise<SeasonalShiftSubmission> {
  const res = await fetchWithAuth('/api/seasonal-shift/me', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...input, slots }),
  });
  const payload = (await res.json().catch(() => ({}))) as {
    error?: string;
    submission?: SeasonalShiftSubmission;
  };
  if (!res.ok || !payload.submission) throw new Error(payload.error ?? 'Failed to submit');
  return payload.submission;
}

/** Re-submit shift as logged-in teacher (allow_edit=true required) */
export async function updateMySeasonalShiftSubmission(
  settingId: string,
  input: { notes?: string },
  slots: Omit<SeasonalShiftSubmissionSlotInsert, 'submission_id'>[]
): Promise<SeasonalShiftSubmission> {
  const res = await fetchWithAuth('/api/seasonal-shift/me', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ setting_id: settingId, ...input, slots }),
  });
  const payload = (await res.json().catch(() => ({}))) as {
    error?: string;
    submission?: SeasonalShiftSubmission;
  };
  if (!res.ok || !payload.submission) throw new Error(payload.error ?? 'Failed to update');
  return payload.submission;
}

/** Update submission by token (after resubmit, allow_edit becomes false) */
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
    throw new Error(payload.error ?? 'Failed to update submission');
  }

  return (payload.submission as SeasonalShiftSubmission | null) ?? null;
}
