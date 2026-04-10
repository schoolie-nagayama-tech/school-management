import { vi } from 'vitest';

/**
 * API認証ガードのモックヘルパー
 *
 * 使い方:
 *   vi.mock('@/lib/api-auth', () => import('../helpers/mockAuth').then(m => m.defaultAuthMocks));
 *
 * テスト内でオーバーライド:
 *   const { requireAdmin } = await import('@/lib/api-auth');
 *   vi.mocked(requireAdmin).mockResolvedValueOnce(
 *     NextResponse.json({ error: '認証が必要です' }, { status: 401 })
 *   );
 */

export const defaultAuthMocks = {
  getApiAuth: vi.fn().mockResolvedValue({
    auth: { userId: 'test-user-id', role: 'admin', schoolIds: ['test-school-id'] },
    cookieResponse: { cookies: { getAll: () => [] } },
  }),
  requireAdmin: vi.fn().mockResolvedValue(null),
  requireManager: vi.fn().mockResolvedValue(null),
  isUserInScope: vi.fn().mockResolvedValue(true),
  isSchoolInScope: vi.fn().mockReturnValue(true),
};
