import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { requireManager, getApiAuth, isSchoolInScope } from '@/lib/api-auth';
import { writeAuditLog } from '@/lib/audit-log';
import { USER_ROLE_LEVELS } from '@/types/database';
import type { UserRole } from '@/types/database';

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

export async function POST(request: NextRequest) {
  try {
    const authGuardError = await requireManager(request);
    if (authGuardError) return authGuardError;
    const { auth } = await getApiAuth(request);
    if (!auth) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    const supabaseAdmin = getSupabaseAdmin();
    const body = await request.json();
    const {
      email,
      password,
      displayName,
      lastName,
      firstName,
      role,
      schoolId,
      // 任意の拡張フィールド（CSVインポート等で使用）
      additionalSchoolIds,
      teachableSubjectIds,
      availableDaysOfWeek,
      isActive,
    }: {
      email?: string;
      password?: string;
      displayName?: string;
      lastName?: string;
      firstName?: string;
      role?: string;
      schoolId?: string;
      additionalSchoolIds?: string[];
      teachableSubjectIds?: string[];
      availableDaysOfWeek?: number[];
      isActive?: boolean;
    } = body;

    // 姓名が渡された場合は display_name を自動生成
    const effectiveDisplayName = lastName
      ? [lastName, firstName].filter(Boolean).join(' ')
      : (displayName || null);

    // バリデーション
    // 表示名は displayName 直接指定 か lastName/firstName からの生成(effectiveDisplayName)の
    // どちらでもよい。講師追加フォームは lastName/firstName を送る（displayName は送らない）ため、
    // displayName 必須にすると「全部入力しても必須エラー」になるバグがあった。
    if (!password || !effectiveDisplayName || !role || !schoolId) {
      return NextResponse.json(
        { error: '必須項目が入力されていません' },
        { status: 400 }
      );
    }

    // 自分より上の権限のユーザーは作成不可
    const myLevel = USER_ROLE_LEVELS[auth.role.toLowerCase() as UserRole] ?? 0;
    const targetLevel = USER_ROLE_LEVELS[(role as string).toLowerCase() as UserRole] ?? 0;
    if (targetLevel >= myLevel) {
      return NextResponse.json(
        { error: '自分と同等以上の権限のユーザーは作成できません' },
        { status: 403 }
      );
    }

    if (!isSchoolInScope(schoolId, auth.schoolIds)) {
      return NextResponse.json(
        { error: '指定された教室への操作権限がありません' },
        { status: 403 }
      );
    }

    // 追加教室のスコープチェック
    const extraSchoolIds = Array.isArray(additionalSchoolIds)
      ? additionalSchoolIds.filter((id) => id && id !== schoolId)
      : [];
    for (const sid of extraSchoolIds) {
      if (!isSchoolInScope(sid, auth.schoolIds)) {
        return NextResponse.json(
          { error: `教室ID ${sid} への操作権限がありません` },
          { status: 403 }
        );
      }
    }

    // メールアドレスが未指定の場合は自動生成（UUIDを使用）
    let finalEmail = email;
    if (!finalEmail || finalEmail.trim() === '') {
      const uuid = randomUUID();
      finalEmail = `user-${uuid}@system.local`;
    }

    // 既存のユーザーをチェック（メールアドレスが指定されている場合のみ）
    if (finalEmail && finalEmail !== '') {
      const { data: existingProfile, error: checkError } = await supabaseAdmin
        .from('user_profiles')
        .select('id, email')
        .eq('email', finalEmail)
        .maybeSingle();

      if (checkError && checkError.code !== 'PGRST116') {
        console.error('Email check error:', checkError);
        return NextResponse.json(
          { error: 'メールアドレスの重複チェックに失敗しました' },
          { status: 500 }
        );
      }

      if (existingProfile) {
        return NextResponse.json(
          { error: 'このメールアドレス（ID）は既に登録されています' },
          { status: 400 }
        );
      }
    }

    // 1. Supabase Authでユーザー作成
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: finalEmail,
      password,
      email_confirm: true,
      user_metadata: {
        display_name: displayName,
      },
    });

    if (authError) {
      const msg = authError.message ?? '';
      let userMessage = 'ユーザーの作成に失敗しました';
      if (msg.includes('already registered')) {
        userMessage = 'このメールアドレス（ID）は既に登録されています';
      } else if (msg.includes('email') && msg.includes('invalid')) {
        userMessage = 'メールアドレスの形式が正しくありません';
      } else if (msg.includes('password') || msg.includes('Password')) {
        userMessage = `パスワードが要件を満たしていません（6文字以上必要です）`;
      } else {
        userMessage = `ユーザーの作成に失敗しました: ${msg}`;
      }
      console.error('Auth user creation error:', authError);
      return NextResponse.json({ error: userMessage }, { status: 400 });
    }

    // 2. user_profilesに登録（既に存在する場合はスキップ）
    const { data: existingProfileAfterAuth } = await supabaseAdmin
      .from('user_profiles')
      .select('id')
      .eq('id', authData.user.id)
      .maybeSingle();

    const profileExtras: Record<string, unknown> = {};
    if (Array.isArray(teachableSubjectIds) && teachableSubjectIds.length > 0) {
      profileExtras.teachable_subject_ids = teachableSubjectIds;
    }
    if (Array.isArray(availableDaysOfWeek) && availableDaysOfWeek.length > 0) {
      profileExtras.available_days_of_week = availableDaysOfWeek;
    }
    const effectiveIsActive = typeof isActive === 'boolean' ? isActive : true;

    if (!existingProfileAfterAuth) {
      const { error: profileError } = await supabaseAdmin
        .from('user_profiles')
        .insert({
          id: authData.user.id,
          email: finalEmail,
          display_name: effectiveDisplayName,
          last_name: lastName || null,
          first_name: firstName || null,
          role,
          is_active: effectiveIsActive,
          ...profileExtras,
        });

      if (profileError) {
        // ロールバック
        await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
        return NextResponse.json(
          { error: 'ユーザープロファイルの作成に失敗しました' },
          { status: 400 }
        );
      }
    } else {
      // 既にuser_profilesに存在する場合は更新
      const { error: updateError } = await supabaseAdmin
        .from('user_profiles')
        .update({
          email: finalEmail,
          display_name: effectiveDisplayName,
          last_name: lastName || null,
          first_name: firstName || null,
          role,
          is_active: effectiveIsActive,
          ...profileExtras,
        })
        .eq('id', authData.user.id);

      if (updateError) {
        return NextResponse.json(
          { error: 'ユーザープロファイルの更新に失敗しました' },
          { status: 400 }
        );
      }
    }

    // 3. user_schoolsに登録（既に存在する場合はスキップ）
    const { data: existingSchool } = await supabaseAdmin
      .from('user_schools')
      .select('id')
      .eq('user_id', authData.user.id)
      .eq('school_id', schoolId)
      .single();

    if (!existingSchool) {
      const { error: schoolError } = await supabaseAdmin
        .from('user_schools')
        .insert({
          user_id: authData.user.id,
          school_id: schoolId,
        });

      if (schoolError) {
        // ロールバック（user_profilesが新規作成された場合のみ）
        if (!existingProfileAfterAuth) {
          await supabaseAdmin.from('user_profiles').delete().eq('id', authData.user.id);
          await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
        }
        return NextResponse.json(
          { error: '教室の紐付けに失敗しました' },
          { status: 400 }
        );
      }
    }

    // 追加教室の紐付け（重複はスキップ）
    if (extraSchoolIds.length > 0) {
      const { data: existingRows } = await supabaseAdmin
        .from('user_schools')
        .select('school_id')
        .eq('user_id', authData.user.id);
      const existingSet = new Set((existingRows || []).map((r) => r.school_id));
      const toInsert = extraSchoolIds
        .filter((sid) => !existingSet.has(sid))
        .map((sid) => ({ user_id: authData.user.id, school_id: sid }));
      if (toInsert.length > 0) {
        await supabaseAdmin.from('user_schools').insert(toInsert);
      }
    }

    await writeAuditLog({
      actorId: auth.userId,
      actorRole: auth.role,
      action: 'user.create',
      targetType: 'user_profile',
      targetId: authData.user.id,
      detail: { email: finalEmail, role, schoolId },
      request,
    });

    // 一覧の楽観的更新用に、作成済みユーザー（user_schools 込み）を返す
    const { data: profile } = await supabaseAdmin
      .from('user_profiles')
      .select('*')
      .eq('id', authData.user.id)
      .single();
    const { data: userSchoolsWithSchool } = await supabaseAdmin
      .from('user_schools')
      .select('id, user_id, school_id, school:schools(id, name, code)')
      .eq('user_id', authData.user.id);

    const createdUser = profile
      ? {
          ...profile,
          user_schools: userSchoolsWithSchool ?? [],
        }
      : {
          id: authData.user.id,
          email: authData.user.email ?? finalEmail,
          display_name: displayName,
          role,
          is_active: true,
          user_schools: userSchoolsWithSchool ?? [],
        };

    return NextResponse.json({
      success: true,
      user: createdUser,
    });
  } catch (error) {
    console.error('Failed to create user:', error);
    return NextResponse.json(
      { error: 'ユーザーの作成に失敗しました' },
      { status: 500 }
    );
  }
}
