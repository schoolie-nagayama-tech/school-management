import { getFifthWeekDays, getFifthWeekDayLabels, calcFifthWeekSlots } from '@/lib/utils/fifthWeek';

describe('getFifthWeekDays', () => {
  it('2026年5月は金曜(5)と土曜(6)が5回', () => {
    // 2026-05: 31日、5/1=金
    const result = getFifthWeekDays(2026, 5);
    expect(result).toContain(5); // 金
    expect(result).toContain(6); // 土
  });

  it('2026年2月は5回ある曜日がない（28日）', () => {
    const result = getFifthWeekDays(2026, 2);
    expect(result).toEqual([]);
  });

  it('31日の月は少なくとも1つの曜日が5回出現する', () => {
    // 2026年1月: 31日
    const result = getFifthWeekDays(2026, 1);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it('30日の月では曜日は最大2つが5回', () => {
    // 2026年4月: 30日
    const result = getFifthWeekDays(2026, 4);
    expect(result.length).toBeLessThanOrEqual(2);
  });
});

describe('getFifthWeekDayLabels', () => {
  it('日本語の曜日ラベルを返す', () => {
    const label = getFifthWeekDayLabels(2026, 5);
    expect(label).toContain('金');
  });

  it('5回ある曜日がない月は空文字を返す', () => {
    const label = getFifthWeekDayLabels(2026, 2);
    expect(label).toBe('');
  });
});

describe('calcFifthWeekSlots', () => {
  it('5週目曜日に該当するアクティブパターンのコマ数を計算', () => {
    const patterns = [
      { student_id: 's1', day_of_week: 5, is_active: true },
      { student_id: 's1', day_of_week: 3, is_active: true },
      { student_id: 's2', day_of_week: 5, is_active: true },
    ];
    const fifthWeekDows = [5]; // 金曜

    const result = calcFifthWeekSlots(patterns, fifthWeekDows);
    expect(result.get('s1')).toBe(1);
    expect(result.get('s2')).toBe(1);
  });

  it('非アクティブパターンは無視される', () => {
    const patterns = [
      { student_id: 's1', day_of_week: 5, is_active: false },
    ];
    const result = calcFifthWeekSlots(patterns, [5]);
    expect(result.get('s1')).toBeUndefined();
  });

  it('該当曜日がない場合は空のMapを返す', () => {
    const patterns = [
      { student_id: 's1', day_of_week: 1, is_active: true },
    ];
    const result = calcFifthWeekSlots(patterns, [5]);
    expect(result.size).toBe(0);
  });

  it('同一生徒の複数コマがカウントされる', () => {
    const patterns = [
      { student_id: 's1', day_of_week: 5, is_active: true },
      { student_id: 's1', day_of_week: 5, is_active: true },
    ];
    const result = calcFifthWeekSlots(patterns, [5]);
    expect(result.get('s1')).toBe(2);
  });
});
