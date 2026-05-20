/**
 * APIルートテスト共通ヘルパー
 *
 * Supabase クライアントと認証ガード（api-auth.ts）のモック設定を提供する。
 * テストファイルでは vi.mock('@supabase/supabase-js') で createClient を差し替え、
 * vi.mock('@/lib/api-auth') で認証ガードを差し替える。
 *
 * 使い方:
 *   const mockAdmin = createMockSupabaseAdmin();
 *   vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => mockAdmin) }));
 *   vi.mock('@/lib/api-auth', () => authSuccessMocks());
 */
import { vi } from 'vitest';
import { NextResponse } from 'next/server';

// ── Supabase createClient モック ──

/**
 * Supabase のクエリビルダーチェーン (.from().select().eq().single() 等) をモックする。
 * resolvedData / resolvedError は .single(), .maybeSingle(), await 時の返り値になる。
 *
 * 複数クエリの応答を切り替えるには、テスト側で mockAdmin.from.mockImplementation() を
 * 使い、呼び出し回数に応じて異なる createMockChain を返す。
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

/**
 * service role key で作成する管理者用 Supabase クライアントのモック。
 * from(), auth.admin (createUser/deleteUser), functions.invoke を提供する。
 *
 * 注意: auth.getUser や auth.admin.generateLink が必要な場合（impersonate 等）は
 * このヘルパーでは足りないため、テスト側でカスタムモックを作成すること。
 */
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

// ── 認証モック（src/lib/api-auth.ts の各関数をモックする） ──

/**
 * 認証成功のモック設定を返す。
 * デフォルトは admin ロール。overrides で role / userId / schoolIds を変更可能。
 *
 * requireManager / requireAdmin → null（通過）
 * getApiAuth → { userId, role, schoolIds } を返す
 * isUserInScope → true（対象ユーザーはスコープ内）
 */
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

/**
 * 認証失敗（未認証 401）のモック設定を返す。
 * requireManager / requireAdmin → 401 レスポンスを返す
 * isUserInScope / isSchoolInScope → false
 */
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
