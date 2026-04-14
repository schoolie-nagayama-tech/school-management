/**
 * APIルートテスト共通ヘルパー
 * Supabaseクライアントと認証ガードのモック設定を提供する
 */
import { vi } from 'vitest';
import { NextResponse } from 'next/server';

// ── Supabase createClient モック ──

/**
 * チェーンメソッドを全てモックしたSupabase風オブジェクトを生成
 */
export function createMockChain(resolvedData: unknown = null, resolvedError: unknown = null) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    range: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: resolvedData, error: resolvedError }),
    maybeSingle: vi.fn().mockResolvedValue({ data: resolvedData, error: resolvedError }),
  };

  // await 時の解決値
  Object.defineProperty(chain, 'then', {
    get: () => vi.fn((resolve: (v: unknown) => void) => resolve({ data: resolvedData, error: resolvedError })),
    configurable: true,
  });

  return chain;
}

export function createMockSupabaseAdmin(chain?: ReturnType<typeof createMockChain>) {
  const mockChain = chain ?? createMockChain([]);
  return {
    from: vi.fn(() => mockChain),
    auth: {
      admin: {
        createUser: vi.fn().mockResolvedValue({ data: { user: { id: 'new-user-id', email: 'test@example.com' } }, error: null }),
        deleteUser: vi.fn().mockResolvedValue({ error: null }),
      },
    },
    functions: {
      invoke: vi.fn().mockResolvedValue({ data: null, error: null }),
    },
    _chain: mockChain,
  };
}

// ── 認証モック ──

/** 認証成功（admin権限）のモック設定を返す */
export function authSuccessMocks(overrides?: { role?: string; userId?: string; schoolIds?: string[] }) {
  const role = overrides?.role ?? 'admin';
  const userId = overrides?.userId ?? 'test-user-id';
  const schoolIds = overrides?.schoolIds ?? ['test-school-id'];
  return {
    requireManager: vi.fn().mockResolvedValue(null),
    requireAdmin: vi.fn().mockResolvedValue(null),
    getApiAuth: vi.fn().mockResolvedValue({
      auth: { userId, role, schoolIds },
      cookieResponse: NextResponse.next(),
    }),
    isUserInScope: vi.fn().mockResolvedValue(true),
    isSchoolInScope: vi.fn().mockReturnValue(true),
  };
}

/** 認証失敗（未認証 401）のモック設定を返す */
export function authFailMocks() {
  return {
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
  };
}
