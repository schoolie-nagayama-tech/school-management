/**
 * getBulletinPosts のテスト（クエリ並列化の検証）
 *
 * 検証内容:
 *   - userId なし → 投稿取得の1クエリのみ
 *   - userId あり・投稿0件 → 投稿取得の1クエリのみ（早期return）
 *   - userId あり・投稿あり → 投稿→[自分の既読+講師ID並列]→講師既読数 の3クエリ
 *   - 並列化されている第2段の2クエリが同時に発行されること
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockChain } from '../api-routes/helpers';

const mockSupabase = { from: vi.fn() };

vi.mock('@/lib/supabase', () => ({
  supabase: mockSupabase,
  getSupabaseBrowserClient: () => mockSupabase,
  createSupabaseBrowserClient: () => mockSupabase,
}));

describe('getBulletinPosts (並列化後)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('userId なしの場合は投稿取得の1クエリのみ', async () => {
    const posts = [
      { id: 'p1', label: null, creator: null },
      { id: 'p2', label: null, creator: null },
    ];

    mockSupabase.from.mockImplementation(() => createMockChain(posts));

    const { getBulletinPosts } = await import('@/lib/api/bulletin');
    const result = await getBulletinPosts('s1');

    expect(mockSupabase.from).toHaveBeenCalledTimes(1);
    expect(mockSupabase.from).toHaveBeenCalledWith('bulletin_posts');
    expect(result).toHaveLength(2);
    expect(result[0].is_read).toBe(false);
    expect(result[0].read_count).toBe(0);
  });

  it('userId ありで投稿0件のとき投稿取得のみで早期return', async () => {
    mockSupabase.from.mockImplementation(() => createMockChain([]));

    const { getBulletinPosts } = await import('@/lib/api/bulletin');
    const result = await getBulletinPosts('s1', { userId: 'u1' });

    expect(mockSupabase.from).toHaveBeenCalledTimes(1);
    expect(result).toEqual([]);
  });

  it('userId あり・投稿ありの場合は 3 クエリで完了 (4→3 削減後)', async () => {
    const posts = [
      { id: 'p1', label: null, creator: null },
      { id: 'p2', label: null, creator: null },
    ];
    const myReads = [{ post_id: 'p1' }];
    const teachers = [{ id: 't1' }, { id: 't2' }];
    const allReads = [{ post_id: 'p1' }, { post_id: 'p1' }, { post_id: 'p2' }];

    let callCount = 0;
    mockSupabase.from.mockImplementation((table: string) => {
      callCount++;
      if (callCount === 1) {
        // bulletin_posts
        expect(table).toBe('bulletin_posts');
        return createMockChain(posts);
      }
      if (callCount === 2 || callCount === 3) {
        // 並列実行される 2 クエリ（順序保証なし）: bulletin_reads (my) or user_profiles
        if (table === 'bulletin_reads') return createMockChain(myReads);
        if (table === 'user_profiles') return createMockChain(teachers);
      }
      // 4回目: bulletin_reads (講師既読数)
      expect(table).toBe('bulletin_reads');
      return createMockChain(allReads);
    });

    const { getBulletinPosts } = await import('@/lib/api/bulletin');
    const result = await getBulletinPosts('s1', { userId: 'u1' });

    // 合計4回 from() が呼ばれる
    // - 投稿取得 (1)
    // - 自分の既読 + 講師ID取得 (2,3 並列)
    // - 講師既読数 (4)
    expect(mockSupabase.from).toHaveBeenCalledTimes(4);

    expect(result).toHaveLength(2);
    expect(result.find((p) => p.id === 'p1')?.is_read).toBe(true);
    expect(result.find((p) => p.id === 'p2')?.is_read).toBe(false);
    expect(result.find((p) => p.id === 'p1')?.read_count).toBe(2);
    expect(result.find((p) => p.id === 'p2')?.read_count).toBe(1);
  });

  it('2段目の bulletin_reads と user_profiles が講師既読数の取得より前に発行される', async () => {
    const posts = [{ id: 'p1', label: null, creator: null }];

    // 呼び出し順を記録（並列クエリは順序保証なしだが、3つ目は必ず最後）
    const callOrder: string[] = [];
    let callCount = 0;

    mockSupabase.from.mockImplementation((table: string) => {
      callCount++;
      callOrder.push(table);
      if (callCount === 1) return createMockChain(posts);
      if (callCount === 2 || callCount === 3) {
        return createMockChain(table === 'user_profiles' ? [{ id: 't1' }] : []);
      }
      return createMockChain([]);
    });

    const { getBulletinPosts } = await import('@/lib/api/bulletin');
    await getBulletinPosts('s1', { userId: 'u1' });

    // 1番目: 投稿取得
    expect(callOrder[0]).toBe('bulletin_posts');
    // 2,3番目: 自分の既読 (bulletin_reads) と 講師ID (user_profiles) を並列取得
    expect(new Set([callOrder[1], callOrder[2]])).toEqual(
      new Set(['bulletin_reads', 'user_profiles'])
    );
    // 4番目: 講師既読数 (bulletin_reads) — teacherIds に依存するため最後
    expect(callOrder[3]).toBe('bulletin_reads');
  });
});
