import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set');
  }

  if (!supabaseServiceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  }

  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

/** PostgreSQL 配列を JS 配列に正規化（DB が文字列 "{a,b}" で返す場合に対応） */
function toStrArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (typeof v === 'string') {
    const trimmed = v.replace(/^\{|\}$/g, '').trim();
    if (!trimmed) return [];
    return trimmed.split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
  }
  return [];
}

function toNumArray(v: unknown): number[] {
  if (Array.isArray(v)) return v.map((x) => Number(x)).filter((n) => !Number.isNaN(n));
  if (typeof v === 'string') {
    const trimmed = v.replace(/^\{|\}$/g, '').trim();
    if (!trimmed) return [];
    return trimmed.split(',').map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n));
  }
  return [];
}

/** JSONB の曜日別コマを Record<string, number[]> に正規化 */
function toSlotNumbersByDay(v: unknown): Record<string, number[]> {
  if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
    const out: Record<string, number[]> = {};
    for (const key of Object.keys(v as object)) {
      const arr = toNumArray((v as Record<string, unknown>)[key]);
      if (arr.length > 0) out[key] = arr;
    }
    return out;
  }
  return {};
}

/** 講師1件取得（編集画面用。teachable_subject_ids, available_days_of_week を必ず配列で返す） */
export async function GET(
  _request: NextRequest,
  { params }: { params: { userId: string } }
) {
  try {
    const userId = params.userId;
    if (!userId) {
      return NextResponse.json({ error: 'userId が必要です' }, { status: 400 });
    }
    const supabaseAdmin = getSupabaseAdmin();
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (profileError || !profile) {
      return NextResponse.json({ error: 'ユーザーが見つかりません' }, { status: 404 });
    }

    const { data: userSchools } = await supabaseAdmin
      .from('user_schools')
      .select('*, school:schools(*)')
      .eq('user_id', userId);

    const teachableSubjectIds = toStrArray(profile.teachable_subject_ids);
    const availableDaysOfWeek = toNumArray(profile.available_days_of_week);
    const availableSlotNumbersByDay = toSlotNumbersByDay(profile.available_slot_numbers_by_day);

    return NextResponse.json({
      ...profile,
      teachable_subject_ids: teachableSubjectIds,
      available_days_of_week: availableDaysOfWeek,
      available_slot_numbers_by_day: availableSlotNumbersByDay,
      user_schools: userSchools || [],
    });
  } catch (error) {
    console.error('Failed to fetch user:', error);
    return NextResponse.json(
      { error: 'ユーザーの取得に失敗しました' },
      { status: 500 }
    );
  }
}

