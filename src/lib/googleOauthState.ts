import 'server-only';
import { randomBytes, timingSafeEqual } from 'crypto';
import type { NextRequest, NextResponse } from 'next/server';

/**
 * Googleカレンダー連携の OAuth 往復（authorize → callback）で持ち回す一時状態。
 *
 * ★ なぜ cookie に持つのか（塞いでいる攻撃）:
 *   以前は state に「生の userId」を載せていたため、攻撃者が自分のGoogleアカウントで
 *   認可コードを取り、`/api/integrations/google/callback?code=<攻撃者のcode>&state=<被害者のuserId>`
 *   を叩くだけで、被害者のカレンダートークンを自分のものへ上書きできた
 *   （以降その講師の授業予定＝生徒名・日程が攻撃者のカレンダーに流れ続ける）。
 *   userId は manager 以上なら /api/admin/users から取得できるので、当て推量も不要だった。
 *
 *   そこで LINEログイン（lib/mypage/lineOauthState.ts）と同じ作りに揃える:
 *     - state は推測不可能なランダム値にして httpOnly cookie に保存する
 *     - コールバックではクエリの state と cookie の state を突き合わせる
 *     - **紐づけ先の userId はクエリではなく cookie 側から取り出す**
 *       （クエリの値は攻撃者が自由に書けるので一切信用しない）
 *
 * 有効期限は短く（10分）。Googleの同意画面を通る往復にそれ以上かかることはなく、
 * 放置された state が後から悪用される窓を狭める。
 */

/** 一時状態を入れる cookie 名。 */
export const GOOGLE_OAUTH_STATE_COOKIE = 'google_oauth_state';

/** 一時状態の有効期限（秒）。認可の往復には十分で、悪用の窓は狭い。 */
const STATE_MAX_AGE_SECONDS = 10 * 60;

/** cookie に入れる一時状態。 */
export interface GoogleOauthState {
  /** CSRF対策のランダム値（クエリの state と突き合わせる）。 */
  state: string;
  /** 連携先のスタッフユーザーID。authorize 時に認証済みの値だけを入れる。 */
  userId: string;
  /** 有効期限（epoch ミリ秒）。cookie の maxAge とは別にサーバー側でも確認する。 */
  expiresAt: number;
}

/** CSRF対策の state に使う推測不可能なランダム文字列。 */
export function generateGoogleOauthState(): string {
  return randomBytes(32).toString('hex');
}

/**
 * 一時状態をレスポンスの cookie に書き込む。
 * Googleへのリダイレクトと同時にセットするため、next/headers ではなくレスポンスに直接積む。
 */
export function setGoogleOauthState(
  response: NextResponse,
  params: { state: string; userId: string }
): NextResponse {
  const payload: GoogleOauthState = {
    state: params.state,
    userId: params.userId,
    expiresAt: Date.now() + STATE_MAX_AGE_SECONDS * 1000,
  };
  response.cookies.set(GOOGLE_OAUTH_STATE_COOKIE, JSON.stringify(payload), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    // Googleからのコールバックは外部サイトからのトップレベル遷移。
    // strict だと cookie が送られず state 検証が必ず失敗するので lax にする。
    sameSite: 'lax',
    path: '/',
    maxAge: STATE_MAX_AGE_SECONDS,
  });
  return response;
}

/**
 * リクエストの cookie から一時状態を読む。無い・壊れている場合は null。
 */
export function readGoogleOauthState(request: NextRequest): GoogleOauthState | null {
  const raw = request.cookies.get(GOOGLE_OAUTH_STATE_COOKIE)?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<GoogleOauthState>;
    if (typeof parsed.state !== 'string' || parsed.state.length === 0) return null;
    if (typeof parsed.userId !== 'string' || parsed.userId.length === 0) return null;
    if (typeof parsed.expiresAt !== 'number' || !Number.isFinite(parsed.expiresAt)) return null;
    return { state: parsed.state, userId: parsed.userId, expiresAt: parsed.expiresAt };
  } catch {
    return null;
  }
}

/**
 * クエリの state が cookie の state と一致し、かつ有効期限内かを判定する。
 *
 * 比較は定数時間（timingSafeEqual）で行う。state は毎回使い捨てなので実害は小さいが、
 * 「秘密値の比較は定数時間」を例外なしの規約にしておくほうが後から崩れない。
 *
 * @param saved cookie から読んだ一時状態
 * @param stateParam Googleのコールバックが返してきた state クエリ
 */
export function verifyGoogleOauthState(
  saved: GoogleOauthState | null,
  stateParam: string | null,
  now: number = Date.now()
): boolean {
  if (!saved || !stateParam) return false;
  if (saved.expiresAt <= now) return false;
  return timingSafeEqualString(saved.state, stateParam);
}

/**
 * 一時状態の cookie を消す。
 * 使い捨て（1回の往復で1回だけ有効）にして、同じ state の再利用を防ぐ。
 */
export function clearGoogleOauthState(response: NextResponse): NextResponse {
  response.cookies.delete(GOOGLE_OAUTH_STATE_COOKIE);
  return response;
}

/** 文字列の定数時間比較。長さが違う時点で不一致（長さは秘密ではない）。 */
function timingSafeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
