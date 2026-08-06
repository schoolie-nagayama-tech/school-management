import 'server-only';
import { cookies } from 'next/headers';
import type { NextResponse } from 'next/server';

/**
 * 保護者ポータルのセッション管理。
 *
 * ポータルJWT（jwt.ts で署名）を httpOnly cookie に保持する。
 * スタッフ用セッション（sb-auth-token）とは別 cookie（portal_session）で
 * 主体を分離する。next/headers の cookies() を使うサーバー専用モジュール。
 */

/** ポータルセッション cookie 名。スタッフの sb-auth-token と衝突させない。 */
export const PORTAL_SESSION_COOKIE = 'portal_session';

/** cookie の有効期限（秒）。JWTの exp と揃える（24時間）。 */
const COOKIE_MAX_AGE_SECONDS = 24 * 60 * 60;

/**
 * セッション cookie の共通オプション。
 * - httpOnly: JSからアクセス不可（XSSでのトークン窃取を防ぐ）
 * - secure: 本番のみ true（ローカルhttpでも動くように開発時は false）
 * - sameSite=lax: 通常遷移で送られCSRFはある程度抑える
 *   （LINEログインのコールバックは外部サイトからのトップレベル GET 遷移なので
 *    lax でも cookie が送られる。strict にすると復帰直後に未ログイン扱いになる）
 */
function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: COOKIE_MAX_AGE_SECONDS,
  };
}

/**
 * ポータルJWTをセッション cookie に書き込む（next/headers 経由）。
 * JSONを返すルート用。リダイレクトを返すルートでは
 * setPortalSessionOnResponse を使う（レスポンスに確実に載せるため）。
 */
export async function setPortalSession(token: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(PORTAL_SESSION_COOKIE, token, sessionCookieOptions());
}

/**
 * ポータルJWTをレスポンスに直接セットする。
 *
 * ★ なぜ別関数が要るか:
 *   リダイレクトを返すルート（LINEログインのコールバック）では、
 *   next/headers の cookies() 経由の書き込みがレスポンスに載る保証が
 *   バージョン差で揺れる。Set-Cookie を明示的にレスポンスへ積むことで
 *   「リダイレクトと同時にログイン状態になる」ことを確実にする。
 */
export function setPortalSessionOnResponse(response: NextResponse, token: string): NextResponse {
  response.cookies.set(PORTAL_SESSION_COOKIE, token, sessionCookieOptions());
  return response;
}

/**
 * セッション cookie からポータルJWTを取り出す。
 * @returns JWT文字列。無ければ null
 */
export async function getPortalSessionToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(PORTAL_SESSION_COOKIE)?.value ?? null;
}

/**
 * セッション cookie を削除する（ログアウト）。
 */
export async function clearPortalSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(PORTAL_SESSION_COOKIE);
}