/** 講師プロファイル更新（display_name, teachable_subject_ids, available_days_of_week）。RPC で確実に保存 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { userId: string } }
) {
  try {
    const userId = params.userId;
    if (!userId) {
      return NextResponse.json({ error: 'userId が必要です' }, { status: 400 });
    }
    const body = await request.json();
    const supabaseAdmin = getSupabaseAdmin();

    // ユーザー管理からの編集（school_ids が渡された場合は profile + user_schools をサービスロールで更新）
    const rawSchoolIds = body.school_ids;
    const wantIds: string[] = Array.isArray(rawSchoolIds)
      ? rawSchoolIds.map((id: unknown) => String(id).trim()).filter(Boolean)
      : typeof rawSchoolIds === 'string'
        ? rawSchoolIds.split(',').map((s: string) => s.trim()).filter(Boolean)
        : [];
    const isUserManagementEdit = 'school_ids' in body && (Array.isArray(rawSchoolIds) || typeof rawSchoolIds === 'string');

    if (isUserManagementEdit) {
      const { display_name, role, default_school_id } = body;
      const profileUpdates: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      if (display_name !== undefined) profileUpdates.display_name = display_name;
      if (role !== undefined) profileUpdates.role = role;
      if (default_school_id !== undefined) profileUpdates.default_school_id = default_school_id || null;

      const { error: profileError } = await supabaseAdmin
        .from('user_profiles')
        .update(profileUpdates)
        .eq('id', userId);

      if (profileError) throw profileError;

      const { data: currentRows } = await supabaseAdmin
        .from('user_schools')
        .select('school_id')
        .eq('user_id', userId);
      const currentIds = (currentRows || []).map((r: { school_id: string }) => String(r.school_id).trim());

      const toAdd = wantIds.filter((sid) => !currentIds.includes(sid));
      const toRemove = currentIds.filter((sid) => !wantIds.includes(sid));

      console.log('[PATCH user]', { userId, bodySchoolIds: body.school_ids, wantIds, currentIds, toAdd, toRemove });

      for (const school_id of toAdd) {
        const { error: insertError } = await supabaseAdmin
          .from('user_schools')
          .insert({ user_id: userId, school_id });

        if (insertError) {
          console.error('user_schools insert error:', insertError);
          throw insertError;
        }
      }

      for (const sid of toRemove) {
        const { error: deleteError } = await supabaseAdmin
          .from('user_schools')
          .delete()
          .eq('user_id', userId)
          .eq('school_id', sid);
        if (deleteError) {
          console.error('user_schools delete error:', deleteError);
          throw deleteError;
        }
      }

      const { data: afterRows } = await supabaseAdmin
        .from('user_schools')
        .select('school_id')
        .eq('user_id', userId);
      console.log('[PATCH user] after sync:', { count: afterRows?.length ?? 0, school_ids: (afterRows || []).map((r: { school_id: string }) => r.school_id) });

      // 一覧の即時反映用に、更新後の user_schools（教室名付き）を返す
      const { data: userSchoolsWithSchool } = await supabaseAdmin
        .from('user_schools')
        .select('id, user_id, school_id, school:schools(id, name, code)')
        .eq('user_id', userId);

      return NextResponse.json({
        success: true,
        user_schools: userSchoolsWithSchool ?? [],
      });
    }

    const slotNumbersByDay =
      body.available_slot_numbers_by_day != null &&
      typeof body.available_slot_numbers_by_day === 'object' &&
      !Array.isArray(body.available_slot_numbers_by_day)
        ? body.available_slot_numbers_by_day
        : null;

    // RPC で更新（列が存在しない場合はエラーになる）
    const { data, error } = await supabaseAdmin.rpc('update_teacher_profile', {
      p_user_id: userId,
      p_display_name: body.display_name ?? null,
      p_teachable_subject_ids: Array.isArray(body.teachable_subject_ids) ? body.teachable_subject_ids : null,
      p_available_days_of_week: Array.isArray(body.available_days_of_week) ? body.available_days_of_week : null,
      p_available_slot_numbers_by_day: slotNumbersByDay,
    });

    if (error) {
      // 関数が存在しない or 列がない場合はマイグレーション未実行の可能性
      const msg = error.message || '';
      if (msg.includes('function') && msg.includes('does not exist')) {
        return NextResponse.json(
          { error: '講師プロファイル更新の準備ができていません。Supabase でマイグレーション（xxx_teacher_teachable_subjects_and_available_days.sql、xxx_teacher_available_slots_by_day.sql、xxx_teacher_profile_update_rpc_slots.sql）を実行してください。' },
          { status: 503 }
        );
      }
      throw error;
    }
    return NextResponse.json(data);
  } catch (error) {
    console.error('Failed to update user profile:', error);
    return NextResponse.json(
      { error: 'プロファイルの更新に失敗しました' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { userId: string } }
) {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const userId = params.userId;

    // user_schoolsを削除
    await supabaseAdmin
      .from('user_schools')
      .delete()
      .eq('user_id', userId);

    // user_profilesを削除
    await supabaseAdmin
      .from('user_profiles')
      .delete()
      .eq('id', userId);

    // Authユーザーを削除
    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete user:', error);
    return NextResponse.json(
      { error: 'ユーザーの削除に失敗しました' },
      { status: 500 }
    );
  }
}
