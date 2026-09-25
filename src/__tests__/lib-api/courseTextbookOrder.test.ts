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

describe('planApplyProposals（テンプレを生徒にまとめて登録）', () => {
  // ★以前は upsert でテーマ・状態を上書きし、2つ目のテンプレ登録で公開済みの過去問の提案書が
  //   下書きに戻っていた。既存は上書きせず、公開済みには足さないことを固定する
  it('無ければ作る・下書き/提案済は既存に足す・公開済みは飛ばす', async () => {
    const { planApplyProposals } = await import('@/lib/api/seasonalCourses');
    const plan = planApplyProposals(
      [
        { studentId: 's1', textbookId: 1 },
        { studentId: 's1', textbookId: 99 },
        { studentId: 's2', textbookId: 99 },
        { studentId: 's3', textbookId: 99 },
      ],
      [
        { id: 'p-s1-99', student_id: 's1', textbook_id: 99, status: 'draft' },
        { id: 'p-s2-99', student_id: 's2', textbook_id: 99, status: 'sent' },
        { id: 'p-s3-99', student_id: 's3', textbook_id: 99, status: 'approved' },
      ]
    );
    expect(plan.toCreate).toEqual([{ studentId: 's1', textbookId: 1 }]);
    expect(Array.from(plan.reuse.entries())).toEqual([
      ['s1:99', 'p-s1-99'],
      ['s2:99', 'p-s2-99'],
    ]);
    expect(plan.skippedPublished).toEqual([{ studentId: 's3', textbookId: 99 }]);
  });
});
