import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// 認証ガードをモック — デフォルトは未認証(401を返す)
vi.mock('@/lib/api-auth', () => ({
  requireManager: vi.fn().mockResolvedValue(
    NextResponse.json({ error: '認証が必要です' }, { status: 401 })
  ),
  requireAdmin: vi.fn().mockResolvedValue(
    NextResponse.json({ error: '認証が必要です' }, { status: 401 })
  ),
  getApiAuth: vi.fn().mockResolvedValue({
    auth: null,
    cookieResponse: NextResponse.next(),
  }),
  isUserInScope: vi.fn().mockResolvedValue(false),
  isSchoolInScope: vi.fn().mockReturnValue(false),
}));

// Supabase createClient のモック（ルート内の getSupabaseAdmin 用）
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    })),
    auth: {
      admin: {
        createUser: vi.fn().mockResolvedValue({ data: { user: null }, error: { message: 'mock' } }),
      },
    },
  })),
}));

// audit-log のモック
vi.mock('@/lib/audit-log', () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

describe('API認証ガード', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('未認証で /api/admin/users にアクセスすると 401 が返る', async () => {
    const { GET } = await import('@/app/api/admin/users/route');
    const req = new NextRequest('http://localhost:3000/api/admin/users');
    const res = await GET(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('認証が必要です');
  });

  it('未認証で /api/admin/users/create にアクセスすると 401 が返る', async () => {
    const { POST } = await import('@/app/api/admin/users/create/route');
    const req = new NextRequest('http://localhost:3000/api/admin/users/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('未認証で /api/admin/users/[userId] にアクセスすると 401 が返る', async () => {
    const { GET } = await import('@/app/api/admin/users/[userId]/route');
    const req = new NextRequest('http://localhost:3000/api/admin/users/fake-id');
    const res = await GET(req, { params: Promise.resolve({ userId: 'fake-id' }) });
    expect(res.status).toBe(401);
  });

  it('未認証で /api/seasonal-shift/notify にアクセスすると 401 が返る', async () => {
    const { POST } = await import('@/app/api/seasonal-shift/notify/route');
    const req = new NextRequest('http://localhost:3000/api/seasonal-shift/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('エラーレスポンスに details フィールドが含まれない', async () => {
    // requireManagerのモックを再設定（前のテストでbodyが消費済みのため）
    const { requireManager } = await import('@/lib/api-auth');
    vi.mocked(requireManager).mockResolvedValueOnce(
      NextResponse.json({ error: '認証が必要です' }, { status: 401 })
    );
    const { GET } = await import('@/app/api/admin/users/route');
    const req = new NextRequest('http://localhost:3000/api/admin/users');
    const res = await GET(req);
    const body = await res.json();
    expect(body).not.toHaveProperty('details');
  });
});
