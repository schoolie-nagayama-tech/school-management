/**
 * APIルートテスト: /api/admin/users (GET)
 * ユーザー一覧取得エンドポイントのテスト
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { createMockSupabaseAdmin, createMockChain, authSuccessMocks, authFailMocks } from './helpers';

const mockAdmin = createMockSupabaseAdmin();

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => mockAdmin),
}));

vi.mock('@/lib/api-auth', () => authSuccessMocks());

describe('GET /api/admin/users', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('認証通過後にユーザー一覧を返す', async () => {
    // from('user_profiles').select().lte().order() → profiles
    // from('user_schools').select().in().lte().order().order() → user_schools
    const profiles = [
      { id: 'u1', display_name: 'Admin', role: 'admin', available_slot_numbers_by_day: null },
      { id: 'u2', display_name: 'Manager', role: 'manager', available_slot_numbers_by_day: null },
    ];
    const userSchools = [
      { user_id: 'u1', school_id: 's1', school: { id: 's1', name: '教室A', code: 'A' } },
    ];

    let callCount = 0;
    mockAdmin.from.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // user_profiles query
        return createMockChain(profiles) as never;
      }
      // user_schools query
      return createMockChain(userSchools) as never;
    });

    const { GET } = await import('@/app/api/admin/users/route');
    const req = new NextRequest('http://localhost:3000/api/admin/users');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.users).toBeDefined();
    expect(body.users.length).toBe(2);
    expect(body.users[0].id).toBe('u1');
    // user_schools がマージされている
    expect(body.users[0].user_schools).toBeDefined();
  });

  it('role=teacher パラメータで講師のみフィルタされる', async () => {
    const profiles = [
      { id: 'u1', display_name: 'Admin', role: 'admin', available_slot_numbers_by_day: null },
      { id: 'u2', display_name: 'Teacher', role: 'teacher', available_slot_numbers_by_day: null },
    ];

    let callCount = 0;
    mockAdmin.from.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return createMockChain(profiles) as never;
      return createMockChain([]) as never;
    });

    const { GET } = await import('@/app/api/admin/users/route');
    const req = new NextRequest('http://localhost:3000/api/admin/users?role=teacher');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    // teacher のみフィルタ
    expect(body.users.length).toBe(1);
    expect(body.users[0].role).toBe('teacher');
  });

  it('プロファイルが空の場合は空配列を返す', async () => {
    mockAdmin.from.mockImplementation(() => createMockChain([]) as never);

    const { GET } = await import('@/app/api/admin/users/route');
    const req = new NextRequest('http://localhost:3000/api/admin/users');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.users).toEqual([]);
  });

  it('未認証で401を返す', async () => {
    const { requireManager } = await import('@/lib/api-auth');
    vi.mocked(requireManager).mockResolvedValueOnce(
      NextResponse.json({ error: '認証が必要です' }, { status: 401 })
    );

    const { GET } = await import('@/app/api/admin/users/route');
    const req = new NextRequest('http://localhost:3000/api/admin/users');
    const res = await GET(req);

    expect(res.status).toBe(401);
  });

  it('Cache-Controlヘッダが設定されている', async () => {
    mockAdmin.from.mockImplementation(() => createMockChain([]) as never);

    const { GET } = await import('@/app/api/admin/users/route');
    const req = new NextRequest('http://localhost:3000/api/admin/users');
    const res = await GET(req);

    expect(res.headers.get('Cache-Control')).toContain('no-store');
  });

  it('DB エラー時に500を返す', async () => {
    const errorChain = createMockChain(null, { message: 'DB connection failed' });
    mockAdmin.from.mockImplementation(() => errorChain as never);

    const { GET } = await import('@/app/api/admin/users/route');
    const req = new NextRequest('http://localhost:3000/api/admin/users');
    const res = await GET(req);

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });
});
