/**
 * APIルートテスト: /api/invite/complete (POST)
 *
 * スタッフ招待の受諾でアカウントをサーバー側（service role）で作る流れ。
 * 固定したいこと:
 *   - ブラウザの signUp に頼らず auth.admin.createUser で作る（新規登録 OFF でも動く）
 *   - 招待者より上のロールの招待は受諾させない（権限昇格の防止）
 *   - 招待の確保は条件付き UPDATE で1回だけ（二重使用の防止）
 *   - 既存アカウントのパスワードやロールを書き換えない（409 で止める）
 *   - 途中で失敗したら作ったアカウントを消し、招待を再利用できる状態に戻す
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Call = {
  table: string;
  op: 'select' | 'update' | 'insert' | 'delete';
  payload?: unknown;
  filters: Array<[string, ...unknown[]]>;
};
type Resolver = (call: Call) => { data: unknown; error: unknown };

const state: { calls: Call[]; resolver: Resolver } = {
  calls: [],
  resolver: () => ({ data: null, error: null }),
};

function makeChain(table: string) {
  const call: Call = { table, op: 'select', filters: [] };
  const chain: Record<string, unknown> = {};
  const settle = () => {
    state.calls.push(call);
    return state.resolver(call);
  };
  chain.select = vi.fn(() => chain);
  for (const op of ['update', 'insert', 'delete'] as const) {
    chain[op] = vi.fn((payload?: unknown) => {
      call.op = op;
      call.payload = payload;
      return chain;
    });
  }
  for (const m of ['eq', 'is', 'gt', 'in', 'limit']) {
    chain[m] = vi.fn((...args: unknown[]) => {
      call.filters.push([m, ...args]);
      return chain;
    });
  }
  chain.maybeSingle = vi.fn(async () => settle());
  chain.single = vi.fn(async () => settle());
  chain.then = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
    try {
      resolve(settle());
    } catch (e) {
      reject?.(e);
    }
  };
  return chain;
}

const mockAdmin = {
  from: vi.fn((table: string) => makeChain(table)),
  auth: {
    admin: {
      createUser: vi.fn(),
      deleteUser: vi.fn().mockResolvedValue({ error: null }),
    },
  },
};

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => mockAdmin),
}));
vi.mock('@/lib/audit-log', () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/api-error', () => ({ captureApiError: vi.fn() }));

const FUTURE = new Date(Date.now() + 86400_000).toISOString();

const baseInvitation = {
  id: 'inv-1',
  email: 'new@example.com',
  role: 'teacher',
  school_ids: ['s1'],
  invited_by: 'inviter-1',
  expires_at: FUTURE,
  accepted_at: null,
};

/** 既定のシナリオ: 教室長が担当教室へ講師を招待。確保成功・作成成功。 */
function defaultResolver(overrides: Partial<Record<string, Resolver>> = {}): Resolver {
  return (call) => {
    const key = `${call.table}:${call.op}`;
    if (overrides[key]) return overrides[key]!(call);
    switch (key) {
      case 'user_invitations:select':
        return { data: baseInvitation, error: null };
      case 'user_profiles:select':
        return { data: { id: 'inviter-1', role: 'manager', is_active: true }, error: null };
      case 'user_schools:select':
        return { data: [{ school_id: 's1' }], error: null };
      case 'user_invitations:update': {
        const payload = call.payload as { accepted_at: string | null };
        // 確保（accepted_at を埋める）は1行更新、解放は data を見ない
        return payload.accepted_at
          ? { data: [{ id: 'inv-1' }], error: null }
          : { data: null, error: null };
      }
      default:
        return { data: null, error: null };
    }
  };
}

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost:3000/api/invite/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const validBody = { token: 'tok', password: 'password123', displayName: '山田 太郎' };

function claimCalls() {
  return state.calls.filter(
    (c) =>
      c.table === 'user_invitations' &&
      c.op === 'update' &&
      (c.payload as { accepted_at: string | null }).accepted_at !== null
  );
}
function releaseCalls() {
  return state.calls.filter(
    (c) =>
      c.table === 'user_invitations' &&
      c.op === 'update' &&
      (c.payload as { accepted_at: string | null }).accepted_at === null
  );
}

