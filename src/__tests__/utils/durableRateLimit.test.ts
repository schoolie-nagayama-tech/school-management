/**
 * DB で数える回数制限（src/lib/utils/durableRateLimit.ts）の境界を固定する。
 *
 * ★ なぜこのテストが要るか:
 *   「DB に届かないときは通す」を「止める」に変えると、Supabase の不調ひとつで保護者のログインや
 *   公開フォームが全部止まる。逆に DB の答え（false）を無視すると回数制限が効かなくなる。
 *   また IP やログインIDをそのまま DB に送らないこと（ハッシュ化）もここで固定する。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkDurableRateLimit, hashRateLimitKey } from '@/lib/utils/durableRateLimit';

const params = { bucket: '/api/mypage/login', key: '203.0.113.5', limit: 10, windowSeconds: 60 };

describe('checkDurableRateLimit', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  it('DB が true を返せば通す', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('true', { status: 200 })));
    expect(await checkDurableRateLimit(params)).toBe(true);
  });

  it('DB が false（上限超え）を返せば止める', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('false', { status: 200 })));
    expect(await checkDurableRateLimit(params)).toBe(false);
  });

  it('DB がエラーを返したら通す（障害で全員を締め出さない）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('oops', { status: 500 })));
    expect(await checkDurableRateLimit(params)).toBe(true);
  });

  it('通信に失敗したら通す', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    expect(await checkDurableRateLimit(params)).toBe(true);
  });

  it('環境変数が無ければ DB に問い合わせずに通す', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await checkDurableRateLimit(params)).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('IP をそのまま送らず、ハッシュにして送る', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('true', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await checkDurableRateLimit(params);
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(sent.p_key_hash).toBe(await hashRateLimitKey('203.0.113.5'));
    expect(JSON.stringify(sent)).not.toContain('203.0.113.5');
  });
});

describe('hashRateLimitKey', () => {
  it('同じ値なら同じハッシュ、違う値なら違うハッシュ（SHA-256 の16進64文字）', async () => {
    const a = await hashRateLimitKey('login-id-1');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashRateLimitKey('login-id-1')).toBe(a);
    expect(await hashRateLimitKey('login-id-2')).not.toBe(a);
  });
});
