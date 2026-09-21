/**
 * src/lib/api/targetSchools.ts のテスト
 *
 * 検証する最低限の振る舞い（docs/interview-script-ai-plan.md §4）:
 *   - school_name が空の rank は削除対象になること
 *   - マスタに当たらない学校名でも保存できること（high_school_id が null のまま）
 *   - searchHighSchools が普通科の本体（course=空文字）を先に返すこと
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockChain as createMockChainBase } from '../api-routes/helpers';

const mockSupabase = { from: vi.fn() };

// api-routes/helpers.ts の createMockChain には ilike が無い（high_schools の部分一致検索で使う）。
// テスト側だけで補う。
function createMockChain(resolvedData: unknown = null, resolvedError: unknown = null) {
  const chain = createMockChainBase(resolvedData, resolvedError);
  (chain as Record<string, ReturnType<typeof vi.fn>>).ilike = vi.fn().mockReturnThis();
  return chain;
}

vi.mock('@/lib/supabase', () => ({
  supabase: mockSupabase,
  getSupabaseBrowserClient: () => mockSupabase,
  createSupabaseBrowserClient: () => mockSupabase,
}));

describe('saveStudentTargetSchools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('school_name が空（空白のみ含む）の rank は削除対象になる', async () => {
    const chain = createMockChain(null, null);
    mockSupabase.from.mockReturnValue(chain);

    const { saveStudentTargetSchools } = await import('@/lib/api/targetSchools');

    await saveStudentTargetSchools('student-1', 'school-1', [
      { rank: 1, schoolName: '清瀬', highSchoolId: 'h1', reason: '' },
      { rank: 2, schoolName: '   ', highSchoolId: null, reason: '' },
      { rank: 3, schoolName: '', highSchoolId: null, reason: '' },
    ]);

    // rank 2・3（空欄）は削除、rank 1（入力あり）だけ upsert される
    expect(chain.delete).toHaveBeenCalledTimes(1);
    expect(chain.in).toHaveBeenCalledWith('rank', [2, 3]);

    expect(chain.upsert).toHaveBeenCalledTimes(1);
    const [upsertRows, upsertOptions] = chain.upsert.mock.calls[0];
    expect(upsertRows).toHaveLength(1);
    expect(upsertRows[0]).toMatchObject({
      student_id: 'student-1',
      school_id: 'school-1',
      rank: 1,
      school_name: '清瀬',
      high_school_id: 'h1',
    });
    expect(upsertOptions).toEqual({ onConflict: 'student_id,rank' });
  });

  it('マスタに当たらない学校名でも high_school_id を null のまま保存できる', async () => {
    const chain = createMockChain(null, null);
    mockSupabase.from.mockReturnValue(chain);

    const { saveStudentTargetSchools } = await import('@/lib/api/targetSchools');

    // 私立・国立・他県はマスタ（都立のみ）に無いため、候補を選ばず自由記述のまま保存できる必要がある
    await saveStudentTargetSchools('student-1', 'school-1', [
      { rank: 3, schoolName: '錦城高校', highSchoolId: null, reason: '家から近い' },
    ]);

    expect(chain.delete).not.toHaveBeenCalled();
    expect(chain.upsert).toHaveBeenCalledTimes(1);
    const [upsertRows] = chain.upsert.mock.calls[0];
    expect(upsertRows[0]).toMatchObject({
      rank: 3,
      school_name: '錦城高校',
      high_school_id: null,
      reason: '家から近い',
    });
  });
});

describe('searchHighSchools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('普通科の本体（course=空文字）をコース付きより先に返す', async () => {
    // ★courseは普通科の本体が空文字（NULLではない）。「小平（外国語科）」より「小平」を
    //   先に出すのが面談での自然な並び。
    const schools = [
      {
        id: 'a',
        prefecture: '東京都',
        school_name: '小平',
        course: '外国語',
        category: '普通科',
        municipality: '小平市',
      },
      {
        id: 'b',
        prefecture: '東京都',
        school_name: '小平',
        course: '',
        category: '普通科',
        municipality: '小平市',
      },
    ];

    let callCount = 0;
    mockSupabase.from.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return createMockChain(schools); // high_schools
      return createMockChain([]); // high_school_standards
    });

    const { searchHighSchools } = await import('@/lib/api/targetSchools');
    const result = await searchHighSchools('小平');

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('b');
    expect(result[0].course).toBe('');
    expect(result[1].id).toBe('a');
  });

  it('空クエリでは検索を実行せず空配列を返す', async () => {
    const { searchHighSchools } = await import('@/lib/api/targetSchools');
    const result = await searchHighSchools('   ');
    expect(result).toEqual([]);
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });
});
