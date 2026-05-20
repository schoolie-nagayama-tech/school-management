/**
 * APIルートテスト: /api/admin/users/create (POST)
 * ユーザー作成エンドポイントのテスト
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { createMockSupabaseAdmin, createMockChain, authSuccessMocks } from './helpers';

const mockAdmin = createMockSupabaseAdmin();

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => mockAdmin),
}));

vi.mock('@/lib/api-auth', () => authSuccessMocks());
vi.mock('@/lib/audit-log', () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }));

function makeCreateRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost:3000/api/admin/users/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/admin/users/create', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // デフォルト: メール重複なし → Auth成功 → profile作成 → user_schools挿入 → 一覧返却
    let callCount = 0;
    mockAdmin.from.mockImplementation(((table: string) => {
      callCount++;
      if (table === 'user_profiles' && callCount <= 2) {
        // 1回目: メール重複チェック → null（重複なし）
        // 2回目: profile 作成 or 確認
        return createMockChain(null) as never;
      }
      if (table === 'user_schools') {
        return createMockChain(null) as never;
      }
      // 最後: 作成済みユーザー返却
      return createMockChain({ id: 'new-user-id', email: 'test@example.com', display_name: 'テスト', role: 'teacher' }) as never;
    }) as unknown as () => Record<string, ReturnType<typeof vi.fn>>);
    mockAdmin.auth.admin.createUser.mockResolvedValue({
      data: { user: { id: 'new-user-id', email: 'test@example.com' } },
      error: null,
    });
  });

  it('有効なリクエストでユーザーを作成できる', async () => {
    const { POST } = await import('@/app/api/admin/users/create/route');
    const req = makeCreateRequest({
      email: 'new@example.com',
      password: 'TestPass123',
      displayName: 'テストユーザー',
      role: 'teacher',
      schoolId: 'test-school-id',
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.user).toBeDefined();
  });

  it('未認証で401を返す', async () => {
    const { requireManager } = await import('@/lib/api-auth');
    vi.mocked(requireManager).mockResolvedValueOnce(
      NextResponse.json({ error: '認証が必要です' }, { status: 401 })
    );

    const { POST } = await import('@/app/api/admin/users/create/route');
    const req = makeCreateRequest({ email: 'x', password: 'p', displayName: 'd', role: 'teacher', schoolId: 's' });
    const res = await POST(req);

    expect(res.status).toBe(401);
  });

  it('必須項目がない場合に400を返す', async () => {
    const { POST } = await import('@/app/api/admin/users/create/route');
    // password が欠落
    const req = makeCreateRequest({ email: 'x@x.com', displayName: 'd', role: 'teacher', schoolId: 's' });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('必須');
  });

  it('スコープ外の教室で403を返す', async () => {
    const { isSchoolInScope } = await import('@/lib/api-auth');
    vi.mocked(isSchoolInScope).mockReturnValueOnce(false);

    const { POST } = await import('@/app/api/admin/users/create/route');
    const req = makeCreateRequest({
      email: 'x@x.com',
      password: 'TestPass123',
      displayName: 'd',
      role: 'teacher',
      schoolId: 'other-school',
    });
    const res = await POST(req);

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('操作権限');
  });

  it('メール未指定の場合はシステム自動生成メールが使われる', async () => {
    const { POST } = await import('@/app/api/admin/users/create/route');
    const req = makeCreateRequest({
      password: 'TestPass123',
      displayName: 'メール無しユーザー',
      role: 'teacher',
      schoolId: 'test-school-id',
    });
    await POST(req);

    // auth.admin.createUser が自動生成メールで呼ばれたことを確認
    expect(mockAdmin.auth.admin.createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: expect.stringContaining('@system.local'),
        password: 'TestPass123',
      })
    );
  });

  it('メール重複時に400を返す', async () => {
    // メール重複チェックで既存ユーザーが見つかる
    mockAdmin.from.mockImplementation(() =>
      createMockChain({ id: 'existing-id', email: 'dup@example.com' }) as never
    );

    const { POST } = await import('@/app/api/admin/users/create/route');
    const req = makeCreateRequest({
      email: 'dup@example.com',
      password: 'TestPass123',
      displayName: 'dup',
      role: 'teacher',
      schoolId: 'test-school-id',
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('既に登録');
  });

  it('Auth作成失敗時に400を返す', async () => {
    mockAdmin.from.mockImplementation(() => createMockChain(null) as never);
    mockAdmin.auth.admin.createUser.mockResolvedValueOnce({
      data: { user: null },
      error: { message: 'User already registered' },
    });

    const { POST } = await import('@/app/api/admin/users/create/route');
    const req = makeCreateRequest({
      email: 'x@x.com',
      password: 'TestPass123',
      displayName: 'd',
      role: 'teacher',
      schoolId: 'test-school-id',
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('既に登録されています');
  });
});
