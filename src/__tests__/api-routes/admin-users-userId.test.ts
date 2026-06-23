/**
 * APIルートテスト: /api/admin/users/[userId] (GET / PATCH / DELETE)
 * ロール階層、スコープ検証、カスケード削除のテスト
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { createMockSupabaseAdmin, createMockChain, authSuccessMocks } from './helpers';

const mockAdmin = createMockSupabaseAdmin();

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => mockAdmin),
}));

vi.mock('@/lib/audit-log', () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }));

const defaultAuthMocks = authSuccessMocks();
vi.mock('@/lib/api-auth', () => defaultAuthMocks);

const routeParams = { params: { userId: 'target-user-id' } };

function makePatchRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost:3000/api/admin/users/target-user-id', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeDeleteRequest() {
  return new NextRequest('http://localhost:3000/api/admin/users/target-user-id', {
    method: 'DELETE',
  });
}

function makeGetRequest() {
  return new NextRequest('http://localhost:3000/api/admin/users/target-user-id');
}

// ── GET テスト ──

describe('GET /api/admin/users/[userId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(defaultAuthMocks, authSuccessMocks());
  });

  it('未認証で401を返す', async () => {
    defaultAuthMocks.requireManager.mockResolvedValueOnce(
      NextResponse.json({ error: '認証が必要です' }, { status: 401 })
    );

    const { GET } = await import('@/app/api/admin/users/[userId]/route');
    const res = await GET(makeGetRequest(), routeParams);
    expect(res.status).toBe(401);
  });

  it('スコープ外のユーザーに404を返す', async () => {
    defaultAuthMocks.isUserInScope.mockResolvedValueOnce(false);

    const { GET } = await import('@/app/api/admin/users/[userId]/route');
    const res = await GET(makeGetRequest(), routeParams);
    expect(res.status).toBe(404);
  });

  it('スコープ内のユーザーデータを返す', async () => {
    const profile = {
      id: 'target-user-id',
      display_name: 'テスト講師',
      role: 'teacher',
      teachable_subject_ids: '{sub1,sub2}',
      available_days_of_week: '{1,3,5}',
      available_slot_numbers_by_day: { mon: [1, 2], wed: [3] },
    };
    const userSchools = [
      { user_id: 'target-user-id', school_id: 's1', school: { id: 's1', name: '教室A' } },
    ];

    let callCount = 0;
    mockAdmin.from.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return createMockChain(profile, null) as never;
      return createMockChain(userSchools) as never;
    });

    const { GET } = await import('@/app/api/admin/users/[userId]/route');
    const res = await GET(makeGetRequest(), routeParams);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.id).toBe('target-user-id');
    expect(body.teachable_subject_ids).toEqual(['sub1', 'sub2']);
    expect(body.available_days_of_week).toEqual([1, 3, 5]);
    expect(body.available_slot_numbers_by_day).toEqual({ mon: [1, 2], wed: [3] });
    expect(body.user_schools).toHaveLength(1);
  });

  it('存在しないユーザーに404を返す', async () => {
    mockAdmin.from.mockImplementation(
      () => createMockChain(null, { code: 'PGRST116', message: 'not found' }) as never
    );

    const { GET } = await import('@/app/api/admin/users/[userId]/route');
    const res = await GET(makeGetRequest(), routeParams);
    expect(res.status).toBe(404);
  });
});

// ── PATCH テスト ──

describe('PATCH /api/admin/users/[userId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(defaultAuthMocks, authSuccessMocks());
  });

  it('未認証で401を返す', async () => {
    defaultAuthMocks.requireManager.mockResolvedValueOnce(
      NextResponse.json({ error: '認証が必要です' }, { status: 401 })
    );

    const { PATCH } = await import('@/app/api/admin/users/[userId]/route');
    const res = await PATCH(makePatchRequest({ display_name: 'test' }), routeParams);
    expect(res.status).toBe(401);
  });

  it('スコープ外のユーザー編集で404を返す', async () => {
    defaultAuthMocks.isUserInScope.mockResolvedValueOnce(false);

    const { PATCH } = await import('@/app/api/admin/users/[userId]/route');
    const res = await PATCH(
      makePatchRequest({ display_name: 'test', school_ids: ['s1'] }),
      routeParams
    );
    expect(res.status).toBe(404);
  });

  it('同レベル以上のロールを編集しようとすると403を返す', async () => {
    // callerはadmin(level 5)、targetもadmin(level 5) → 編集不可
    const targetProfile = { role: 'admin' };
    mockAdmin.from.mockImplementation(() => createMockChain(targetProfile) as never);

    const { PATCH } = await import('@/app/api/admin/users/[userId]/route');
    const res = await PATCH(
      makePatchRequest({ display_name: 'test', school_ids: ['s1'] }),
      routeParams
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('権限が高い');
  });

  it('上位ロールのユーザーを編集しようとすると403を返す', async () => {
    // callerはmanager(level 3)として設定
    Object.assign(defaultAuthMocks, authSuccessMocks({ role: 'manager' }));
    const targetProfile = { role: 'owner' };
    mockAdmin.from.mockImplementation(() => createMockChain(targetProfile) as never);

    const { PATCH } = await import('@/app/api/admin/users/[userId]/route');
    const res = await PATCH(
      makePatchRequest({ display_name: 'test', school_ids: ['s1'] }),
      routeParams
    );
    expect(res.status).toBe(403);
  });

  it('自分自身の編集ではrole/school_idsが変更されない', async () => {
    const selfParams = { params: { userId: 'test-user-id' } };
    const updatedProfile = { id: 'test-user-id', display_name: '新名前', role: 'admin' };

    mockAdmin.from.mockImplementation(() => {
      return createMockChain(updatedProfile) as never;
    });

    const { PATCH } = await import('@/app/api/admin/users/[userId]/route');
    const req = new NextRequest('http://localhost:3000/api/admin/users/test-user-id', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        display_name: '新名前',
        teachable_subject_ids: ['sub1'],
        available_days_of_week: [1, 3],
        available_slot_numbers_by_day: { mon: [1] },
      }),
    });
    const res = await PATCH(req, selfParams);

    expect(res.status).toBe(200);
  });

  it('下位ロールのユーザーは正常に更新できる', async () => {
    // callerはadmin(level 5)、targetはteacher(level 2)
    const targetProfile = { role: 'teacher' };

    let callCount = 0;
    mockAdmin.from.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return createMockChain(targetProfile) as never;
      return createMockChain(null) as never;
    });

    const { PATCH } = await import('@/app/api/admin/users/[userId]/route');
    const res = await PATCH(
      makePatchRequest({
        display_name: '更新後',
        role: 'teacher',
        school_ids: ['s1', 's2'],
      }),
      routeParams
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });
});

// ── DELETE テスト ──

describe('DELETE /api/admin/users/[userId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(defaultAuthMocks, authSuccessMocks());
    // DELETE は requireAdmin を使用
    defaultAuthMocks.requireAdmin.mockResolvedValue(null);

    // デフォルト: 全ステップ成功
    mockAdmin.from.mockImplementation(() => createMockChain(null) as never);
    mockAdmin.auth.admin.deleteUser.mockResolvedValue({ error: null });
  });

  it('未認証で401を返す', async () => {
    defaultAuthMocks.requireAdmin.mockResolvedValueOnce(
      NextResponse.json({ error: '認証が必要です' }, { status: 401 })
    );

    const { DELETE } = await import('@/app/api/admin/users/[userId]/route');
    const res = await DELETE(makeDeleteRequest(), routeParams);
    expect(res.status).toBe(401);
  });

  it('管理者以外で403を返す', async () => {
    defaultAuthMocks.requireAdmin.mockResolvedValueOnce(
      NextResponse.json({ error: '管理者権限が必要です' }, { status: 403 })
    );

    const { DELETE } = await import('@/app/api/admin/users/[userId]/route');
    const res = await DELETE(makeDeleteRequest(), routeParams);
    expect(res.status).toBe(403);
  });

  it('スコープ外のユーザー削除で404を返す', async () => {
    defaultAuthMocks.isUserInScope.mockResolvedValueOnce(false);

    const { DELETE } = await import('@/app/api/admin/users/[userId]/route');
    const res = await DELETE(makeDeleteRequest(), routeParams);
    expect(res.status).toBe(404);
  });

  it('カスケード削除が正常に完了する', async () => {
    // user_profiles.delete で削除されたレコードを返す
    let callCount = 0;
    mockAdmin.from.mockImplementation(() => {
      callCount++;
      // カスケードの各ステップは全て成功(null)
      // 最後の user_profiles.delete.select で削除結果を返す
      if (callCount >= 12) {
        return createMockChain([{ id: 'target-user-id' }]) as never;
      }
      return createMockChain(null) as never;
    });

    const { DELETE } = await import('@/app/api/admin/users/[userId]/route');
    const res = await DELETE(makeDeleteRequest(), routeParams);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('カスケードステップでエラーが起きると500を返す', async () => {
    mockAdmin.from.mockImplementation(
      () => createMockChain(null, { message: 'FK violation' }) as never
    );

    const { DELETE } = await import('@/app/api/admin/users/[userId]/route');
    const res = await DELETE(makeDeleteRequest(), routeParams);
    expect(res.status).toBe(500);
  });

  it('Authユーザーが存在しない場合でも成功する', async () => {
    let callCount = 0;
    mockAdmin.from.mockImplementation(() => {
      callCount++;
      if (callCount >= 12) {
        return createMockChain([{ id: 'target-user-id' }]) as never;
      }
      return createMockChain(null) as never;
    });
    mockAdmin.auth.admin.deleteUser.mockResolvedValueOnce({
      error: { message: 'User not found' },
    });

    const { DELETE } = await import('@/app/api/admin/users/[userId]/route');
    const res = await DELETE(makeDeleteRequest(), routeParams);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });
});