describe('POST /api/invite/complete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.calls = [];
    state.resolver = defaultResolver();
    mockAdmin.auth.admin.createUser.mockResolvedValue({
      data: { user: { id: 'new-user-id', email: 'new@example.com' } },
      error: null,
    });
    mockAdmin.auth.admin.deleteUser.mockResolvedValue({ error: null });
  });

  it('招待を検証し、service role でアカウント・プロフィール・教室紐付けを作る', async () => {
    const { POST } = await import('@/app/api/invite/complete/route');
    const res = await POST(makeRequest(validBody));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, email: 'new@example.com' });
    expect(mockAdmin.auth.admin.createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'new@example.com',
        password: 'password123',
        email_confirm: true,
      })
    );

    // 確保は accepted_at IS NULL を条件にした UPDATE
    const [claim] = claimCalls();
    expect(claim.filters).toContainEqual(['is', 'accepted_at', null]);

    const profileInsert = state.calls.find((c) => c.table === 'user_profiles' && c.op === 'insert');
    expect(profileInsert?.payload).toMatchObject({
      id: 'new-user-id',
      role: 'teacher',
      display_name: '山田 太郎',
      invited_by: 'inviter-1',
    });
    const schoolInsert = state.calls.find((c) => c.table === 'user_schools' && c.op === 'insert');
    expect(schoolInsert?.payload).toEqual([{ user_id: 'new-user-id', school_id: 's1' }]);
    expect(releaseCalls()).toHaveLength(0);
  });

  it('旧形式（userId だけ送る・パスワード無し）は 400', async () => {
    const { POST } = await import('@/app/api/invite/complete/route');
    const res = await POST(makeRequest({ token: 'tok', userId: 'someone' }));
    expect(res.status).toBe(400);
    expect(mockAdmin.auth.admin.createUser).not.toHaveBeenCalled();
  });

  it('8文字未満のパスワードは 400（招待を確保しない）', async () => {
    const { POST } = await import('@/app/api/invite/complete/route');
    const res = await POST(makeRequest({ ...validBody, password: 'short' }));
    expect(res.status).toBe(400);
    expect(claimCalls()).toHaveLength(0);
    expect(mockAdmin.auth.admin.createUser).not.toHaveBeenCalled();
  });

  it('期限切れの招待は 400', async () => {
    state.resolver = defaultResolver({
      'user_invitations:select': () => ({
        data: { ...baseInvitation, expires_at: new Date(Date.now() - 1000).toISOString() },
        error: null,
      }),
    });
    const { POST } = await import('@/app/api/invite/complete/route');
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(400);
    expect(mockAdmin.auth.admin.createUser).not.toHaveBeenCalled();
  });

  // 権限昇格の防止: 教室長が PostgREST で直接 role='admin' の招待を作っても受諾できない
  it('招待者（教室長）と同等以上のロールの招待は 403（確保もしない）', async () => {
    state.resolver = defaultResolver({
      'user_invitations:select': () => ({
        data: { ...baseInvitation, role: 'admin' },
        error: null,
      }),
    });
    const { POST } = await import('@/app/api/invite/complete/route');
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(403);
    expect(claimCalls()).toHaveLength(0);
    expect(mockAdmin.auth.admin.createUser).not.toHaveBeenCalled();
  });

  it('確保の UPDATE が0件（同時に別のリクエストが使った）なら 409', async () => {
    state.resolver = defaultResolver({
      'user_invitations:update': () => ({ data: [], error: null }),
    });
    const { POST } = await import('@/app/api/invite/complete/route');
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(409);
    expect(mockAdmin.auth.admin.createUser).not.toHaveBeenCalled();
  });

  it('既に登録済みのメールは 409。既存アカウントに触らず、招待の確保を戻す', async () => {
    mockAdmin.auth.admin.createUser.mockResolvedValue({
      data: { user: null },
      error: {
        code: 'email_exists',
        message: 'A user with this email address has already been registered',
      },
    });
    const { POST } = await import('@/app/api/invite/complete/route');
    const res = await POST(makeRequest(validBody));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.code).toBe('email_exists');
    expect(state.calls.some((c) => c.table === 'user_profiles' && c.op !== 'select')).toBe(false);
    expect(mockAdmin.auth.admin.deleteUser).not.toHaveBeenCalled();
    expect(releaseCalls()).toHaveLength(1);
  });

  it('プロフィール作成に失敗したら作ったアカウントを消し、招待の確保を戻す', async () => {
    state.resolver = defaultResolver({
      'user_profiles:insert': () => ({ data: null, error: { message: 'boom' } }),
    });
    const { POST } = await import('@/app/api/invite/complete/route');
    const res = await POST(makeRequest(validBody));

    expect(res.status).toBe(500);
    expect(mockAdmin.auth.admin.deleteUser).toHaveBeenCalledWith('new-user-id');
    expect(releaseCalls()).toHaveLength(1);
    // 解放は自分が書いた accepted_at のときだけ（他の処理の確保を消さない）
    expect(releaseCalls()[0].filters.some((f) => f[0] === 'eq' && f[1] === 'accepted_at')).toBe(
      true
    );
  });
});
