import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { normalizePersonName } from '@/lib/utils/personName';

export const dynamic = 'force-dynamic';

type PublicSubmissionRequest = {
  setting_id?: string;
  school_id?: string;
  teacher_name?: string;
  teacher_email?: string;
  notes?: string;
  slots?: Array<{
    day_of_week?: number;
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
        notificationType: 'regular-shift',
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
    .filter(
      (slot) =>
        slot &&
        typeof slot.day_of_week === 'number' &&
        slot.day_of_week >= 0 &&
        slot.day_of_week <= 6 &&
        typeof slot.time_slot === 'string'
    )
    .map((slot) => ({
      day_of_week: slot!.day_of_week!,
      time_slot: slot!.time_slot!.trim(),
      available: slot?.available !== false,
    }))
    .filter((slot) => slot.time_slot);
}

/** POST: Create a new regular shift submission (public, no auth required) */
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

    // Verify setting exists and is published
    const { data: setting, error: settingError } = await supabaseAdmin
      .from('regular_shift_settings')
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

    // Check deadline
    if (setting.deadline) {
      const deadline = new Date(`${setting.deadline}T23:59:59`);
      if (Number.isFinite(deadline.getTime()) && new Date() > deadline) {
        return NextResponse.json(
          { error: 'Submission deadline has passed' },
          { status: 400 }
        );
      }
    }

    // 講師アカウント紐づけ: (1) メール一致 (2) 同一教室の氏名一致（候補1名のみ）
    const { data: matchedProfile } = await supabaseAdmin
      .from('user_profiles')
      .select('id')
      .ilike('email', teacherEmail)
      .eq('role', 'teacher')
      .eq('is_active', true)
      .maybeSingle();
    let linkedUserId = matchedProfile?.id ?? null;

    if (!linkedUserId) {
      const nameKey = normalizePersonName(teacherName);
      if (nameKey) {
        const { data: schoolLinks } = await supabaseAdmin
          .from('user_schools')
          .select('user_id')
          .eq('school_id', schoolId);
        const schoolUserIds = (schoolLinks ?? []).map((r) => r.user_id);
        if (schoolUserIds.length > 0) {
          const { data: schoolTeachers } = await supabaseAdmin
            .from('user_profiles')
            .select('id, display_name')
            .in('id', schoolUserIds)
            .eq('role', 'teacher')
            .eq('is_active', true);
          const nameMatches = (schoolTeachers ?? []).filter(
            (t) => normalizePersonName(t.display_name) === nameKey
          );
          if (nameMatches.length === 1) linkedUserId = nameMatches[0].id;
        }
      }
    }

    // Insert submission
    const { data: submission, error: submissionError } = await supabaseAdmin
      .from('regular_shift_submissions')
      .insert({
        setting_id: settingId,
        school_id: schoolId,
        teacher_name: teacherName,
        teacher_email: teacherEmail,
        notes,
        user_id: linkedUserId,
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

    // Insert slots
    if (slots.length > 0) {
      const { error: slotError } = await supabaseAdmin
        .from('regular_shift_submission_slots')
        .insert(
          slots.map((slot) => ({
            submission_id: submission.id,
            day_of_week: slot.day_of_week,
            time_slot: slot.time_slot,
            available: slot.available,
          }))
        );

      if (slotError) {
        throw slotError;
      }
    }

    // 講師＆教室に確認メール送信
    try {
      await invokeNotification(supabaseAdmin, 'submitted', submission.id);
    } catch (notifyError) {
      console.warn('[regular-shift/public] notify failed:', notifyError);
    }

    return NextResponse.json({ submission });
  } catch (error) {
    console.error('[regular-shift/public] create failed:', error);
    return NextResponse.json(
      { error: 'Failed to submit' },
      { status: 500 }
    );
  }
}

/** GET: Fetch a published regular shift setting with its slot settings */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const settingId = searchParams.get('settingId')?.trim();

    if (!settingId) {
      return NextResponse.json(
        { error: 'settingId is required' },
        { status: 400 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();

    const { data: setting, error: settingError } = await supabaseAdmin
      .from('regular_shift_settings')
      .select('*')
      .eq('id', settingId)
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

    const { data: slotSettings, error: slotError } = await supabaseAdmin
      .from('regular_shift_slot_settings')
      .select('*')
      .eq('setting_id', settingId);

    if (slotError) {
      throw slotError;
    }

    return NextResponse.json({ setting, slotSettings: slotSettings ?? [] });
  } catch (error) {
    console.error('[regular-shift/public] GET failed:', error);
    return NextResponse.json(
      { error: 'Failed to get setting' },
      { status: 500 }
    );
  }
}
