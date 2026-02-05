import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

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

/**
 * 招待承諾後にプロファイル・教室紐付けをサーバー側で作成する。
 * クライアントの createUserProfile は RLS で弾かれる可能性があるため、
 * サービスロールで確実に user_profiles と user_schools を作成する。
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { token, displayName, userId } = body as { token?: string; displayName?: string; userId?: string };

    if (!token || typeof token !== 'string' || !userId || typeof userId !== 'string') {
      return NextResponse.json(
        { error: 'token と userId は必須です' },
        { status: 400 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();

    // 招待を取得・検証
    const { data: invitation, error: invError } = await supabaseAdmin
      .from('user_invitations')
      .select('*')
      .eq('token', token)
      .is('accepted_at', null)
      .maybeSingle();

    if (invError || !invitation) {
      return NextResponse.json(
        { error: '招待が見つからないか、既に使用されています' },
        { status: 400 }
      );
    }

    if (new Date(invitation.expires_at) < new Date()) {
      return NextResponse.json(
        { error: '招待の有効期限が切れています' },
        { status: 400 }
      );
    }

    // 認証ユーザーを取得し、招待メールと一致するか確認
    const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (authError || !authUser?.user) {
      return NextResponse.json(
        { error: 'ユーザーを確認できませんでした' },
        { status: 400 }
      );
    }

    const authEmail = (authUser.user.email ?? '').toLowerCase().trim();
    const invEmail = (invitation.email ?? '').toLowerCase().trim();
    if (authEmail !== invEmail) {
      return NextResponse.json(
        { error: '招待メールとログイン中のアカウントが一致しません' },
        { status: 403 }
      );
    }

    // user_profiles が既に存在するか確認
    const { data: existingProfile } = await supabaseAdmin
      .from('user_profiles')
      .select('id')
      .eq('id', userId)
      .maybeSingle();

    if (!existingProfile) {
      const { error: profileError } = await supabaseAdmin
        .from('user_profiles')
        .insert({
          id: userId,
          email: invitation.email,
          display_name: displayName || null,
          role: invitation.role,
          is_active: true,
          invited_by: invitation.invited_by || null,
          invited_at: new Date().toISOString(),
        });

      if (profileError) {
        console.error('Invite complete: user_profiles insert error', profileError);
        return NextResponse.json(
          { error: 'プロファイルの作成に失敗しました: ' + profileError.message },
          { status: 500 }
        );
      }
    } else {
      // 既存プロファイルを招待内容で更新（二重承諾など）
      await supabaseAdmin
        .from('user_profiles')
        .update({
          display_name: displayName ?? null,
          role: invitation.role,
          invited_by: invitation.invited_by || null,
          invited_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId);
    }

    // user_schools に招待の教室を紐付け（重複は無視）
    const schoolIds = Array.isArray(invitation.school_ids) ? invitation.school_ids : [];
    for (const schoolId of schoolIds) {
      const { data: existing } = await supabaseAdmin
        .from('user_schools')
        .select('id')
        .eq('user_id', userId)
        .eq('school_id', schoolId)
        .maybeSingle();

      if (!existing) {
        await supabaseAdmin
          .from('user_schools')
          .insert({ user_id: userId, school_id: schoolId });
      }
    }

    // 招待を承諾済みにする
    await supabaseAdmin
      .from('user_invitations')
      .update({ accepted_at: new Date().toISOString() })
      .eq('token', token);

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('Invite complete error:', e);
    return NextResponse.json(
      { error: '招待の完了処理に失敗しました' },
      { status: 500 }
    );
  }
}
