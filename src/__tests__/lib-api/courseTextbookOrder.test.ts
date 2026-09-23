/**
 * 講習テンプレのテキストの並び（1冊目・2冊目…）。
 *
 * ★テンプレの読み出しは PostgREST の埋め込みで、テキストの順番が保証されない。
 *   テンプレから提案書を作るときの1冊目・2冊目はこの並びで決まるので、
 *   sort_order 順に並べ直すこと・保存で全冊を0から振り直すことを固定する。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockChain } from '../api-routes/helpers';

const mockSupabase = { from: vi.fn() };

vi.mock('@/lib/supabase', () => ({
  supabase: mockSupabase,
  getSupabaseBrowserClient: () => mockSupabase,
  createSupabaseBrowserClient: () => mockSupabase,
}));

describe('sortCourseTextbooks', () => {
  it('sort_order 順に並べ、同じ番号は登録した順で決める', async () => {
    const { sortCourseTextbooks } = await import('@/lib/api/seasonalCourses');
    const out = sortCourseTextbooks([
      { id: 'kakomon', sort_order: 2, created_at: '2026-09-02T00:00:00Z' },
      { id: 'goal', sort_order: 0, created_at: '2026-09-03T00:00:00Z' },
      { id: 'hissho', sort_order: 2, created_at: '2026-09-01T00:00:00Z' },
    ]);
    expect(out.map((t) => t.id)).toEqual(['goal', 'hissho', 'kakomon']);
  });
});

describe('updateCourseTextbookOrder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('渡した並びで sort_order を0から振り直す', async () => {
    const chain = createMockChain(null);
    mockSupabase.from.mockReturnValue(chain);

    const { updateCourseTextbookOrder } = await import('@/lib/api/seasonalCourses');
    await updateCourseTextbookOrder('course-1', [30, 10, 20]);

    expect(chain.update).toHaveBeenNthCalledWith(1, { sort_order: 0 });
    expect(chain.update).toHaveBeenNthCalledWith(2, { sort_order: 1 });
    expect(chain.update).toHaveBeenNthCalledWith(3, { sort_order: 2 });
    expect(chain.eq).toHaveBeenCalledWith('textbook_id', 30);
  });
});
