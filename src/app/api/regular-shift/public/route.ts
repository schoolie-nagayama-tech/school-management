import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { normalizePersonName } from '@/lib/utils/personName';
import { syncRegularShiftToAvailability } from '@/lib/api/teacher-availability';

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
  const { data, error } = await supabaseAdmin.functions.invoke('send-form-notification', {
    body: {
      notificationType: 'regular-shift',
      type,
      submissionId,
    },
  });

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
      return NextResponse.json({ error: 'Published shift setting not found' }, { status: 404 });
    }

    // Check deadline
    if (setting.deadline) {
      const deadline = new Date(`${setting.deadline}T23:59:59`);
      if (Number.isFinite(deadline.getTime()) && new Date() > deadline) {
        return NextResponse.json({ error: 'Submission deadline has passed' }, { status: 400 });
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

    // 同一設定・同一メール（または同一アカウント）の既存提出を探す。
    // 修正許可（差し戻し）後に講師が修正用URLではなく提出フォームから
    // 再送信した場合でも、新規行を作らず既存提出を上書きして
    // 「同じ講師が2行に分裂する」のを防ぐ。
    // ilike のワイルドカード（% _）をエスケープして完全一致（大文字小文字無視）にする
    const emailPattern = teacherEmail.replace(/[\\%_]/g, (m) => `\\${m}`);
    const { data: existingByEmail, error: existingError } = await supabaseAdmin
      .from('regular_shift_submissions')
      .select('id, user_id')
      .eq('setting_id', settingId)
      .ilike('teacher_email', emailPattern)
      .order('submitted_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingError) {
      throw existingError;
    }

    let existing = existingByEmail ?? null;
    if (!existing && linkedUserId) {
      // メール変更などで一致しない場合でも、紐づけ済みアカウントが同じなら同一講師とみなす
      const { data: existingByUser, error: existingUserError } = await supabaseAdmin
        .from('regular_shift_submissions')
        .select('id, user_id')
        .eq('setting_id', settingId)
        .eq('user_id', linkedUserId)
        .maybeSingle();
      if (existingUserError) {
        throw existingUserError;
      }
      existing = existingByUser ?? null;
    }

    let submission;
    if (existing) {
      // 再提出: 既存行を上書き
      const { data: updated, error: updateError } = await supabaseAdmin
        .from('regular_shift_submissions')
        .update({
          teacher_name: teacherName,
          teacher_email: teacherEmail,
          notes,
          user_id: existing.user_id ?? linkedUserId, // 手動紐づけ済みのアカウントは維持
          allow_edit: false, // 再提出により修正依頼は完了扱い
          seat_chart_entered: false, // 内容が変わったため座席表は再入力が必要
          submitted_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select('*')
        .single();

      if (updateError) {
        throw updateError;
      }
      submission = updated;

      // スロットは全入れ替え（古い内容を残さない）
      const { error: deleteError } = await supabaseAdmin
        .from('regular_shift_submission_slots')
        .delete()
        .eq('submission_id', existing.id);

      if (deleteError) {
        throw deleteError;
      }
    } else {
      // Insert submission
      const { data: inserted, error: submissionError } = await supabaseAdmin
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
      submission = inserted;
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

    // 出勤可能期間 (teacher_availability_periods) へ自動反映
    // 失敗してもシフト提出自体は成功扱い（ログのみ残す）
    try {
      const syncResult = await syncRegularShiftToAvailability(submission.id, {
        client: supabaseAdmin,
      });
      if (!syncResult.ok) {
        console.warn('[regular-shift/public] availability sync skipped:', syncResult.reason);
      }
    } catch (syncError) {
      console.warn('[regular-shift/public] availability sync failed:', syncError);
    }

    return NextResponse.json({ submission });
  } catch (error) {
    console.error('[regular-shift/public] create failed:', error);
    return NextResponse.json({ error: 'Failed to submit' }, { status: 500 });
  }
}

/** GET: Fetch a published regular shift setting with its slot settings */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const settingId = searchParams.get('settingId')?.trim();

    if (!settingId) {
      return NextResponse.json({ error: 'settingId is required' }, { status: 400 });
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
      return NextResponse.json({ error: 'Published shift setting not found' }, { status: 404 });
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
    return NextResponse.json({ error: 'Failed to get setting' }, { status: 500 });
  }
}
