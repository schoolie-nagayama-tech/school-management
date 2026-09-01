import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/api-auth';
import { captureApiError } from '@/lib/api-error';
import { writeAuditLog } from '@/lib/audit-log';

export const dynamic = 'force-dynamic';

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

/**
 * 管理者（admin）専用: 他ユーザーにアカウントスイッチする
 *
 * Body: { userId: string, currentRefreshToken: string }
 * Response: { actionLink: string }
 *
 * 流れ:
 * 1. requireAdmin で呼び出し元が admin であることを検証
 * 2. 対象ユーザーの email を取得
 * 3. Supabase admin.generateLink でマジックリンクを発行
 * 4. 呼び出し元 admin の refresh_token を httpOnly cookie に保存（戻れるように）
 * 5. actionLink を返却 → クライアントが遷移 → 対象ユーザーとして認証される
 */
export async function POST(request: NextRequest) {
  try {
    // admin ロールのみ許可（owner も除外、システム管理者のみ）
    const authError = await requireAdmin(request);
    if (authError) return authError;

    // ただし requireAdmin は admin/owner を通すため、さらに admin に絞る
    const { userId, currentRefreshToken } = await request.json();
    if (!userId || !currentRefreshToken) {
      return NextResponse.json(
        { error: 'userId と currentRefreshToken が必要です' },
        { status: 400 }
      );
    }

    const db = getSupabaseAdmin();

    // 呼び出し元を厳密に admin チェック
    const callerAuthHeader = request.headers.get('Authorization');
    const callerToken = callerAuthHeader?.startsWith('Bearer ') ? callerAuthHeader.slice(7) : null;
    if (!callerToken) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }
    const {
      data: { user: callerUser },
    } = await db.auth.getUser(callerToken);
    if (!callerUser) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }
    const { data: callerProfile } = await db
      .from('user_profiles')
      .select('role')
      .eq('id', callerUser.id)
      .maybeSingle();
    if (callerProfile?.role !== 'admin') {
      return NextResponse.json({ error: 'システム管理者のみ実行できます' }, { status: 403 });
    }

    // 対象ユーザーの email を取得
    const { data: targetProfile } = await db
      .from('user_profiles')
      .select('id, email')
      .eq('id', userId)
      .maybeSingle();
    if (!targetProfile?.email) {
      return NextResponse.json({ error: '対象ユーザーが見つかりません' }, { status: 404 });
    }

    // マジックリンクを発行（hashed_token を verifyOtp でクライアント側に渡して即座にセッション確立する）
    const { data: linkData, error: linkError } = await db.auth.admin.generateLink({
      type: 'magiclink',
      email: targetProfile.email,
    });
    if (linkError || !linkData?.properties?.hashed_token) {
      console.error('generateLink error:', linkError);
      return NextResponse.json({ error: 'マジックリンクの発行に失敗しました' }, { status: 500 });
    }

    const actionLink = linkData.properties.action_link;
    const hashedToken = linkData.properties.hashed_token;
    const targetEmail = targetProfile.email;

    // 監査ログ。
    // ★ここは DB に残すこと。なりすましログインは「他人としてアプリを操作できる」
    //   最も強い管理操作で、docs/runbook.md のインシデント対応手順も
    //   「admin_audit_logs で操作履歴を確認」と書いている。
    //   以前は console.log だけで DB に残らず、Vercel のログ保持期間を過ぎると
    //   誰がいつ誰になりすましたかを追う手段が消えていた（手順と実装の食い違い）。
    await writeAuditLog({
      actorId: callerUser.id,
      actorRole: 'admin',
      action: 'user.impersonate',
      targetType: 'user_profile',
      targetId: userId,
      request,
    });

    // 呼び出し元 admin の refresh_token を httpOnly cookie に保存
    const res = NextResponse.json({ actionLink, hashedToken, email: targetEmail });
    res.cookies.set('impersonator_refresh_token', currentRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 4, // 4時間
    });
    res.cookies.set('impersonator_user_id', callerUser.id, {
      httpOnly: false, // クライアントからバナー表示に使用
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 4,
    });
    return res;
  } catch (err) {
    captureApiError(err, {
      route: 'POST /api/admin/impersonate',
    });
    console.error('POST /api/admin/impersonate error:', err);
    return NextResponse.json({ error: 'スイッチに失敗しました' }, { status: 500 });
  }
}
