import { describe, it, expect } from 'vitest';
import {
  lookupPerKoma,
  lookupMonthly,
  lookupGroupMonthly,
  lookupCourseMonthly,
  buildZoukomaPriceTable,
  type PricePlanItem,
} from '@/lib/pricing/pricePlan';

/** 2026年9月改定（202609A）から、判定に効く分だけ抜き出した明細 */
const items: PricePlanItem[] = [
  // 小1〜4は45分、小5・小6は60分と90分の両方がある
  {
    kind: 'per_koma',
    grade_min: 1,
    grade_max: 4,
    duration_minutes: 45,
    ratio: 2,
    weekly_count: null,
    subject_count: null,
    variant: null,
    amount: 2230,
  },
  {
    kind: 'per_koma',
    grade_min: 6,
    grade_max: 6,
    duration_minutes: 60,
    ratio: 2,
    weekly_count: null,
    subject_count: null,
    variant: null,
    amount: 3100,
  },
  {
    kind: 'per_koma',
    grade_min: 6,
    grade_max: 6,
    duration_minutes: 90,
    ratio: 2,
    weekly_count: null,
    subject_count: null,
    variant: null,
    amount: 4220,
  },
  {
    kind: 'per_koma',
    grade_min: 7,
    grade_max: 8,
    duration_minutes: 90,
    ratio: 2,
    weekly_count: null,
    subject_count: null,
    variant: null,
    amount: 4380,
  },
  {
    kind: 'per_koma',
    grade_min: 7,
    grade_max: 8,
    duration_minutes: 90,
    ratio: 1,
    weekly_count: null,
    subject_count: null,
    variant: null,
    amount: 5970,
  },
  {
    kind: 'per_koma',
    grade_min: 9,
    grade_max: 9,
    duration_minutes: 90,
    ratio: 2,
    weekly_count: null,
    subject_count: null,
    variant: null,
    amount: 4540,
  },
  {
    kind: 'monthly',
    grade_min: 7,
    grade_max: 8,
    duration_minutes: 90,
    ratio: 2,
    weekly_count: 1,
    subject_count: null,
    variant: null,
    amount: 19080,
  },
  {
    kind: 'monthly',
    grade_min: 7,
    grade_max: 8,
    duration_minutes: 90,
    ratio: 2,
    weekly_count: 2,
    subject_count: null,
    variant: null,
    amount: 34950,
  },
  {
    kind: 'group_monthly',
    grade_min: 7,
    grade_max: 8,
    duration_minutes: null,
    ratio: null,
    weekly_count: null,
    subject_count: 1,
    variant: null,
    amount: 4080,
  },
  {
    kind: 'group_set',
    grade_min: 7,
    grade_max: 8,
    duration_minutes: null,
    ratio: null,
    weekly_count: null,
    subject_count: 3,
    variant: null,
    amount: 9700,
  },
  {
    kind: 'course_monthly',
    grade_min: 0,
    grade_max: 6,
    duration_minutes: 50,
    ratio: null,
    weekly_count: null,
    subject_count: null,
    variant: 'HAL50分',
    amount: 10890,
  },
];

describe('lookupPerKoma', () => {
  it('学年帯と形態で単コマ単価を引く', () => {
    expect(lookupPerKoma(items, 7, 2)).toBe(4380);
    expect(lookupPerKoma(items, 8, 2)).toBe(4380); // 中1・2は同じ帯
    expect(lookupPerKoma(items, 9, 2)).toBe(4540);
  });

  it('形態で単価が変わる（1対1は高い）', () => {
    expect(lookupPerKoma(items, 7, 1)).toBe(5970);
  });

  it('分数を省くと、その学年で最も長いコースを採る', () => {
    // 小6は60分と90分があるので、既定は90分側
    expect(lookupPerKoma(items, 6, 2)).toBe(4220);
  });

  it('分数を指定すればその分数で引ける', () => {
    expect(lookupPerKoma(items, 6, 2, 60)).toBe(3100);
    expect(lookupPerKoma(items, 1, 2, 45)).toBe(2230);
  });

  it('該当が無ければ null（黙って0円にしない）', () => {
    expect(lookupPerKoma(items, 12, 2)).toBeNull(); // 高3の明細は入れていない
    expect(lookupPerKoma(items, 7, 2, 45)).toBeNull(); // 中学に45分は無い
  });
});

describe('lookupMonthly', () => {
  it('週回数ごとの月謝を引く', () => {
    expect(lookupMonthly(items, 7, 2, 90, 1)).toBe(19080);
    expect(lookupMonthly(items, 7, 2, 90, 2)).toBe(34950);
  });

  it('月謝は週回数に比例しない（単価×回数で代用できない）', () => {
    const w1 = lookupMonthly(items, 7, 2, 90, 1)!;
    const w2 = lookupMonthly(items, 7, 2, 90, 2)!;
    expect(w2).not.toBe(w1 * 2);
  });

  it('該当が無ければ null', () => {
    expect(lookupMonthly(items, 7, 2, 90, 5)).toBeNull();
  });
});

describe('小集団・通年講座', () => {
  it('科目数で月謝を引く', () => {
    expect(lookupGroupMonthly(items, 7, 1)).toBe(4080);
  });

  it('特別セット料金は通常の月謝と別に引く', () => {
    expect(lookupGroupMonthly(items, 7, 3, true)).toBe(9700);
    expect(lookupGroupMonthly(items, 7, 3)).toBeNull();
  });

  it('通年講座は講座名で月額を引く', () => {
    expect(lookupCourseMonthly(items, 'HAL50分')).toBe(10890);
    expect(lookupCourseMonthly(items, '存在しない講座')).toBeNull();
  });
});

describe('buildZoukomaPriceTable', () => {
  it('学年ラベル→単価の表にする（単価が無い学年は載せない）', () => {
    const table = buildZoukomaPriceTable(items, [
      { label: '中1', grade: 7 },
      { label: '中2', grade: 8 },
      { label: '中3', grade: 9 },
      { label: '高3', grade: 12 },
    ]);
    expect(table).toEqual({ 中1: 4380, 中2: 4380, 中3: 4540 });
  });
});
