/**
 * 認証セッションの cookie 名がクライアント／サーバーで揃っていることを固定するテスト。
 *
 * ★ なぜ要るか: この不一致で2回本番事故が起きている。
 *   - Phase3 のサーバー事前取得が常に null（supabase-server.ts で指定漏れ）
 *   - ロゴ画像アップロードが必ず401（api-auth.ts の getApiAuth で指定漏れ）
 *   @supabase/ssr の createServerClient は cookie 名を auth.storageKey ではなく
 *   cookieOptions.name から決めるため、片方だけ直すと静かにログイン不能になる。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { AUTH_COOKIE_NAME } from '@/lib/authCookie';

// createServerClient に渡された options を捕まえるためのモック
const capturedOptions: Record<string, unknown>[] = [];

vi.mock('@supabase/ssr', () => ({
  createServerClient: (_url: string, _key: string, options: Record<string, unknown>) => {
    capturedOptions.push(options);
    return {
      auth: {
        getSession: () =>
          Promise.resolve({ data: { session: { user: { id: 'user-1' } } }, error: null }),
      },
      // getApiAuth は user_profiles を maybeSingle() で、user_schools は eq() を
      // そのまま await する。どちらも成立するよう eq() を thenable にしておく。
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: { role: 'manager' }, error: null }),
            then: (resolve: (v: { data: unknown[]; error: null }) => void) =>
              resolve({ data: [], error: null }),
          }),
        }),
      }),
    };
  },
}));

describe('AUTH_COOKIE_NAME', () => {
  it("値は 'sb-auth-token'（ブラウザの storageKey と同一）", () => {
    expect(AUTH_COOKIE_NAME).toBe('sb-auth-token');
  });
});

describe('getApiAuth の cookie 経路', () => {
  beforeEach(() => {
    capturedOptions.length = 0;
  });

  it('createServerClient に cookieOptions.name を渡している（漏れると常に401）', async () => {
    const { getApiAuth } = await import('@/lib/api-auth');
    const req = new NextRequest('http://localhost:3000/api/upload/logo', { method: 'POST' });

    const { auth } = await getApiAuth(req);

    expect(capturedOptions.length).toBeGreaterThan(0);
    expect(capturedOptions[0].cookieOptions).toEqual({ name: AUTH_COOKIE_NAME });
    // cookie 名が合っていればセッションを読めて認証が通る
    expect(auth).not.toBeNull();
    expect(auth?.role).toBe('manager');
  });
});

/**
 * createServerClient を呼ぶ箇所すべてに cookieOptions が付いていることの静的チェック。
 * 新しいサーバークライアントを足したときの指定漏れを機械的に拾う。
 */
describe('createServerClient の呼び出し箇所', () => {
  const FILES = [
    'src/lib/api-auth.ts',
    'src/lib/supabase-server.ts',
    'src/app/api/dev/login/route.ts',
  ];

  it.each(FILES)('%s は cookieOptions で cookie 名を指定している', (rel) => {
    const src = readFileSync(join(process.cwd(), rel), 'utf8');
    expect(src).toContain('createServerClient');
    expect(src).toContain('cookieOptions: { name: AUTH_COOKIE_NAME }');
  });
});
