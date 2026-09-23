import { describe, it, expect } from 'vitest';
import {
  examCountdownForSchool,
  drawCountdown,
  COUNTDOWN_PROBABILITY,
} from '@/components/privacy-screen/examCountdown';
import { nextTokyoExamDate, nextTokyoExamDateForRegion } from '@/lib/interview/examDates';

/** 永山校（試験運用中の唯一の対象） */
const NAGAYAMA = 'd187f7a3-633a-46ce-8d32-c56c85d17bac';
/** 京王堀之内校（東京だが試験対象外） */
const HORINOUCHI = '9f519794-3673-4e90-b1ea-88a79f70174a';
/** 緑園都市校（神奈川） */
const RYOKUEN = '9a6b5996-a266-47ed-878f-85e93c2b8b90';

describe('プライバシースクリーンの入試カウントダウン', () => {
  it('永山校では令和9年度入試までの日数を出す', () => {
    const c = examCountdownForSchool(new Date(2026, 8, 22), NAGAYAMA);
    expect(c).not.toBeNull();
    expect(c!.days).toBe(152);
    expect(c!.dateLabel).toBe('2/21');
    expect(c!.label).toBe('都立入試まで');
  });

  it('曜日は出さない（短く保つため）', () => {
    const c = examCountdownForSchool(new Date(2026, 8, 22), NAGAYAMA);
    expect(c!.dateLabel).not.toMatch(/[（(]/);
  });

  it('試験対象外の教室では出さない（同じ東京でも）', () => {
    expect(examCountdownForSchool(new Date(2026, 8, 22), HORINOUCHI)).toBeNull();
  });

  it('神奈川の教室では出さない', () => {
    expect(examCountdownForSchool(new Date(2026, 8, 22), RYOKUEN)).toBeNull();
  });

  it('「すべての教室」「未選択」では出さない', () => {
    expect(examCountdownForSchool(new Date(2026, 8, 22), 'all')).toBeNull();
    expect(examCountdownForSchool(new Date(2026, 8, 22), null)).toBeNull();
    expect(examCountdownForSchool(new Date(2026, 8, 22), undefined)).toBeNull();
  });

  it('当日は0日として出す', () => {
    const c = examCountdownForSchool(new Date(2027, 1, 21), NAGAYAMA);
    expect(c!.days).toBe(0);
  });

  it('入試を過ぎたら出さない（年度内に日付を引き続けても負の日数を見せない）', () => {
    expect(examCountdownForSchool(new Date(2027, 1, 22), NAGAYAMA)).toBeNull();
  });

  it('日付を登録していない年度では出さない（当て推量の日付を出さない）', () => {
    // 2027年4月以降は令和10年度入試を引くが、まだ登録していない
    expect(examCountdownForSchool(new Date(2027, 3, 1), NAGAYAMA)).toBeNull();
  });
});

describe('カウントダウンの抽選', () => {
  it('100回に1回', () => {
    expect(COUNTDOWN_PROBABILITY).toBe(1 / 100);
  });

  it('しきい値未満なら当たり、以上なら外れ', () => {
    expect(drawCountdown(() => 0)).toBe(true);
    expect(drawCountdown(() => 0.009)).toBe(true);
    expect(drawCountdown(() => 0.01)).toBe(false);
    expect(drawCountdown(() => 0.5)).toBe(false);
  });
});

describe('教室単位の入試日（学年を見ない版）', () => {
  it('学年ゲートのある既存の関数と、東京・中3では同じ日付を返す', () => {
    const today = new Date(2026, 8, 22);
    expect(nextTokyoExamDateForRegion(today, 'tokyo')).toBe('2027-02-21');
    expect(nextTokyoExamDate(today, 9, 'tokyo')).toBe('2027-02-21');
  });

  it('教室単位の版は中3以外でも日付を返す（面談台本の学年ゲートを引きずらない）', () => {
    const today = new Date(2026, 8, 22);
    expect(nextTokyoExamDate(today, 7, 'tokyo')).toBeNull();
    expect(nextTokyoExamDateForRegion(today, 'tokyo')).toBe('2027-02-21');
  });

  it('神奈川・未登録の教室には日付を出さない', () => {
    const today = new Date(2026, 8, 22);
    expect(nextTokyoExamDateForRegion(today, 'kanagawa')).toBeNull();
    expect(nextTokyoExamDateForRegion(today, null)).toBeNull();
  });

  it('1〜3月は前年4月に始まった年度なので、その年の2月の入試を指す', () => {
    expect(nextTokyoExamDateForRegion(new Date(2027, 0, 10), 'tokyo')).toBe('2027-02-21');
  });
});
