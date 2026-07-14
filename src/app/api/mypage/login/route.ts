import { NextRequest, NextResponse } from 'next/server';
import { getPortalServiceClient } from '@/lib/mypage/serviceClient';
import { verifyPassword } from '@/lib/mypage/password';
import { signPortalJwt } from '@/lib/mypage/jwt';
import { setPortalSession } from '@/lib/mypage/session';

export const dynamic = 'force-dynamic';

/**
 * 保護者ポータル ログイン（案3: 自前ログイン → 自前署名JWT → cookie）。
 *
 * body: { login_id: string, password: string }
 * 成功: portal_session cookie をセットし { ok: true, account } を返す。
 * 失敗: 401（ID/PW のどちらが違うかは区別しない = 列挙攻撃を防ぐ）。
 *
 * TODO(Stage2以降): 本格的なレート制限（IP/アカウント単位の試行回数制御）。
 *   現状は失敗時の一律ディレイのみ（総当たりの速度をわずかに落とす簡易対策）。
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
  }

  const login_id = (body as Record<string, unknown>)?.login_id;
  const password = (body as Record<string, unknown>)?.password;
  if (typeof login_id !== 'string' || typeof password !== 'string' || !login_id || !password) {
    return NextResponse.json({ error: 'IDとパスワードを入力してください' }, { status: 400 });
  }

  const supabase = getPortalServiceClient();

  // login_id でアカウントを検索（RLSバイパスの service role）。
  const { data: account, error } = await supabase
    .from('portal_accounts')
    .select('id, login_id, password_hash, display_name')
    .eq('login_id', login_id)
    .maybeSingle();

  if (error) {
    console.error('[mypage/login] アカウント検索に失敗:', error.message);
    return NextResponse.json({ error: 'ログインに失敗しました' }, { status: 500 });
  }

  // 認証失敗は「ID不明」も「PW不一致」も同じ 401・同じメッセージにする。
  const ok =
    account?.password_hash != null && (await verifyPassword(password, account.password_hash));
  if (!account || !ok) {
    // 総当たり速度を落とす簡易ディレイ（本格対策は上記 TODO）。
    await new Promise((r) => setTimeout(r, 500));
    return NextResponse.json({ error: 'IDまたはパスワードが違います' }, { status: 401 });
  }

  // last_login_at を更新（失敗してもログイン自体は成功扱い）。
  await supabase
    .from('portal_accounts')
    .update({ last_login_at: new Date().toISOString() })
    .eq('id', account.id);

  // 自前署名JWTを発行して cookie に保存する。
  const jwt = await signPortalJwt(account.id);
  await setPortalSession(jwt);

  return NextResponse.json({
    ok: true,
    account: { id: account.id, display_name: account.display_name },
  });
}
