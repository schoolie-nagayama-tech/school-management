/**
 * getSeasonalCourses のテスト
 *
 * N+1解消後の動作を検証:
 *   - 講習一覧と申込件数を 2 クエリで取得していること（コース数Nに対し N+1 ではない）
 *   - 各コースに application_count が正しくマッピングされていること
 *   - 申込が0件のコースは 0 が入ること
 *   - 申込取得エラー時もメイン処理を継続し application_count=0 で返ること
 *   - コース0件のとき早期returnすること（不要な申込クエリを発行しない）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockChain } from '../api-routes/helpers';

const mockSupabase = { from: vi.fn() };

vi.mock('@/lib/supabase', () => ({
  supabase: mockSupabase,
  getSupabaseBrowserClient: () => mockSupabase,
  createSupabaseBrowserClient: () => mockSupabase,
}));

describe('getSeasonalCourses (N+1解消後)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('コースと申込を 2 クエリで取得し application_count を正しく集計する', async () => {
    const courses = [
      { id: 'c1', school_id: 's1', name: '春期講習', is_active: true },
      { id: 'c2', school_id: 's1', name: '夏期講習', is_active: true },
      { id: 'c3', school_id: 's1', name: '冬期講習', is_active: true },
    ];
    // c1: 3件, c2: 1件, c3: 0件
    const applications = [
      { course_id: 'c1' },
      { course_id: 'c1' },
      { course_id: 'c1' },
      { course_id: 'c2' },
    ];

    let callCount = 0;
    mockSupabase.from.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // seasonal_courses クエリ
        return createMockChain(courses);
      }
      // seasonal_course_applications クエリ
      return createMockChain(applications);
    });

    const { getSeasonalCourses } = await import('@/lib/api/seasonalCourses');
    const result = await getSeasonalCourses('s1');

    // 2クエリのみ（N+1ではない）
    expect(mockSupabase.from).toHaveBeenCalledTimes(2);
    expect(mockSupabase.from).toHaveBeenNthCalledWith(1, 'seasonal_courses');
    expect(mockSupabase.from).toHaveBeenNthCalledWith(2, 'seasonal_course_applications');

    // 集計結果の検証
    expect(result).toHaveLength(3);
    expect(result.find((c) => c.id === 'c1')?.application_count).toBe(3);
    expect(result.find((c) => c.id === 'c2')?.application_count).toBe(1);
    expect(result.find((c) => c.id === 'c3')?.application_count).toBe(0);
  });

  it('コース0件のとき申込クエリを発行しない（早期return）', async () => {
    mockSupabase.from.mockImplementation(() => createMockChain([]));

    const { getSeasonalCourses } = await import('@/lib/api/seasonalCourses');
    const result = await getSeasonalCourses('s1');

    // seasonal_courses の1クエリのみ
    expect(mockSupabase.from).toHaveBeenCalledTimes(1);
    expect(mockSupabase.from).toHaveBeenCalledWith('seasonal_courses');
    expect(result).toEqual([]);
  });

  it('申込取得エラー時もメイン処理を継続し application_count=0 を返す', async () => {
    const courses = [{ id: 'c1', school_id: 's1', name: '春期講習', is_active: true }];

    let callCount = 0;
    mockSupabase.from.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return createMockChain(courses);
      // 申込取得でエラー
      return createMockChain(null, { message: 'permission denied' });
    });

    // console.warn は抑制
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { getSeasonalCourses } = await import('@/lib/api/seasonalCourses');
    const result = await getSeasonalCourses('s1');

    expect(result).toHaveLength(1);
    expect(result[0].application_count).toBe(0);
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('埋め込み集計から curriculum_count を取り出す（未設定の判定に使う）', async () => {
    // PostgREST は curriculum: [{ count: n }] の形で返す。0件でも [{count:0}] が入る。
    const courses = [
      { id: 'c1', school_id: 's1', name: '単元あり', curriculum: [{ count: 25 }] },
      { id: 'c2', school_id: 's1', name: '単元なし', curriculum: [{ count: 0 }] },
      { id: 'c3', school_id: 's1', name: '形が想定外', curriculum: [] },
      { id: 'c4', school_id: 's1', name: 'キー自体が無い' },
    ];

    let callCount = 0;
    mockSupabase.from.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return createMockChain(courses);
      return createMockChain([]);
    });

    const { getSeasonalCourses } = await import('@/lib/api/seasonalCourses');
    const result = await getSeasonalCourses('s1');

    expect(result.find((c) => c.id === 'c1')?.curriculum_count).toBe(25);
    expect(result.find((c) => c.id === 'c2')?.curriculum_count).toBe(0);
    // 形が想定外でも一覧を壊さず 0 として扱う（展開ガードは安全側に倒れる）
    expect(result.find((c) => c.id === 'c3')?.curriculum_count).toBe(0);
    expect(result.find((c) => c.id === 'c4')?.curriculum_count).toBe(0);

    // 単元行そのものは一覧に持ち込まない（重い結合を外した確認）
    expect(result[0]).not.toHaveProperty('curriculum');
  });

  it('講習一覧の取得エラーは throw する', async () => {
    mockSupabase.from.mockImplementation(() => createMockChain(null, { message: 'DB error' }));

    const { getSeasonalCourses } = await import('@/lib/api/seasonalCourses');
    await expect(getSeasonalCourses('s1')).rejects.toBeDefined();
  });
});
