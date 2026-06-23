import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getApiAuth } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) throw new Error('Supabase env not set');
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function invokeNotification(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  submissionId: string
) {
  const { data, error } = await supabaseAdmin.functions.invoke('send-form-notification', {
    body: { notificationType: 'seasonal-shift', type: 'submitted', submissionId },
  });
  if (error) throw new Error(error.message || 'notification_failed');
  if (data && typeof data === 'object' && 'error' in data) {
    throw new Error(String((data as { error: unknown }).error || 'notification_failed'));
  }
}

function normalizeSlots(
  input: Array<{ shift_date?: string; time_slot?: string; available?: boolean }> | undefined
) {
  if (!Array.isArray(input)) return [];
  return input
    .filter((s) => s && typeof s.shift_date === 'string' && typeof s.time_slot === 'string')
    .map((s) => ({
      shift_date: s.shift_date!.trim(),
      time_slot: s.time_slot!.trim(),
      available: s.available !== false,
    }))
    .filter((s) => s.shift_date && s.time_slot);
}

// GET /api/seasonal-shift/me?setting_id=xxx
// 現在ログイン中のユーザーの提出を返す（なければ submission: null）
export async function GET(request: NextRequest) {
  const { auth } = await getApiAuth(request);
  if (!auth) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const settingId = request.nextUrl.searchParams.get('setting_id')?.trim();
  if (!settingId) {
    return NextResponse.json({ error: 'setting_id is required' }, { status: 400 });
  }

  const supabaseAdmin = getSupabaseAdmin();
  const { data: submission, error } = await supabaseAdmin
    .from('seasonal_shift_submissions')
    .select('*, slots:seasonal_shift_submission_slots(*)')
    .eq('setting_id', settingId)
    .eq('user_id', auth.userId)
    .maybeSingle();

  if (error) {
    console.error('[seasonal-shift/me] GET failed:', error);
    return NextResponse.json({ error: 'Failed to fetch submission' }, { status: 500 });
  }

  return NextResponse.json({ submission: submission ?? null });
}

type SubmissionBody = {
  setting_id?: string;
  school_id?: string;
  notes?: string;
  slots?: Array<{ shift_date?: string; time_slot?: string; available?: boolean }>;
};

