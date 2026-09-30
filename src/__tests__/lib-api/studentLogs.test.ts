/**
 * src/lib/api/studentLogs.ts のテスト
 *
 * 生徒ハブ（/students/[studentId]）の「変更履歴」が読む関数。
 * 検証する振る舞い:
 *   - 生徒（student_id）で絞り、新しい順に、件数を限って取ること（教室では絞らない）
 *   - 取得失敗は握りつぶさずに投げること
 *   - 出来事の文言は通知フィードと同じで、表示する変更が無いログは落とすこと
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockChain } from '../api-routes/helpers';
import type { StudentLog } from '@/types/database';

const mockSupabase = { from: vi.fn() };

vi.mock('@/lib/supabase', () => ({
  supabase: mockSupabase,
  getSupabaseBrowserClient: () => mockSupabase,
  createSupabaseBrowserClient: () => mockSupabase,
}));

function log(partial: Partial<StudentLog>): StudentLog {
  return {
    id: 'l',
    student_id: 's1',
    school_id: 'sc1',
    action: 'updated',
    actor: null,
    diff: null,
    created_at: '2026-09-01T00:00:00Z',
    ...partial,
  };
}

describe('getStudentLogs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('生徒で絞り、新しい順に件数を限って取る（教室では絞らない）', async () => {
    const chain = createMockChain([log({ id: 'l1' })], null);
    mockSupabase.from.mockReturnValue(chain);

    const { getStudentLogs } = await import('@/lib/api/studentLogs');
    const result = await getStudentLogs('s1', 50);

    expect(mockSupabase.from).toHaveBeenCalledWith('student_logs');
    expect(chain.eq).toHaveBeenCalledWith('student_id', 's1');
    expect(chain.eq).not.toHaveBeenCalledWith('school_id', expect.anything());
    expect(chain.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(chain.limit).toHaveBeenCalledWith(50);
    expect(result.map((r) => r.id)).toEqual(['l1']);
  });

  it('件数を渡さなければ20件', async () => {
    const chain = createMockChain([], null);
    mockSupabase.from.mockReturnValue(chain);

    const { getStudentLogs } = await import('@/lib/api/studentLogs');
    await getStudentLogs('s1');
    expect(chain.limit).toHaveBeenCalledWith(20);
  });

  it('取得に失敗したら例外を投げる', async () => {
    const chain = createMockChain(null, { message: 'boom' });
    mockSupabase.from.mockReturnValue(chain);

    const { getStudentLogs } = await import('@/lib/api/studentLogs');
    await expect(getStudentLogs('s1')).rejects.toThrow('変更履歴の取得に失敗しました');
  });
});

describe('toStudentLogEvents', () => {
  it('通知フィードと同じ文言にし、表示する変更が無いログは落とし、件数で切る', async () => {
    const { toStudentLogEvents } = await import('@/lib/api/studentLogs');
    const events = toStudentLogEvents(
      [
        log({
          id: 'a',
          action: 'status_changed',
          // 自動退塾の cron は reason も入れる。reason は出来事に出さない
          diff: {
            status: { old: 'active', new: 'withdrawn' },
            reason: { withdrawal_date: '2026-08-31', today: '2026-09-01' },
          },
        }),
        // 更新日時だけ・科目だけの更新は表示する変更が無い
        log({ id: 'b', diff: { updated_at: { old: 'x', new: 'y' } } }),
        log({ id: 'c', diff: {} }),
        log({ id: 'd', diff: { grade: { old: 7, new: 8 } } }),
        log({ id: 'e', action: 'created', diff: { newValues: {} } }),
      ],
      2
    );

    expect(events.map((e) => e.id)).toEqual(['a', 'd']);
    expect(events[0].summary).toMatch(/^在籍状況: .+→.+$/);
    expect(events[1].summary).toMatch(/^学年: .+→.+$/);
  });

  it('登録・削除・復元はそのまま出す', async () => {
    const { toStudentLogEvents } = await import('@/lib/api/studentLogs');
    const events = toStudentLogEvents([
      log({ id: 'x', action: 'created' }),
      log({ id: 'y', action: 'soft_deleted' }),
      log({ id: 'z', action: 'restored' }),
    ]);
    expect(events.map((e) => e.summary)).toEqual(['新規登録', '削除', '復元']);
  });
});
