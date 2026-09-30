import { NextRequest, NextResponse } from 'next/server';
import { getPortalServiceClient } from '@/lib/mypage/serviceClient';
import { verifyPassword } from '@/lib/mypage/password';
import { signPortalJwt } from '@/lib/mypage/jwt';
import { setPortalSession } from '@/lib/mypage/session';
import { captureApiError } from '@/lib/api-error';
import { checkDurableRateLimit } from '@/lib/utils/durableRateLimit';

export const dynamic = 'force-dynamic';

/**
 * ID が存在しないときにも bcrypt の照合を1回走らせるためのダミーハッシュ（中身に意味は無い）。
 * ★以前は ID が無いと bcrypt を飛ばしていたため、応答の速さの差（約50〜100ms）で
 *   「そのログインIDが存在するか」を調べられた（2026-09-30 セキュリティ総点検）。
 */
const DUMMY_PASSWORD_HASH = '$2b$10$wGJ1oIFJg5oKjiRdqw5iCuG0Z41FyAmccYY5/AGzefUHJQvS5D2fi';

/** 1つのログインIDに対する試行の上限（15分で10回）。IP を変えながらの総当たりを止める */
const ACCOUNT_ATTEMPT_LIMIT = 10;
const ACCOUNT_ATTEMPT_WINDOW_SECONDS = 15 * 60;

/**
 * 保護者ポータル ログイン（案3: 自前ログイン → 自前署名JWT → cookie）。
 *
 * body: { login_id: string, password: string }
 * 成功: portal_session cookie をセットし { ok: true, account } を返す。
 * 失敗: 401（ID/PW のどちらが違うかは区別しない = 列挙攻撃を防ぐ）。
 *
 * 総当たり対策（2026-09-30 セキュリティ総点検）:
 *   - IP 単位: middleware の回数制限（10回/分。DB で全インスタンス共通に数える）
 *   - ログインID 単位: このルートで 15分10回まで（IP を変えながら1つのIDを狙う攻撃向け）
 *   - 失敗時の一律ディレイと、ID が無いときのダミー照合（応答時間でIDの有無を悟らせない）
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    captureApiError(error, {
      route: 'POST /api/mypage/login',
    });
    return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
  }

  const login_id = (body as Record<string, unknown>)?.login_id;
  const password = (body as Record<string, unknown>)?.password;
  if (typeof login_id !== 'string' || typeof password !== 'string' || !login_id || !password) {
    return NextResponse.json({ error: 'IDとパスワードを入力してください' }, { status: 400 });
  }

  // ログインID単位の回数制限。ID の有無に関係なく数える（有無で挙動を変えると列挙に使われる）。
  const accountAllowed = await checkDurableRateLimit({
    bucket: 'mypage-login-account',
    key: login_id.trim().toLowerCase(),
    limit: ACCOUNT_ATTEMPT_LIMIT,
    windowSeconds: ACCOUNT_ATTEMPT_WINDOW_SECONDS,
  });
  if (!accountAllowed) {
    return NextResponse.json(
      { error: 'ログインの試行回数が多すぎます。15分ほど待ってから、もう一度お試しください' },
      { status: 429 }
    );
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
  // ID が無い・パスワード未設定のときもダミーで照合し、かかる時間をそろえる。
  const hashToCheck = account?.password_hash ?? DUMMY_PASSWORD_HASH;
  const matched = await verifyPassword(password, hashToCheck);
  const ok = account?.password_hash != null && matched;
  if (!account || !ok) {
    // 総当たり速度を落とす簡易ディレイ。
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
