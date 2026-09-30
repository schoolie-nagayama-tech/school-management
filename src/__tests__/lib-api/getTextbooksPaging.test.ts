/**
 * src/lib/api/textbooks.ts の getTextbooks のテスト
 *
 * PostgREST は未ページングの .select() を1000行で静かに切り捨てる（CLAUDE.md）。
 * 教材マスタが1000件を超えても、生徒の教材追加・発注・進行表・講習エディタの
 * ピッカーから教材が警告なく欠けないことを、ページ境界の件数で確かめる。
 *   - 0件 / 999件 / 1000件ちょうど / 1001件 / 2500件 で全件・重複なく返ること
 *   - 絞り込み（有効のみ・学年区分）と並び順（id を最後の決め手にする）が各ページで同じこと
 *   - 取得失敗は握りつぶさずに投げること
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
 * DB に total 件の教材があるとみなし、.range(from, to) で指定された分だけを返すモック。
 * PostgREST と同じく、範囲が末尾を超えたら空配列を返す。
 * from() が呼ばれるたびに新しいチェーンを作り、各ページのチェーンを後で検査できるよう控える。
 */
function mockTextbooksTable(total: number) {
  const rows = Array.from({ length: total }, (_, i) => ({ id: i + 1, name: `教材${i + 1}` }));
  const chains: ReturnType<typeof createMockChain>[] = [];
  mockSupabase.from.mockImplementation(() => {
    const chain = createMockChain();
    chain.range.mockImplementation((from: number, to: number) =>
      Promise.resolve({ data: rows.slice(from, to + 1), error: null })
    );
    chains.push(chain);
    return chain;
  });
  return chains;
}

describe('getTextbooks（1000行上限対策）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    { total: 0, pages: 1 },
    { total: 999, pages: 1 },
    // 1000件ちょうどは1ページ目が満杯なので次を取りに行き、空で止まる
    { total: 1000, pages: 2 },
    { total: 1001, pages: 2 },
    { total: 2500, pages: 3 },
  ])('$total件を切り捨てず重複なく全件返す（$pages回に分けて読む）', async ({ total, pages }) => {
    const chains = mockTextbooksTable(total);

    const { getTextbooks } = await import('@/lib/api/textbooks');
    const result = await getTextbooks();

    expect(result).toHaveLength(total);
    expect(new Set(result.map((t) => t.id)).size).toBe(total);
    if (total > 0) expect(result[total - 1].id).toBe(total);

    expect(chains).toHaveLength(pages);
    chains.forEach((chain, i) => {
      expect(chain.range).toHaveBeenCalledWith(i * 1000, i * 1000 + 999);
    });
  });

  it('どのページにも同じ絞り込みと並び順を付け、id を最後の決め手にする', async () => {
    const chains = mockTextbooksTable(1001);

    const { getTextbooks } = await import('@/lib/api/textbooks');
    await getTextbooks('middle');

    expect(mockSupabase.from).toHaveBeenCalledWith('textbooks');
    for (const chain of chains) {
      expect(chain.select).toHaveBeenCalledWith('*');
      expect(chain.eq).toHaveBeenCalledWith('grade_category', 'middle');
      expect(chain.eq).toHaveBeenCalledWith('is_active', true);
      expect(chain.order.mock.calls).toEqual([
        ['school_type', { ascending: true }],
        ['name', { ascending: true }],
        ['grade', { ascending: true }],
        // ★同名・同学年の教材があるので、id が無いとページ境界で重複・取りこぼしが起きうる
        ['id', { ascending: true }],
      ]);
    }
  });

  it('includeInactive のときは有効/無効で絞らない（教材マスタ画面）', async () => {
    const chains = mockTextbooksTable(3);

    const { getTextbooks } = await import('@/lib/api/textbooks');
    await getTextbooks(undefined, { includeInactive: true });

    expect(chains[0].eq).not.toHaveBeenCalledWith('is_active', expect.anything());
    expect(chains[0].eq).not.toHaveBeenCalledWith('grade_category', expect.anything());
  });

  it('取得に失敗したら例外を投げる（途中のページでも）', async () => {
    let call = 0;
    mockSupabase.from.mockImplementation(() => {
      call++;
      const chain = createMockChain();
      chain.range.mockImplementation(() =>
        Promise.resolve(
          call === 1
            ? { data: Array.from({ length: 1000 }, (_, i) => ({ id: i + 1 })), error: null }
            : { data: null, error: { message: 'boom' } }
        )
      );
      return chain;
    });

    const { getTextbooks } = await import('@/lib/api/textbooks');
    await expect(getTextbooks()).rejects.toThrow('テキストマスタの取得に失敗しました: boom');
  });
});
