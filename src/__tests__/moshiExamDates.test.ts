import { describe, it, expect } from 'vitest';
import {
  formatMoshiDateLabel,
  formatMoshiExamDateText,
  getMinFurikaeDate,
  getMoshiExamDates,
  isWeekday,
} from '@/lib/utils/moshiExamDates';
import type { MoshiSettings } from '@/types/forms/moshi';

// 複数日程対応より前に保存された設定（exam_dates を持たない）
const legacySettings: MoshiSettings = {
  description: '',
  grades: ['中3'],
  exam_date: '2026-02-15',
  exam_date_label: '2月15日（日）',
  exam_time: '10:00〜13:00',
  furikae: {
    enabled: true,
    note: '',
    time_guide: { elementary: '約2時間', middle: '約3時間' },
    available_days: ['月', '火', '水', '木', '金'],
  },
  completion_message: '',
};

const multiDateSettings: MoshiSettings = {
  ...legacySettings,
  exam_dates: [
    { id: 'b', date: '2026-03-01', label: '3月1日（日）', time: '14:00〜17:00' },
    { id: 'a', date: '2026-02-15', label: '2月15日（日）', time: '10:00〜13:00' },
  ],
  // 先頭日程が旧フィールドにも書かれている（エディタの保存挙動と同じ）
  exam_date: '2026-02-15',
  exam_date_label: '2月15日（日）',
  exam_time: '10:00〜13:00',
};

describe('formatMoshiDateLabel', () => {
  it('YYYY-MM-DD を曜日つきの和文ラベルにする', () => {
    expect(formatMoshiDateLabel('2026-02-15')).toBe('2月15日（日）');
  });

  it('空文字や不正な日付では空文字を返す', () => {
    expect(formatMoshiDateLabel('')).toBe('');
    expect(formatMoshiDateLabel('not-a-date')).toBe('');
  });
});

describe('getMoshiExamDates', () => {
  it('旧データ（単一日程）を1件の配列として返す', () => {
    const dates = getMoshiExamDates(legacySettings);
    expect(dates).toEqual([
      { id: '2026-02-15', date: '2026-02-15', label: '2月15日（日）', time: '10:00〜13:00' },
    ]);
  });

  it('exam_date_label が欠けた旧データでは日付からラベルを補う', () => {
    const dates = getMoshiExamDates({ ...legacySettings, exam_date_label: '' });
    expect(dates[0].label).toBe('2月15日（日）');
  });

  it('exam_dates があればそちらを使い、日付昇順に並べ替える', () => {
    const dates = getMoshiExamDates(multiDateSettings);
    expect(dates.map((d) => d.date)).toEqual(['2026-02-15', '2026-03-01']);
  });

  it('日付のない行は捨てる', () => {
    const dates = getMoshiExamDates({
      ...multiDateSettings,
      exam_dates: [
        { id: 'a', date: '2026-02-15', label: '2月15日（日）' },
        { id: 'broken', date: '', label: '' },
      ],
    });
    expect(dates).toHaveLength(1);
  });

  it('日程が何も無ければ空配列', () => {
    const dates = getMoshiExamDates({ ...legacySettings, exam_date: '', exam_date_label: '' });
    expect(dates).toEqual([]);
  });
});

describe('getMinFurikaeDate', () => {
  it('旧データでは受験日の翌日', () => {
    expect(getMinFurikaeDate(legacySettings)).toBe('2026-02-16');
  });

  it('複数日程では「最終試験日」の翌日（先頭日程ではない）', () => {
    expect(getMinFurikaeDate(multiDateSettings)).toBe('2026-03-02');
  });

  it('月末をまたぐ場合も翌日になる', () => {
    expect(
      getMinFurikaeDate({
        ...legacySettings,
        exam_date: '2026-02-28',
        exam_dates: undefined,
      })
    ).toBe('2026-03-01');
  });

  it('日程が無ければ空文字（下限なし）', () => {
    expect(getMinFurikaeDate({ ...legacySettings, exam_date: '' })).toBe('');
  });
});

describe('formatMoshiExamDateText', () => {
  it('時間があれば日付ラベルと連結する', () => {
    expect(formatMoshiExamDateText({ label: '2月15日（日）', time: '10:00〜13:00' })).toBe(
      '2月15日（日） 10:00〜13:00'
    );
  });

  it('時間が無ければ日付ラベルだけ', () => {
    expect(formatMoshiExamDateText({ label: '2月15日（日）' })).toBe('2月15日（日）');
  });
});

describe('isWeekday', () => {
  it('月〜金は true、土日は false', () => {
    expect(isWeekday('2026-02-16')).toBe(true); // 月
    expect(isWeekday('2026-02-20')).toBe(true); // 金
    expect(isWeekday('2026-02-21')).toBe(false); // 土
    expect(isWeekday('2026-02-15')).toBe(false); // 日
  });
});
