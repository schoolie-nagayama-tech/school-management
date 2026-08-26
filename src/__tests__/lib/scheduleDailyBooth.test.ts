import { describe, it, expect } from 'vitest';
import { groupBoothNoByDate } from '@/lib/api/schedule-daily-booth';

/**
 * 期間まとめ取得（getBoothNoMapForRange）の整形部分のテスト。
 * 週表示のブース番号取得を日数ぶんの N+1 から1クエリへ寄せた際の要になる関数。
 */
describe('groupBoothNoByDate', () => {
  it('日付ごとに (講師ID → ブース番号) のマップへ畳む', () => {
    const result = groupBoothNoByDate([
      { assignment_date: '2026-08-24', teacher_id: 't1', booth_no: 1 },
      { assignment_date: '2026-08-24', teacher_id: 't2', booth_no: 2 },
      { assignment_date: '2026-08-25', teacher_id: 't1', booth_no: 3 },
    ]);

    expect(result.size).toBe(2);
    expect(result.get('2026-08-24')?.get('t1')).toBe(1);
    expect(result.get('2026-08-24')?.get('t2')).toBe(2);
    expect(result.get('2026-08-25')?.get('t1')).toBe(3);
    // 割当の無い講師・日付は Map に現れない（呼び出し側は undefined で「番号なし」を判定する）
    expect(result.get('2026-08-25')?.get('t2')).toBeUndefined();
    expect(result.get('2026-08-26')).toBeUndefined();
  });

  it('0件なら空のマップを返す', () => {
    expect(groupBoothNoByDate([]).size).toBe(0);
  });
});
