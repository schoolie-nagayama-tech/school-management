import { vi } from 'vitest';

/**
 * Supabaseクライアントのモックファクトリ
 *
 * 使い方:
 *   vi.mock('@/lib/supabase', () => {
 *     const { createMockSupabaseClient } = await import('../helpers/mockSupabase');
 *     const mock = createMockSupabaseClient();
 *     return { supabase: mock, getSupabaseBrowserClient: () => mock, createSupabaseBrowserClient: () => mock };
 *   });
 */
export function createMockSupabaseClient(resolvedData: unknown = null, resolvedError: unknown = null) {
  const mockChain: Record<string, ReturnType<typeof vi.fn>> = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    like: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    range: vi.fn().mockReturnThis(),
    filter: vi.fn().mockReturnThis(),
    match: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: resolvedData, error: resolvedError }),
    maybeSingle: vi.fn().mockResolvedValue({ data: resolvedData, error: resolvedError }),
  };

  // チェーンの末尾で await した場合の解決値
  const thenHandler = vi.fn((resolve: (value: unknown) => void) =>
    resolve({ data: resolvedData, error: resolvedError })
  );
  Object.defineProperty(mockChain, 'then', {
    get: () => thenHandler,
    configurable: true,
  });

  return {
    from: vi.fn(() => mockChain),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      signInWithPassword: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
    _chain: mockChain,
  };
}
