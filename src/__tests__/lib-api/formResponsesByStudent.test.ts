/**
 * src/lib/api/form-responses.ts の getFormResponsesByStudent のテスト
 *
 * 生徒ハブ（/students/[studentId]）の「申込状況」が読む関数。
 * 検証する振る舞い（docs/student-hub-plan.md §3・§4）:
 *   - 生徒（linked_student_id）で絞り、教室（school_id）では絞らないこと
 *   - アーカイブ済みを外し、新しい順に並べること
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

describe('getFormResponsesByStudent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('生徒で絞り、アーカイブを外して新しい順に取る（教室では絞らない）', async () => {
    const rows = [
      { id: 'r2', form_type: 'zoukoma', created_at: '2026-09-01T00:00:00Z' },
      { id: 'r1', form_type: 'moshi', created_at: '2026-06-01T00:00:00Z' },
    ];
    const chain = createMockChain(rows, null);
    mockSupabase.from.mockReturnValue(chain);

    const { getFormResponsesByStudent } = await import('@/lib/api/form-responses');
    const result = await getFormResponsesByStudent('student-1');

    expect(mockSupabase.from).toHaveBeenCalledWith('form_responses');
    expect(chain.eq).toHaveBeenCalledWith('linked_student_id', 'student-1');
    expect(chain.eq).toHaveBeenCalledWith('is_archived', false);
    expect(chain.order).toHaveBeenCalledWith('created_at', { ascending: false });
    // ★転籍した生徒の過去の申込も出すため、教室では絞らない
    expect(chain.in).not.toHaveBeenCalledWith('school_id', expect.anything());
    expect(chain.eq).not.toHaveBeenCalledWith('school_id', expect.anything());
    expect(chain.limit).toHaveBeenCalledWith(100);
    expect(result.map((r) => r.id)).toEqual(['r2', 'r1']);
  });

  it('取得に失敗したら例外を投げる', async () => {
    const chain = createMockChain(null, { message: 'boom' });
    mockSupabase.from.mockReturnValue(chain);

    const { getFormResponsesByStudent } = await import('@/lib/api/form-responses');
    await expect(getFormResponsesByStudent('student-1')).rejects.toThrow(
      '申込の履歴の取得に失敗しました'
    );
  });
});
