/**
 * APIルートテスト: /api/admin/impersonate (POST)
 * 管理者限定のアカウントスイッチ（impersonate）エンドポイント
 * admin ロールのみ許可、owner は除外
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { createMockChain } from './helpers';

const mockAdmin = {
  from: vi.fn(() => createMockChain(null)),
  auth: {
    getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
    admin: {
      generateLink: vi.fn().mockResolvedValue({ data: null, error: null }),
    },
  },
};

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => mockAdmin),
}));

vi.mock('@/lib/api-auth', () => ({
  requireAdmin: vi.fn().mockResolvedValue(null),
}));

function makeRequest(body: Record<string, unknown>, bearerToken = 'valid-token') {
  return new NextRequest('http://localhost:3000/api/admin/impersonate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${bearerToken}`,
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/admin/impersonate', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // デフォルト: auth.getUser → admin ユーザー
    mockAdmin.auth.getUser = vi.fn().mockResolvedValue({
      data: { user: { id: 'admin-user-id' } },
      error: null,
    });
    // callerProfile → admin
    // targetProfile → teacher with email
    let fromCallCount = 0;
    mockAdmin.from.mockImplementation(() => {
      fromCallCount++;
      if (fromCallCount === 1) {
        return createMockChain({ role: 'admin' }) as never;
      }
      return createMockChain({ id: 'target-id', email: 'target@example.com' }) as never;
    });
    // generateLink → success
    mockAdmin.auth.admin.generateLink = vi.fn().mockResolvedValue({
      data: {
        properties: {
          action_link: 'https://example.com/auth/confirm?token=abc',
          hashed_token: 'hashed-abc',
        },
      },
      error: null,
    });
  });

  it('requireAdminで弾かれると401/403を返す', async () => {
    const { requireAdmin } = await import('@/lib/api-auth');
    vi.mocked(requireAdmin).mockResolvedValueOnce(
      NextResponse.json({ error: '認証が必要です' }, { status: 401 })
    );

    const { POST } = await import('@/app/api/admin/impersonate/route');
    const res = await POST(makeRequest({ userId: 'x', currentRefreshToken: 'rt' }));
    expect(res.status).toBe(401);
  });

  it('userId/currentRefreshTokenが欠けると400を返す', async () => {
    const { POST } = await import('@/app/api/admin/impersonate/route');

    const res1 = await POST(makeRequest({ currentRefreshToken: 'rt' }));
    expect(res1.status).toBe(400);

    const res2 = await POST(makeRequest({ userId: 'x' }));
    expect(res2.status).toBe(400);
  });

  it('Authorizationヘッダがないと401を返す', async () => {
    const req = new NextRequest('http://localhost:3000/api/admin/impersonate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'x', currentRefreshToken: 'rt' }),
    });

    const { POST } = await import('@/app/api/admin/impersonate/route');
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('owner ロールでは403を返す（admin のみ許可）', async () => {
    let fromCallCount = 0;
    mockAdmin.from.mockImplementation(() => {
      fromCallCount++;
      if (fromCallCount === 1) {
        return createMockChain({ role: 'owner' }) as never;
      }
      return createMockChain(null) as never;
    });

    const { POST } = await import('@/app/api/admin/impersonate/route');
    const res = await POST(makeRequest({ userId: 'target-id', currentRefreshToken: 'rt' }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('システム管理者');
  });

  it('対象ユーザーが見つからないと404を返す', async () => {
    let fromCallCount = 0;
    mockAdmin.from.mockImplementation(() => {
      fromCallCount++;
      if (fromCallCount === 1) return createMockChain({ role: 'admin' }) as never;
      return createMockChain(null) as never;
    });

    const { POST } = await import('@/app/api/admin/impersonate/route');
    const res = await POST(makeRequest({ userId: 'nonexistent', currentRefreshToken: 'rt' }));
    expect(res.status).toBe(404);
  });

  it('正常にimpersonate成功し、cookieが設定される', async () => {
    const { POST } = await import('@/app/api/admin/impersonate/route');
    const res = await POST(makeRequest({ userId: 'target-id', currentRefreshToken: 'my-refresh' }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.actionLink).toBeDefined();
    expect(body.hashedToken).toBe('hashed-abc');
    expect(body.email).toBe('target@example.com');

    const cookies = res.cookies.getAll();
    const refreshCookie = cookies.find((c) => c.name === 'impersonator_refresh_token');
    expect(refreshCookie).toBeDefined();
    expect(refreshCookie?.value).toBe('my-refresh');

    const userIdCookie = cookies.find((c) => c.name === 'impersonator_user_id');
    expect(userIdCookie).toBeDefined();
    expect(userIdCookie?.value).toBe('admin-user-id');
  });

  it('generateLink失敗時に500を返す', async () => {
    mockAdmin.auth.admin.generateLink = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'Rate limit exceeded' },
    });

    const { POST } = await import('@/app/api/admin/impersonate/route');
    const res = await POST(makeRequest({ userId: 'target-id', currentRefreshToken: 'rt' }));
    expect(res.status).toBe(500);
  });
});
