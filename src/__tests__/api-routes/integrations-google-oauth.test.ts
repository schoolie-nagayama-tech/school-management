/**
 * APIルートテスト: /api/integrations/google/{authorize,callback}
 *
 * Googleカレンダー連携の OAuth 往復。ここは「誰の連携か」を決める箇所なので、
 * 次の性質が壊れていないことを固定する:
 *   1) authorize はランダムな state を httpOnly cookie に発行し、userId を cookie 側に持つ
 *   2) callback は state 不一致 / cookie 無し / 期限切れをすべて 403 で拒否する
 *   3) callback はクエリの state（＝攻撃者が書ける値）を userId として使わない
 *   4) 正常系ではトークンを保存し、使い終わった state cookie を破棄する
 *
 * 塞いでいる攻撃: 攻撃者が自分のGoogle認可コードと被害者の userId を並べて
 * callback を叩き、被害者のカレンダー連携先を自分にすり替える（生徒名・日程の継続的漏洩）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('server-only', () => ({}));

// googleapis / Supabase に触らせない
const googleHolder = vi.hoisted(() => ({
  authUrl: 'https://accounts.google.com/o/oauth2/v2/auth?mock=1',
  shouldThrow: false,
}));
const handleGoogleCallback = vi.hoisted(() => vi.fn());
const getGoogleAuthUrl = vi.hoisted(() => vi.fn());
vi.mock('@/lib/google-calendar', () => ({
  getGoogleAuthUrl: (state: string, origin?: string) => {
    getGoogleAuthUrl(state, origin);
    return googleHolder.authUrl;
  },
  handleGoogleCallback: (code: string, userId: string, origin?: string) => {
    handleGoogleCallback(code, userId, origin);
    if (googleHolder.shouldThrow) throw new Error('交換失敗');
    return Promise.resolve({ email: 'staff@example.com' });
  },
}));

// 認証（authorize 側）
const authHolder = vi.hoisted(() => ({
  auth: { userId: 'user-victim', role: 'manager', schoolIds: ['s1'] } as {
    userId: string;
    role: string;
    schoolIds: string[];
  } | null,
}));
vi.mock('@/lib/api-auth', () => ({
  getApiAuth: vi.fn(async () => ({
    auth: authHolder.auth,
    cookieResponse: NextResponse.next(),
  })),
}));

import { GET as authorizeGET } from '@/app/api/integrations/google/authorize/route';
import { GET as callbackGET } from '@/app/api/integrations/google/callback/route';
import { GOOGLE_OAUTH_STATE_COOKIE } from '@/lib/googleOauthState';

const STATE = 'a'.repeat(64);
const VICTIM = 'user-victim';

/** state cookie の中身を組み立てる（既定は有効期限内）。 */
function stateCookie(opts?: { state?: string; userId?: string; expiresAt?: number }) {
  return JSON.stringify({
    state: opts?.state ?? STATE,
    userId: opts?.userId ?? VICTIM,
    expiresAt: opts?.expiresAt ?? Date.now() + 5 * 60 * 1000,
  });
}

/** コールバックのリクエストを作る。cookieRaw に null を渡すと cookie 無し。 */
function makeCallbackRequest(opts?: {
  code?: string | null;
  state?: string | null;
  cookieRaw?: string | null;
  error?: string;
}) {
  const url = new URL('http://localhost:3000/api/integrations/google/callback');
  if (opts?.error) url.searchParams.set('error', opts.error);
  const code = opts?.code === undefined ? 'auth-code' : opts.code;
  const state = opts?.state === undefined ? STATE : opts.state;
  if (code) url.searchParams.set('code', code);
  if (state) url.searchParams.set('state', state);

  const req = new NextRequest(url);
  const cookieRaw = opts?.cookieRaw === undefined ? stateCookie() : opts.cookieRaw;
  if (cookieRaw) req.cookies.set(GOOGLE_OAUTH_STATE_COOKIE, cookieRaw);
  return req;
}

