import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { requireAdmin, getApiAuth, isSchoolInScope } from '@/lib/api-auth';
import { writeAuditLog } from '@/lib/audit-log';

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
    const authGuardError = await requireAdmin(request);
    if (authGuardError) return authGuardError;
    const { auth } = await getApiAuth(request);
    if (!auth) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    const supabaseAdmin = getSupabaseAdmin();
    const body = await request.json();
    const { email, password, displayName, role, schoolId } = body;

    // バリデーション
    if (!password || !displayName || !role || !schoolId) {
      return NextResponse.json(
        { error: '必須項目が入力されていません' },
        { status: 400 }
      );
    }

    if (!isSchoolInScope(schoolId, auth.schoolIds)) {
      return NextResponse.json(
        { error: '指定された教室への操作権限がありません' },
        { status: 403 }
      );
    }

    // メールアドレスが未指定の場合は自動生成（UUIDを使用）
    let finalEmail = email;
    if (!finalEmail || finalEmail.trim() === '') {
      // UUIDを生成してメールアドレス形式にする
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
      let userMessage = 'ユーザーの作成に失敗しました';
      if (authError.message?.includes('already registered')) {
        userMessage = 'このメールアドレスは既に登録されています';
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

    if (!existingProfileAfterAuth) {
      const { error: profileError } = await supabaseAdmin
        .from('user_profiles')
        .insert({
          id: authData.user.id,
          email: finalEmail,
          display_name: displayName,
          role,
          is_active: true,
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
          display_name: displayName,
          role,
          is_active: true,
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
