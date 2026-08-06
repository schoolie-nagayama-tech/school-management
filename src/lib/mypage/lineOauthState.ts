import 'server-only';
import type { NextRequest, NextResponse } from 'next/server';

/**
 * LINEログインの往復（authorize → callback）で持ち回す一時状態。
 *
 * ★ なぜ cookie に持つのか:
 *   - state: CSRF対策。認可開始時に発行した値と、コールバックのクエリの値を突き合わせる。
 *     攻撃者が用意した認可レスポンスを被害者のブラウザに踏ませる「ログインCSRF」を防ぐ。
 *   - nonce: リプレイ対策。id_token の検証時に LINE 側へ渡して一致を確認させる。
 *   - invite: 招待トークン。**URLのクエリではなく cookie に置く**のは、招待トークンが
 *     アカウント紐づけの権限そのものだから。stateパラメータに載せると LINE 側のログや
 *     リファラに残りうるので、外部に出さない cookie 側で運ぶ。
 *
 * 有効期限は短く（10分）。ログイン往復にそれ以上かかることはなく、
 * 放置された state が後から悪用される窓を狭める。
 */

/** 一時状態を入れる cookie 名。 */
export const LINE_OAUTH_STATE_COOKIE = 'line_oauth_state';

/** 一時状態の有効期限（秒）。ログイン往復には十分で、悪用の窓は狭い。 */
const STATE_MAX_AGE_SECONDS = 10 * 60;

/** cookie に入れる一時状態。 */
export interface LineOauthState {
  /** CSRF対策のランダム値（クエリの state と突き合わせる）。 */
  state: string;
  /** リプレイ対策のランダム値（id_token 検証で LINE に渡す）。 */
  nonce: string;
  /** 招待トークン（招待URL起点のログインのときだけ）。 */
  invite?: string;
}

/**
 * 一時状態をレスポンスの cookie に書き込む。
 * リダイレクトと同時にセットするため、next/headers ではなくレスポンスに直接積む。
 */
export function setLineOauthState(response: NextResponse, state: LineOauthState): NextResponse {
  response.cookies.set(LINE_OAUTH_STATE_COOKIE, JSON.stringify(state), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    // LINEからのコールバックは外部サイトからのトップレベル遷移。
    // strict だと cookie が送られず state 検証が必ず失敗するので lax にする。
    sameSite: 'lax',
    path: '/',
    maxAge: STATE_MAX_AGE_SECONDS,
  });
  return response;
}

/**
 * リクエストの cookie から一時状態を読む。壊れていれば null。
 */
export function readLineOauthState(request: NextRequest): LineOauthState | null {
  const raw = request.cookies.get(LINE_OAUTH_STATE_COOKIE)?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<LineOauthState>;
    if (typeof parsed.state !== 'string' || typeof parsed.nonce !== 'string') return null;
    return {
      state: parsed.state,
      nonce: parsed.nonce,
      invite: typeof parsed.invite === 'string' ? parsed.invite : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * 一時状態の cookie を消す。
 * 使い捨て（1回の往復で1回だけ有効）にして、同じ state の再利用を防ぐ。
 */
export function clearLineOauthState(response: NextResponse): NextResponse {
  response.cookies.delete(LINE_OAUTH_STATE_COOKIE);
  return response;
}
