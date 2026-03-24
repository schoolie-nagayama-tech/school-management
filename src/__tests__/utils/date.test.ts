import { describe, it, expect } from 'vitest';
import {
  getDaysInMonth,
  getMonthDates,
  getPrevMonth,
  getNextMonth,
  formatYearMonth,
} from '@/lib/utils/date';

describe('getDaysInMonth', () => {
  it('1月は31日', () => {
    expect(getDaysInMonth('2026-01')).toBe(31);
  });

  it('2月は28日（平年）', () => {
    expect(getDaysInMonth('2025-02')).toBe(28);
  });

  it('2月は29日（うるう年）', () => {
    expect(getDaysInMonth('2024-02')).toBe(29);
  });

  it('4月は30日', () => {
    expect(getDaysInMonth('2026-04')).toBe(30);
  });

  it('12月は31日', () => {
    expect(getDaysInMonth('2026-12')).toBe(31);
  });

  it('6月は30日', () => {
    expect(getDaysInMonth('2026-06')).toBe(30);
  });

  it('9月は30日', () => {
    expect(getDaysInMonth('2026-09')).toBe(30);
  });
});

describe('getMonthDates', () => {
  it('指定月の全日付を返す', () => {
    const dates = getMonthDates('2026-03');
    expect(dates.length).toBe(31); // 3月は31日
  });

  it('日付文字列がYYYY-MM-DD形式である', () => {
    const dates = getMonthDates('2026-03');
    expect(dates[0].date).toBe('2026-03-01');
    expect(dates[30].date).toBe('2026-03-31');
  });

  it('曜日ラベルが正しい（日〜土）', () => {
    const dates = getMonthDates('2026-03');
    const validLabels = ['日', '月', '火', '水', '木', '金', '土'];
    for (const d of dates) {
      expect(validLabels).toContain(d.dayLabel);
    }
  });

  it('dayOfWeek が0-6の範囲', () => {
    const dates = getMonthDates('2026-03');
    for (const d of dates) {
      expect(d.dayOfWeek).toBeGreaterThanOrEqual(0);
      expect(d.dayOfWeek).toBeLessThanOrEqual(6);
    }
  });

  it('2026-03-01は日曜日（dayOfWeek=0）', () => {
    const dates = getMonthDates('2026-03');
    expect(dates[0].dayOfWeek).toBe(0);
    expect(dates[0].dayLabel).toBe('日');
  });

  it('2月のうるう年は29日', () => {
    const dates = getMonthDates('2024-02');
    expect(dates.length).toBe(29);
    expect(dates[28].date).toBe('2024-02-29');
  });

  it('日付が1桁の場合はゼロパディングされる', () => {
    const dates = getMonthDates('2026-01');
    expect(dates[0].date).toBe('2026-01-01');
    expect(dates[8].date).toBe('2026-01-09');
  });
});

describe('getPrevMonth', () => {
  it('通常の月（3月→2月）', () => {
    expect(getPrevMonth('2026-03')).toBe('2026-02');
  });

  it('1月→前年12月', () => {
    expect(getPrevMonth('2026-01')).toBe('2025-12');
  });

  it('10月→9月（ゼロパディング）', () => {
    expect(getPrevMonth('2026-10')).toBe('2026-09');
  });

  it('2月→1月', () => {
    expect(getPrevMonth('2026-02')).toBe('2026-01');
  });
});

describe('getNextMonth', () => {
  it('通常の月（3月→4月）', () => {
    expect(getNextMonth('2026-03')).toBe('2026-04');
  });

  it('12月→翌年1月', () => {
    expect(getNextMonth('2025-12')).toBe('2026-01');
  });

  it('9月→10月', () => {
    expect(getNextMonth('2026-09')).toBe('2026-10');
  });

  it('1月→2月', () => {
    expect(getNextMonth('2026-01')).toBe('2026-02');
  });
});

describe('formatYearMonth', () => {
  it('YYYY-MM を「YYYY年M月」形式に変換する', () => {
    expect(formatYearMonth('2026-03')).toBe('2026年3月');
  });

  it('1月の場合', () => {
    expect(formatYearMonth('2026-01')).toBe('2026年1月');
  });

  it('12月の場合', () => {
    expect(formatYearMonth('2025-12')).toBe('2025年12月');
  });

  it('10月の場合（2桁月）', () => {
    expect(formatYearMonth('2026-10')).toBe('2026年10月');
  });
});
