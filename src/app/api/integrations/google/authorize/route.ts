import { NextRequest, NextResponse } from 'next/server';
import { getApiAuth } from '@/lib/api-auth';
import { getGoogleAuthUrl } from '@/lib/google-calendar';
import { generateGoogleOauthState, setGoogleOauthState } from '@/lib/googleOauthState';

export const dynamic = 'force-dynamic';

const ALLOWED_ROLES = ['admin', 'owner', 'manager'];

/**
 * Google Calendar OAuth 認証開始
 * → state を発行して cookie に保存し、Googleの認証画面にリダイレクトする
 *
 * ★ 認証方法（2026-08 変更）:
 *   以前は `?token=<Supabaseのアクセストークン>` をクエリで受け取っていたが、
 *   URLのクエリはアクセスログ・Referer・ブラウザ履歴・プロキシに残るため、
 *   ログイン用JWTを載せるのは危険だった。ここはトップレベル遷移なので
 *   セッション cookie がそのまま送られる。getApiAuth（Authorization ヘッダー →
 *   cookie の順で解決）に一本化した。
 *
 * ★ state を cookie に持つ理由:
 *   コールバックで「誰の連携か」をクエリの値から決めると、他人のIDを書いた
 *   コールバックURLを叩くだけでトークンを乗っ取れる。詳細は lib/googleOauthState.ts。
 */
export async function GET(request: NextRequest) {
  const { auth, cookieResponse } = await getApiAuth(request);

  if (!auth) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  if (!ALLOWED_ROLES.includes(auth.role.toLowerCase())) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }

  const origin = request.nextUrl.origin;

  // この往復専用のランダムな state を発行する（userId は載せない）。
  const state = generateGoogleOauthState();
  const authUrl = getGoogleAuthUrl(state, origin);

  const response = NextResponse.redirect(authUrl);

  // getApiAuth がセッションを更新していた場合、その cookie を落とさず引き継ぐ
  // （落とすとリダイレクト後にログアウト扱いになりうる）。
  cookieResponse.cookies.getAll().forEach((c) => response.cookies.set(c.name, c.value, c));

  // 紐づけ先の userId は「サーバーが認証した値」だけを cookie 側に閉じ込める。
  return setGoogleOauthState(response, { state, userId: auth.userId });
}
