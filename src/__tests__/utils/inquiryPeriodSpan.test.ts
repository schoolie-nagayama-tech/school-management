import { describe, it, expect } from 'vitest';
import { resolveSpanPeriod, spanWindowOptions, monthToOffset } from '@/lib/utils/inquiryPeriod';

// 2026-07-15 12:00 JST を基準にする（jstParts が +9h するので UTC は 03:00Z）
const NOW = new Date('2026-07-15T03:00:00Z');

describe('resolveSpanPeriod', () => {
  it('month: offset 0 は今月、-1 は先月', () => {
    expect(resolveSpanPeriod('month', 0, '', '', NOW)).toEqual({
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
    });
    expect(resolveSpanPeriod('month', -1, '', '', NOW)).toEqual({
      dateFrom: '2026-06-01',
      dateTo: '2026-06-30',
    });
  });

  it('quarter(3か月): offset 0 は直近3か月(5〜7月)、-1 はその前(2〜4月)', () => {
    expect(resolveSpanPeriod('quarter', 0, '', '', NOW)).toEqual({
      dateFrom: '2026-05-01',
      dateTo: '2026-07-31',
    });
    expect(resolveSpanPeriod('quarter', -1, '', '', NOW)).toEqual({
      dateFrom: '2026-02-01',
      dateTo: '2026-04-30',
    });
  });

  it('quarter: 年をまたぐブロックも正しい', () => {
    // offset -2: end=1月(2026), start=11月(2025)
    expect(resolveSpanPeriod('quarter', -2, '', '', NOW)).toEqual({
      dateFrom: '2025-11-01',
      dateTo: '2026-01-31',
    });
  });

  it('half(半年): offset 0 は直近6か月(2〜7月)', () => {
    expect(resolveSpanPeriod('half', 0, '', '', NOW)).toEqual({
      dateFrom: '2026-02-01',
      dateTo: '2026-07-31',
    });
  });

  it('year: offset 0 は今年、-1 は去年（カレンダー年）', () => {
    expect(resolveSpanPeriod('year', 0, '', '', NOW)).toEqual({
      dateFrom: '2026-01-01',
      dateTo: '2026-12-31',
    });
    expect(resolveSpanPeriod('year', -1, '', '', NOW)).toEqual({
      dateFrom: '2025-01-01',
      dateTo: '2025-12-31',
    });
  });

  it('all は境界なし、custom は引数をそのまま返す', () => {
    expect(resolveSpanPeriod('all', 0, '', '', NOW)).toEqual({ dateFrom: '', dateTo: '' });
    expect(resolveSpanPeriod('custom', 0, '2026-01-05', '2026-03-10', NOW)).toEqual({
      dateFrom: '2026-01-05',
      dateTo: '2026-03-10',
    });
  });
});

describe('spanWindowOptions', () => {
  it('month は12件で先頭が今月・先月', () => {
    const opts = spanWindowOptions('month', NOW);
    expect(opts).toHaveLength(12);
    expect(opts[0]).toEqual({ offset: 0, label: '今月（2026年7月）' });
    expect(opts[1]).toEqual({ offset: -1, label: '先月（2026年6月）' });
    expect(opts[2].label).toBe('2026年5月');
  });

  it('year は先頭が今年・去年', () => {
    const opts = spanWindowOptions('year', NOW);
    expect(opts[0]).toEqual({ offset: 0, label: '今年（2026）' });
    expect(opts[1]).toEqual({ offset: -1, label: '去年（2025）' });
    expect(opts[2].label).toBe('2024年');
  });

  it('quarter は直近3か月ラベル、half は直近半年ラベル', () => {
    expect(spanWindowOptions('quarter', NOW)[0].label).toBe('直近3か月（2026年5〜7月）');
    expect(spanWindowOptions('half', NOW)[0].label).toBe('直近半年（2026年2〜7月）');
  });

  it('all / custom は空配列', () => {
    expect(spanWindowOptions('all', NOW)).toEqual([]);
    expect(spanWindowOptions('custom', NOW)).toEqual([]);
  });
});

describe('monthToOffset', () => {
  it('今月は0、前年同月は-12、一昨年同月は-24', () => {
    expect(monthToOffset(2026, 7, NOW)).toBe(0);
    expect(monthToOffset(2025, 7, NOW)).toBe(-12); // 前年同月
    expect(monthToOffset(2024, 7, NOW)).toBe(-24); // 一昨年同月
    expect(monthToOffset(2026, 6, NOW)).toBe(-1); // 先月
  });

  it('resolveSpanPeriod と往復して前年同月が取れる', () => {
    const off = monthToOffset(2025, 7, NOW);
    expect(resolveSpanPeriod('month', off, '', '', NOW)).toEqual({
      dateFrom: '2025-07-01',
      dateTo: '2025-07-31',
    });
  });
});
