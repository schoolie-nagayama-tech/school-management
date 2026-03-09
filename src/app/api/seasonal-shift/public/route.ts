import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

type PublicSubmissionRequest = {
  setting_id?: string;
  school_id?: string;
  teacher_name?: string;
  teacher_email?: string;
  notes?: string;
  slots?: Array<{
    shift_date?: string;
    time_slot?: string;
    available?: boolean;
  }>;
};

function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase env not set');
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function invokeNotification(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  type: 'submitted' | 'allow_edit',
  submissionId: string
) {
  const { data, error } = await supabaseAdmin.functions.invoke(
    'send-form-notification',
    {
      body: {
        notificationType: 'seasonal-shift',
        type,
        submissionId,
      },
    }
  );

  if (error) {
    throw new Error(error.message || 'notification_failed');
  }

  if (data && typeof data === 'object' && 'error' in data) {
    throw new Error(String((data as { error: unknown }).error || 'notification_failed'));
  }
}

function normalizeSlots(input: PublicSubmissionRequest['slots']) {
  if (!Array.isArray(input)) return [];

  return input
    .filter((slot) => slot && typeof slot.shift_date === 'string' && typeof slot.time_slot === 'string')
    .map((slot) => ({
      shift_date: slot!.shift_date!.trim(),
      time_slot: slot!.time_slot!.trim(),
      available: slot?.available !== false,
    }))
    .filter((slot) => slot.shift_date && slot.time_slot);
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as PublicSubmissionRequest;
    const settingId = body.setting_id?.trim();
    const schoolId = body.school_id?.trim();
    const teacherName = body.teacher_name?.trim();
    const teacherEmail = body.teacher_email?.trim().toLowerCase();
    const notes = body.notes?.trim() ?? '';
    const slots = normalizeSlots(body.slots);

    if (!settingId || !schoolId || !teacherName || !teacherEmail) {
      return NextResponse.json(
        { error: 'setting_id, school_id, teacher_name, teacher_email are required' },
        { status: 400 }
      );
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
      throw settingError;
    }

    if (!setting) {
      return NextResponse.json(
        { error: 'Published shift setting not found' },
        { status: 404 }
      );
    }

    const deadline = new Date(`${setting.deadline}T23:59:59`);
    if (Number.isFinite(deadline.getTime()) && new Date() > deadline) {
      return NextResponse.json(
        { error: 'Submission deadline has passed' },
        { status: 400 }
      );
    }

    const { data: submission, error: submissionError } = await supabaseAdmin
      .from('seasonal_shift_submissions')
      .insert({
        setting_id: settingId,
        school_id: schoolId,
        teacher_name: teacherName,
        teacher_email: teacherEmail,
        notes,
      })
      .select('*')
      .single();

    if (submissionError) {
      if (submissionError.code === '23505') {
        return NextResponse.json(
          { error: 'This teacher has already submitted' },
          { status: 409 }
        );
      }
      throw submissionError;
    }

    if (slots.length > 0) {
      const { error: slotError } = await supabaseAdmin
        .from('seasonal_shift_submission_slots')
        .insert(
          slots.map((slot) => ({
            submission_id: submission.id,
            shift_date: slot.shift_date,
            time_slot: slot.time_slot,
            available: slot.available,
          }))
        );

      if (slotError) {
        throw slotError;
      }
    }

    try {
      await invokeNotification(supabaseAdmin, 'submitted', submission.id);
    } catch (error) {
      console.warn('[seasonal-shift/public] notify failed:', error);
    }

    return NextResponse.json({ submission });
  } catch (error) {
    console.error('[seasonal-shift/public] create failed:', error);
    return NextResponse.json(
      { error: 'Failed to submit' },
      { status: 500 }
    );
  }
}
