/**
 * src/lib/api/ordering.ts の fetchOwnedSet のテスト
 *
 * 発注候補の抽出と二重発注チェックが共用する「生徒×テキストの所持集合」。
 * 行数は生徒数×教材数で増えるため、PostgREST の1000行上限で静かに切れると、
 * 所持済みの教材が未所持に見えて発注候補・二重発注警告が狂う。
 *   - 1チャンク内で 0件 / 1000件ちょうど / 1001件 を切り捨てずに全件集めること
 *   - 生徒IDは300件ずつに分けて .in() すること（URL長対策）
 *   - 各ページに is_owned・並び順（id）・range が付くこと
 *   - 取得に失敗しても例外にせず、空の集合で続けること（従来どおり）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockChain } from '../api-routes/helpers';

const mockSupabase = { from: vi.fn() };

vi.mock('@/lib/supabase', () => ({
  supabase: mockSupabase,
  getSupabaseBrowserClient: () => mockSupabase,
  createSupabaseBrowserClient: () => mockSupabase,
}));

/**
 * 1回の .in() あたり perChunk 件の所持行がある、とみなすモック。
 * .range(from, to) で指定された分だけを返し、末尾を超えたら空配列を返す。
 */
function mockOwnedTable(perChunk: number) {
  const chains: ReturnType<typeof createMockChain>[] = [];
  mockSupabase.from.mockImplementation(() => {
    const chain = createMockChain();
    let chunk: string[] = [];
    chain.in.mockImplementation((col: string, ids: string[]) => {
      if (col === 'student_id') chunk = ids;
      return chain;
    });
    chain.range.mockImplementation((from: number, to: number) => {
      const rows = Array.from({ length: perChunk }, (_, i) => ({
        student_id: chunk[0],
        textbook_id: i + 1,
      }));
      return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
    });
    chains.push(chain);
    return chain;
  });
  return chains;
}

describe('fetchOwnedSet（1000行上限対策）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    { perChunk: 0, pages: 1 },
    // 1000件ちょうどは1ページ目が満杯なので次を取りに行き、空で止まる
    { perChunk: 1000, pages: 2 },
    { perChunk: 1001, pages: 2 },
  ])('$perChunk件を切り捨てず全件集める（$pages回に分けて読む）', async ({ perChunk, pages }) => {
    const chains = mockOwnedTable(perChunk);

    const { fetchOwnedSet } = await import('@/lib/api/ordering');
    const owned = await fetchOwnedSet(['s1'], [1, 2, 3]);

    expect(owned.size).toBe(perChunk);
    if (perChunk > 0) expect(owned.has(`s1:${perChunk}`)).toBe(true);
    expect(chains).toHaveLength(pages);
    chains.forEach((chain, i) => {
      expect(chain.range).toHaveBeenCalledWith(i * 1000, i * 1000 + 999);
      expect(chain.eq).toHaveBeenCalledWith('is_owned', true);
      expect(chain.in).toHaveBeenCalledWith('textbook_id', [1, 2, 3]);
      expect(chain.order).toHaveBeenCalledWith('id', { ascending: true });
    });
  });

  it('生徒IDは300件ずつに分けて読む', async () => {
    const chains = mockOwnedTable(1);
    const studentIds = Array.from({ length: 650 }, (_, i) => `s${i}`);

    const { fetchOwnedSet } = await import('@/lib/api/ordering');
    const owned = await fetchOwnedSet(studentIds, [1]);

    expect(chains).toHaveLength(3);
    expect(chains.map((c) => c.in.mock.calls[0][1].length)).toEqual([300, 300, 50]);
    expect(owned).toEqual(new Set(['s0:1', 's300:1', 's600:1']));
  });

  it('生徒かテキストが空なら問い合わせない', async () => {
    const { fetchOwnedSet } = await import('@/lib/api/ordering');
    expect((await fetchOwnedSet([], [1])).size).toBe(0);
    expect((await fetchOwnedSet(['s1'], [])).size).toBe(0);
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  it('取得に失敗しても例外にせず空の集合を返す', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockSupabase.from.mockImplementation(() => {
      const chain = createMockChain();
      chain.range.mockResolvedValue({ data: null, error: { message: 'boom' } });
      return chain;
    });

    const { fetchOwnedSet } = await import('@/lib/api/ordering');
    await expect(fetchOwnedSet(['s1'], [1])).resolves.toEqual(new Set());
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