// POST /api/seasonal-shift/me — 新規提出
export async function POST(request: NextRequest) {
  const { auth } = await getApiAuth(request);
  if (!auth) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const body = (await request.json()) as SubmissionBody;
  const settingId = body.setting_id?.trim();
  const schoolId = body.school_id?.trim();
  const notes = body.notes?.trim() ?? '';
  const slots = normalizeSlots(body.slots);

  if (!settingId || !schoolId) {
    return NextResponse.json({ error: 'setting_id and school_id are required' }, { status: 400 });
  }

  const supabaseAdmin = getSupabaseAdmin();

  const { data: setting, error: settingError } = await supabaseAdmin
    .from('seasonal_shift_settings')
    .select('id, school_id, status, deadline')
    .eq('id', settingId)
    .eq('school_id', schoolId)
    .eq('status', 'published')
    .maybeSingle();

  if (settingError) {
    console.error('[seasonal-shift/me] POST setting lookup failed:', settingError);
    return NextResponse.json({ error: 'Failed to validate setting' }, { status: 500 });
  }
  if (!setting) {
    return NextResponse.json({ error: 'Published shift setting not found' }, { status: 404 });
  }

  const deadline = new Date(`${setting.deadline}T23:59:59`);
  if (Number.isFinite(deadline.getTime()) && new Date() > deadline) {
    return NextResponse.json({ error: 'Submission deadline has passed' }, { status: 400 });
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('user_profiles')
    .select('email, display_name')
    .eq('id', auth.userId)
    .maybeSingle();

  if (profileError || !profile) {
    return NextResponse.json({ error: 'User profile not found' }, { status: 404 });
  }

  const teacherName = profile.display_name ?? profile.email;
  const teacherEmail = profile.email;

  const { data: submission, error: submissionError } = await supabaseAdmin
    .from('seasonal_shift_submissions')
    .insert({
      setting_id: settingId,
      school_id: schoolId,
      teacher_name: teacherName,
      teacher_email: teacherEmail,
      notes,
      user_id: auth.userId,
    })
    .select('*')
    .single();

  if (submissionError) {
    if (submissionError.code === '23505') {
      return NextResponse.json({ error: 'Already submitted' }, { status: 409 });
    }
    console.error('[seasonal-shift/me] POST insert failed:', submissionError);
    return NextResponse.json({ error: 'Failed to submit' }, { status: 500 });
  }

  if (slots.length > 0) {
    const { error: slotError } = await supabaseAdmin.from('seasonal_shift_submission_slots').insert(
      slots.map((slot) => ({
        submission_id: submission.id,
        shift_date: slot.shift_date,
        time_slot: slot.time_slot,
        available: slot.available,
      }))
    );
    if (slotError) {
      console.error('[seasonal-shift/me] POST slots insert failed:', slotError);
      return NextResponse.json({ error: 'Failed to save slots' }, { status: 500 });
    }
  }

  try {
    await invokeNotification(supabaseAdmin, submission.id);
  } catch (err) {
    console.warn('[seasonal-shift/me] notify failed:', err);
  }

  return NextResponse.json({ submission });
}

// PUT /api/seasonal-shift/me — 修正再提出（allow_edit=true のとき）
export async function PUT(request: NextRequest) {
  const { auth } = await getApiAuth(request);
  if (!auth) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const body = (await request.json()) as SubmissionBody;
  const settingId = body.setting_id?.trim();
  const notes = body.notes?.trim() ?? '';
  const slots = normalizeSlots(body.slots);

  if (!settingId) {
    return NextResponse.json({ error: 'setting_id is required' }, { status: 400 });
  }

  const supabaseAdmin = getSupabaseAdmin();

  const { data: existing, error: fetchError } = await supabaseAdmin
    .from('seasonal_shift_submissions')
    .select('id, allow_edit')
    .eq('setting_id', settingId)
    .eq('user_id', auth.userId)
    .maybeSingle();

  if (fetchError) {
    console.error('[seasonal-shift/me] PUT fetch failed:', fetchError);
    return NextResponse.json({ error: 'Failed to fetch submission' }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: 'Submission not found' }, { status: 404 });
  }
  if (!existing.allow_edit) {
    return NextResponse.json({ error: '修正が許可されていません' }, { status: 403 });
  }

  const { error: updateError } = await supabaseAdmin
    .from('seasonal_shift_submissions')
    .update({
      notes,
      allow_edit: false,
      submitted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', existing.id);

  if (updateError) {
    console.error('[seasonal-shift/me] PUT update failed:', updateError);
    return NextResponse.json({ error: 'Failed to update submission' }, { status: 500 });
  }

  const { error: deleteError } = await supabaseAdmin
    .from('seasonal_shift_submission_slots')
    .delete()
    .eq('submission_id', existing.id);

  if (deleteError) {
    console.error('[seasonal-shift/me] PUT delete slots failed:', deleteError);
    return NextResponse.json({ error: 'Failed to update slots' }, { status: 500 });
  }

  if (slots.length > 0) {
    const { error: insertError } = await supabaseAdmin
      .from('seasonal_shift_submission_slots')
      .insert(
        slots.map((slot) => ({
          submission_id: existing.id,
          shift_date: slot.shift_date,
          time_slot: slot.time_slot,
          available: slot.available,
        }))
      );
    if (insertError) {
      console.error('[seasonal-shift/me] PUT insert slots failed:', insertError);
      return NextResponse.json({ error: 'Failed to save slots' }, { status: 500 });
    }
  }

  const { data: updated } = await supabaseAdmin
    .from('seasonal_shift_submissions')
    .select('*, slots:seasonal_shift_submission_slots(*)')
    .eq('id', existing.id)
    .maybeSingle();

  return NextResponse.json({ submission: updated });
}
