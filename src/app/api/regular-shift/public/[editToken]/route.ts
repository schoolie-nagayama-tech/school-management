import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { syncRegularShiftToAvailability } from '@/lib/api/teacher-availability';

export const dynamic = 'force-dynamic';

type PublicUpdateRequest = {
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

function normalizeSlots(input: PublicUpdateRequest['slots']) {
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

async function getSubmissionByToken(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  editToken: string
) {
  const { data: submission, error: submissionError } = await supabaseAdmin
    .from('regular_shift_submissions')
    .select('*')
    .eq('edit_token', editToken)
    .eq('allow_edit', true)
    .maybeSingle();

  if (submissionError) {
    throw submissionError;
  }

  if (!submission) {
    return null;
  }

  const { data: slots, error: slotError } = await supabaseAdmin
    .from('regular_shift_submission_slots')
    .select('*')
    .eq('submission_id', submission.id);

  if (slotError) {
    throw slotError;
  }

  return {
    ...submission,
    slots: slots ?? [],
  };
}

/** GET: Fetch submission by edit token */
export async function GET(_request: NextRequest, { params }: { params: { editToken: string } }) {
  try {
    const editToken = params.editToken?.trim();
    if (!editToken) {
      return NextResponse.json({ error: 'editToken is required' }, { status: 400 });
    }

    const submission = await getSubmissionByToken(getSupabaseAdmin(), editToken);
    if (!submission) {
      return NextResponse.json({ submission: null }, { status: 404 });
    }

    return NextResponse.json({ submission });
  } catch (error) {
    console.error('[regular-shift/public] fetch failed:', error);
    return NextResponse.json({ error: 'Failed to get submission' }, { status: 500 });
  }
}

/** PUT: Update submission by edit token */
export async function PUT(request: NextRequest, { params }: { params: { editToken: string } }) {
  try {
    const editToken = params.editToken?.trim();
    if (!editToken) {
      return NextResponse.json({ error: 'editToken is required' }, { status: 400 });
    }

    const body = (await request.json()) as PublicUpdateRequest;
    const teacherName = body.teacher_name?.trim();
    const teacherEmail = body.teacher_email?.trim().toLowerCase();
    const notes = body.notes?.trim() ?? '';
    const slots = normalizeSlots(body.slots);

    if (!teacherName || !teacherEmail) {
      return NextResponse.json(
        { error: 'teacher_name and teacher_email are required' },
        { status: 400 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();
    const existing = await getSubmissionByToken(supabaseAdmin, editToken);
    if (!existing) {
      return NextResponse.json({ error: 'Invalid edit URL' }, { status: 404 });
    }

    // Update submission (allow_edit becomes false after resubmit)
    const { error: updateError } = await supabaseAdmin
      .from('regular_shift_submissions')
      .update({
        teacher_name: teacherName,
        teacher_email: teacherEmail,
        notes,
        allow_edit: false,
        submitted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id);

    if (updateError) {
      throw updateError;
    }

    // Delete old slots
    const { error: deleteError } = await supabaseAdmin
      .from('regular_shift_submission_slots')
      .delete()
      .eq('submission_id', existing.id);

    if (deleteError) {
      throw deleteError;
    }

    // Insert new slots
    if (slots.length > 0) {
      const { error: insertError } = await supabaseAdmin
        .from('regular_shift_submission_slots')
        .insert(
          slots.map((slot) => ({
            submission_id: existing.id,
            day_of_week: slot.day_of_week,
            time_slot: slot.time_slot,
            available: slot.available,
          }))
        );

      if (insertError) {
        throw insertError;
      }
    }

    // 出勤可能期間 (teacher_availability_periods) を再同期
    try {
      const syncResult = await syncRegularShiftToAvailability(existing.id, {
        client: supabaseAdmin,
      });
      if (!syncResult.ok) {
        console.warn('[regular-shift/public/edit] availability sync skipped:', syncResult.reason);
      }
    } catch (syncError) {
      console.warn('[regular-shift/public/edit] availability sync failed:', syncError);
    }

    const updated = await getSubmissionByToken(supabaseAdmin, editToken);
    return NextResponse.json({ submission: updated });
  } catch (error) {
    console.error('[regular-shift/public] update failed:', error);
    return NextResponse.json({ error: 'Failed to update submission' }, { status: 500 });
  }
}