describe('/api/integrations/google/authorize', () => {
  beforeEach(() => {
    getGoogleAuthUrl.mockReset();
    authHolder.auth = { userId: VICTIM, role: 'manager', schoolIds: ['s1'] };
  });

  it('未認証は401（クエリのトークンでは認証しない）', async () => {
    authHolder.auth = null;
    const req = new NextRequest(
      'http://localhost:3000/api/integrations/google/authorize?token=stolen-jwt'
    );
    const res = await authorizeGET(req);
    expect(res.status).toBe(401);
    expect(getGoogleAuthUrl).not.toHaveBeenCalled();
  });

  it('権限のないロールは403', async () => {
    authHolder.auth = { userId: 'user-teacher', role: 'teacher', schoolIds: ['s1'] };
    const res = await authorizeGET(
      new NextRequest('http://localhost:3000/api/integrations/google/authorize')
    );
    expect(res.status).toBe(403);
    expect(getGoogleAuthUrl).not.toHaveBeenCalled();
  });

  it('ランダムな state を発行し、userId とともに httpOnly cookie に保存する', async () => {
    const res = await authorizeGET(
      new NextRequest('http://localhost:3000/api/integrations/google/authorize')
    );

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(googleHolder.authUrl);

    const cookie = res.cookies.get(GOOGLE_OAUTH_STATE_COOKIE);
    expect(cookie).toBeTruthy();
    expect(cookie!.httpOnly).toBe(true);
    expect(cookie!.sameSite).toBe('lax');

    const payload = JSON.parse(cookie!.value) as {
      state: string;
      userId: string;
      expiresAt: number;
    };
    expect(payload.userId).toBe(VICTIM);
    expect(payload.expiresAt).toBeGreaterThan(Date.now());
    // Google に渡す state は cookie と同じランダム値（userId ではない）
    expect(getGoogleAuthUrl).toHaveBeenCalledWith(payload.state, 'http://localhost:3000');
    expect(payload.state).not.toBe(VICTIM);
    expect(payload.state.length).toBeGreaterThanOrEqual(32);
  });

  it('連続して呼ぶと state は毎回異なる（使い回さない）', async () => {
    const first = await authorizeGET(
      new NextRequest('http://localhost:3000/api/integrations/google/authorize')
    );
    const second = await authorizeGET(
      new NextRequest('http://localhost:3000/api/integrations/google/authorize')
    );
    const a = JSON.parse(first.cookies.get(GOOGLE_OAUTH_STATE_COOKIE)!.value).state;
    const b = JSON.parse(second.cookies.get(GOOGLE_OAUTH_STATE_COOKIE)!.value).state;
    expect(a).not.toBe(b);
  });
});

describe('/api/integrations/google/callback', () => {
  beforeEach(() => {
    handleGoogleCallback.mockReset();
    googleHolder.shouldThrow = false;
  });

  it('state cookie が無い場合は403（トークンを保存しない）', async () => {
    const res = await callbackGET(makeCallbackRequest({ cookieRaw: null }));
    expect(res.status).toBe(403);
    expect(handleGoogleCallback).not.toHaveBeenCalled();
  });

  it('クエリの state が cookie と一致しない場合は403（CSRF対策）', async () => {
    const res = await callbackGET(makeCallbackRequest({ state: 'b'.repeat(64) }));
    expect(res.status).toBe(403);
    expect(handleGoogleCallback).not.toHaveBeenCalled();
  });

  it('攻撃者が state に被害者の userId を書いても403（旧仕様の穴）', async () => {
    // 旧実装は state をそのまま userId として使っていたため、これが通ってしまった。
    const res = await callbackGET(makeCallbackRequest({ state: VICTIM, cookieRaw: null }));
    expect(res.status).toBe(403);
    expect(handleGoogleCallback).not.toHaveBeenCalled();
  });

  it('state cookie が期限切れなら403', async () => {
    const res = await callbackGET(
      makeCallbackRequest({ cookieRaw: stateCookie({ expiresAt: Date.now() - 1000 }) })
    );
    expect(res.status).toBe(403);
    expect(handleGoogleCallback).not.toHaveBeenCalled();
  });

  it('state cookie が壊れていれば403', async () => {
    const res = await callbackGET(makeCallbackRequest({ cookieRaw: 'not-json' }));
    expect(res.status).toBe(403);
    expect(handleGoogleCallback).not.toHaveBeenCalled();
  });

  it('拒否時は state cookie を破棄する（使い捨て）', async () => {
    const res = await callbackGET(makeCallbackRequest({ state: 'c'.repeat(64) }));
    expect(res.cookies.get(GOOGLE_OAUTH_STATE_COOKIE)?.value).toBeFalsy();
  });

  it('正常系: cookie 側の userId でトークンを保存し、state cookie を破棄する', async () => {
    const res = await callbackGET(makeCallbackRequest());

    expect(handleGoogleCallback).toHaveBeenCalledWith('auth-code', VICTIM, 'http://localhost:3000');
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('calendar_connected=true');
    expect(res.cookies.get(GOOGLE_OAUTH_STATE_COOKIE)?.value).toBeFalsy();
  });

  it('紐づけ先はクエリではなく cookie の userId を使う', async () => {
    // 攻撃者が cookie を持っていても、クエリで別人を指せないことの確認。
    await callbackGET(
      makeCallbackRequest({
        state: STATE,
        cookieRaw: stateCookie({ userId: 'user-attacker' }),
      })
    );
    expect(handleGoogleCallback).toHaveBeenCalledWith(
      'auth-code',
      'user-attacker',
      'http://localhost:3000'
    );
  });

  it('Google側がエラーを返した場合は設定画面へ戻し、state cookie を破棄する', async () => {
    const res = await callbackGET(makeCallbackRequest({ error: 'access_denied' }));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('calendar_error=');
    expect(handleGoogleCallback).not.toHaveBeenCalled();
    expect(res.cookies.get(GOOGLE_OAUTH_STATE_COOKIE)?.value).toBeFalsy();
  });

  it('state は正しいが code が無い場合は設定画面へ戻す', async () => {
    const res = await callbackGET(makeCallbackRequest({ code: null }));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('calendar_error=');
    expect(handleGoogleCallback).not.toHaveBeenCalled();
  });

  it('トークン交換に失敗した場合は設定画面へエラーを返す', async () => {
    googleHolder.shouldThrow = true;
    const res = await callbackGET(makeCallbackRequest());
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('calendar_error=');
  });
});
