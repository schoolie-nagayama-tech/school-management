import 'server-only';
import { cookies } from 'next/headers';

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
 * ポータルJWTをセッション cookie に書き込む。
 * - httpOnly: JSからアクセス不可（XSSでのトークン窃取を防ぐ）
 * - secure: 本番のみ true（ローカルhttpでも動くように開発時は false）
 * - sameSite=lax: 通常遷移で送られCSRFはある程度抑える
 */
export async function setPortalSession(token: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(PORTAL_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
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
