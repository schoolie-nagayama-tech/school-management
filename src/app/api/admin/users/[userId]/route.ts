import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin, requireManager, getApiAuth, isUserInScope } from '@/lib/api-auth';
import { writeAuditLog } from '@/lib/audit-log';
import { USER_ROLE_LEVELS } from '@/types/database';

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
  request: NextRequest,
  { params }: { params: { userId: string } }
) {
  try {
    const authError = await requireManager(request);
    if (authError) return authError;
    const userId = params.userId;
    if (!userId) {
      return NextResponse.json({ error: 'userId が必要です' }, { status: 400 });
    }
    const supabaseAdmin = getSupabaseAdmin();
    const { auth } = await getApiAuth(request);
    if (!auth) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    const inScope = await isUserInScope(userId, auth.schoolIds, supabaseAdmin);
    if (!inScope) {
      console.error(JSON.stringify({
        type: 'SCOPE_VIOLATION',
        actorId: auth.userId,
        targetUserId: userId,
        path: request.nextUrl.pathname,
        timestamp: new Date().toISOString(),
      }));
      return NextResponse.json({ error: 'ユーザーが見つかりません' }, { status: 404 });
    }
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
    const authError = await requireManager(request);
    if (authError) return authError;
    const userId = params.userId;
    if (!userId) {
      return NextResponse.json({ error: 'userId が必要です' }, { status: 400 });
    }
    const supabaseAdmin = getSupabaseAdmin();
    const { auth } = await getApiAuth(request);
    if (!auth) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

    const isEditingSelf = userId === auth.userId;

    // 自分以外を編集する場合は、権限チェックとスコープチェック
    if (!isEditingSelf) {
      const inScope = await isUserInScope(userId, auth.schoolIds, supabaseAdmin);
      if (!inScope) {
        console.error(JSON.stringify({
          type: 'SCOPE_VIOLATION',
          actorId: auth.userId,
          targetUserId: userId,
          path: request.nextUrl.pathname,
          timestamp: new Date().toISOString(),
        }));
        return NextResponse.json({ error: 'ユーザーが見つかりません' }, { status: 404 });
      }
      // 自分より権限が下のユーザーのみ編集可能
      const { data: targetProfile } = await supabaseAdmin
        .from('user_profiles')
        .select('role')
        .eq('id', userId)
        .maybeSingle();
      const myLevel = USER_ROLE_LEVELS[auth.role as keyof typeof USER_ROLE_LEVELS] ?? 0;
      const targetLevel = USER_ROLE_LEVELS[(targetProfile?.role as keyof typeof USER_ROLE_LEVELS) ?? ''] ?? 0;
      if (targetLevel >= myLevel) {
        return NextResponse.json(
          { error: '自分より権限が高い、または同レベルのユーザーは編集できません' },
          { status: 403 }
        );
      }
    }

    const body = await request.json();

    // ユーザー管理からの編集（school_ids が渡された場合は profile + user_schools をサービスロールで更新）
    const rawSchoolIds = body.school_ids;
    const wantIds: string[] = Array.isArray(rawSchoolIds)
      ? rawSchoolIds.map((id: unknown) => String(id).trim()).filter(Boolean)
      : typeof rawSchoolIds === 'string'
        ? rawSchoolIds.split(',').map((s: string) => s.trim()).filter(Boolean)
        : [];
    const isUserManagementEdit = 'school_ids' in body && (Array.isArray(rawSchoolIds) || typeof rawSchoolIds === 'string');

    if (isUserManagementEdit) {
      const { display_name, last_name, first_name, role, default_school_id } = body;
      const profileUpdates: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      // 姓名が渡された場合は display_name も連動更新
      if (last_name !== undefined) {
        profileUpdates.last_name = last_name || null;
        profileUpdates.first_name = first_name || null;
        profileUpdates.display_name = [last_name, first_name].filter(Boolean).join(' ') || null;
      } else if (display_name !== undefined) {
        profileUpdates.display_name = display_name;
      }
      // 自分自身の編集では権限・教室は変更不可。デフォルト教室のみ変更可。
      if (!isEditingSelf) {
        if (role !== undefined) profileUpdates.role = role;
        if (default_school_id !== undefined) profileUpdates.default_school_id = default_school_id || null;
      } else if (default_school_id !== undefined) {
        // 自分のデフォルト教室変更時は、自分が所属する教室のいずれかであることを確認
        const { data: mySchools } = await supabaseAdmin
          .from('user_schools')
          .select('school_id')
          .eq('user_id', userId);
        const mySchoolIds = (mySchools || []).map((r: { school_id: string }) => r.school_id);
        if (mySchoolIds.includes(default_school_id)) {
          profileUpdates.default_school_id = default_school_id;
        }
      }

      const { error: profileError } = await supabaseAdmin
        .from('user_profiles')
        .update(profileUpdates)
        .eq('id', userId);

      if (profileError) throw profileError;

      // 自分自身の編集では user_schools は変更しない
      if (!isEditingSelf) {
        // 原子的に更新: 既存をすべて削除してから一括挿入
        const { error: deleteAllError } = await supabaseAdmin
          .from('user_schools')
          .delete()
          .eq('user_id', userId);

        if (deleteAllError) {
          console.error('user_schools delete all error:', deleteAllError);
          throw deleteAllError;
        }

        if (wantIds.length > 0) {
          const rows = wantIds.map((school_id) => ({ user_id: userId, school_id }));
          const { error: insertError } = await supabaseAdmin
            .from('user_schools')
            .insert(rows);

          if (insertError) {
            console.error('user_schools bulk insert error:', insertError);
            throw insertError;
          }
        }

        console.log('[PATCH user]', { userId, wantIds });
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

      await writeAuditLog({
        actorId: auth.userId,
        actorRole: auth.role,
        action: 'user.update',
        targetType: 'user_profile',
        targetId: userId,
        detail: { changes: body },
        request,
      });

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
        : {};

    const profileUpdates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (body.last_name !== undefined) {
      profileUpdates.last_name = body.last_name || null;
      profileUpdates.first_name = body.first_name || null;
      profileUpdates.display_name = [body.last_name, body.first_name].filter(Boolean).join(' ') || null;
    } else if (body.display_name !== undefined) {
      profileUpdates.display_name = body.display_name ?? null;
    }
    if (Array.isArray(body.teachable_subject_ids)) {
      profileUpdates.teachable_subject_ids = body.teachable_subject_ids;
    }
    if (Array.isArray(body.available_days_of_week)) {
      profileUpdates.available_days_of_week = body.available_days_of_week;
    }
    profileUpdates.available_slot_numbers_by_day = slotNumbersByDay;

    const { data, error } = await supabaseAdmin
      .from('user_profiles')
      .update(profileUpdates)
      .eq('id', userId)
      .select()
      .single();

    if (error) {
      console.error('user_profiles update error:', error);
      return NextResponse.json(
        { error: 'プロファイルの更新に失敗しました' },
        { status: 500 }
      );
    }

    await writeAuditLog({
      actorId: auth.userId,
      actorRole: auth.role,
      action: 'user.update',
      targetType: 'user_profile',
      targetId: userId,
      detail: { changes: body },
      request,
    });

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
    const authError = await requireAdmin(request);
    if (authError) return authError;
    const userId = params.userId;
    if (!userId) {
      return NextResponse.json({ error: 'userId が必要です' }, { status: 400 });
    }
    const supabaseAdmin = getSupabaseAdmin();
    const { auth } = await getApiAuth(request);
    if (!auth) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    const inScope = await isUserInScope(userId, auth.schoolIds, supabaseAdmin);
    if (!inScope) {
      console.error(JSON.stringify({
        type: 'SCOPE_VIOLATION',
        actorId: auth.userId,
        targetUserId: userId,
        path: request.nextUrl.pathname,
        timestamp: new Date().toISOString(),
      }));
      return NextResponse.json({ error: 'ユーザーが見つかりません' }, { status: 404 });
    }

    // 外部キー参照を解除（ON DELETE RESTRICT のため事前に削除・更新が必要）
    const steps = [
      { name: 'schedule_entries.attendance_recorded_by', fn: () => supabaseAdmin.from('schedule_entries').update({ attendance_recorded_by: null }).eq('attendance_recorded_by', userId) },
      { name: 'schedule_entries.teacher_id', fn: () => supabaseAdmin.from('schedule_entries').delete().eq('teacher_id', userId) },
      { name: 'schedule_regular_patterns', fn: () => supabaseAdmin.from('schedule_regular_patterns').delete().eq('teacher_id', userId) },
      { name: 'schedule_generation_logs', fn: () => supabaseAdmin.from('schedule_generation_logs').update({ created_by: null }).eq('created_by', userId) },
      { name: 'bulletin_posts.created_by', fn: () => supabaseAdmin.from('bulletin_posts').update({ created_by: null }).eq('created_by', userId) },
      { name: 'bulletin_posts.updated_by', fn: () => supabaseAdmin.from('bulletin_posts').update({ updated_by: null }).eq('updated_by', userId) },
      { name: 'bulletin_reads', fn: () => supabaseAdmin.from('bulletin_reads').delete().eq('user_id', userId) },
      { name: 'alert_dismissals', fn: () => supabaseAdmin.from('alert_dismissals').update({ dismissed_by: null }).eq('dismissed_by', userId) },
    ];

    for (const step of steps) {
      const { error } = await step.fn();
      if (error) {
        console.error(`[DELETE user] Failed at step "${step.name}":`, error);
        throw new Error(`${step.name}: ${error.message}`);
      }
    }

    // attendance_sheets（出勤簿）: teacher_id / approved_by が user_profiles を参照（テーブル未実装の場合はスキップ）
    const isTableMissing = (e: { code?: string; message?: string } | null) =>
      e && (e.code === '42P01' || /relation .* does not exist/i.test(e?.message || ''));
    const { data: teacherSheetIds, error: sheetsSelErr } = await supabaseAdmin
      .from('attendance_sheets')
      .select('id')
      .eq('teacher_id', userId);
    if (sheetsSelErr && !isTableMissing(sheetsSelErr)) {
      console.error('[DELETE user] attendance_sheets select:', sheetsSelErr);
      throw new Error(`attendance_sheets: ${sheetsSelErr.message}`);
    }
    if (sheetsSelErr) {
      // テーブルなし → 出勤簿の処理をスキップ
    } else {
      const sheetIds = (teacherSheetIds || []).map((r: { id: string }) => r.id);
      if (sheetIds.length > 0) {
        const { error: delRecErr } = await supabaseAdmin
          .from('attendance_records')
          .delete()
          .in('sheet_id', sheetIds);
        if (delRecErr && !isTableMissing(delRecErr)) {
          console.error('[DELETE user] attendance_records:', delRecErr);
          throw new Error(`attendance_records: ${delRecErr.message}`);
        }
        const { error: delNotesErr } = await supabaseAdmin
          .from('attendance_notes')
          .delete()
          .in('sheet_id', sheetIds);
        if (delNotesErr && !isTableMissing(delNotesErr)) {
          console.error('[DELETE user] attendance_notes:', delNotesErr);
          throw new Error(`attendance_notes: ${delNotesErr.message}`);
        }
      }
      const { error: updApprovedErr } = await supabaseAdmin
        .from('attendance_sheets')
        .update({ approved_by: null })
        .eq('approved_by', userId);
      if (updApprovedErr && !isTableMissing(updApprovedErr)) {
        console.error('[DELETE user] attendance_sheets.approved_by:', updApprovedErr);
        throw new Error(`attendance_sheets.approved_by: ${updApprovedErr.message}`);
      }
      const { error: delSheetsErr } = await supabaseAdmin
        .from('attendance_sheets')
        .delete()
        .eq('teacher_id', userId);
      if (delSheetsErr && !isTableMissing(delSheetsErr)) {
        console.error('[DELETE user] attendance_sheets:', delSheetsErr);
        throw new Error(`attendance_sheets: ${delSheetsErr.message}`);
      }
    }

    // user_schoolsを削除
    const { error: usErr } = await supabaseAdmin.from('user_schools').delete().eq('user_id', userId);
    if (usErr) {
      console.error('[DELETE user] user_schools:', usErr);
      throw new Error(`user_schools: ${usErr.message}`);
    }

    // user_profilesを削除
    const { data: deletedProfiles, error: upErr } = await supabaseAdmin
      .from('user_profiles')
      .delete()
      .eq('id', userId)
      .select('id');
    if (upErr) {
      console.error('[DELETE user] user_profiles:', upErr);
      throw new Error(`user_profiles: ${upErr.message}`);
    }
    if (!deletedProfiles?.length) {
      console.error('[DELETE user] user_profiles: no row deleted for userId=', userId);
      return NextResponse.json(
        { error: 'ユーザーが見つかりません' },
        { status: 404 }
      );
    }

    // Authユーザーを削除（既に存在しない場合は成功扱い）
    const { error: authErr } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (authErr) {
      const msg = authErr?.message?.toLowerCase() ?? '';
      if (msg.includes('user not found') || msg.includes('ユーザーが見つかりません')) {
        // Auth に既に存在しない = プロファイルは削除済みなので成功
      } else {
        console.error('[DELETE user] auth.admin.deleteUser:', authErr);
        throw authErr;
      }
    }

    await writeAuditLog({
      actorId: auth.userId,
      actorRole: auth.role,
      action: 'user.delete',
      targetType: 'user_profile',
      targetId: userId,
      request,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete user:', error);
    return NextResponse.json(
      { error: 'ユーザーの削除に失敗しました' },
      { status: 500 }
    );
  }
}
