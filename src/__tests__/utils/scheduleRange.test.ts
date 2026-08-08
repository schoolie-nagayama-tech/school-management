/**
 * 準備スケジュール（工程表）ガントの表示期間テスト
 *
 * 枠はシーズンの既定期間を土台に、タスクの日付まで月単位で広げる。
 * 日付の境界（月末・年跨ぎ）と「広げるが縮めない」方針が壊れていないかを見る。
 *
 * 対象: src/lib/utils/scheduleRange.ts
 * 使用箇所: src/app/courses/schedule/page.tsx
 */
import { describe, it, expect } from 'vitest';
import { getSeasonBaseRange, getScheduleFullRange, isSameRange } from '@/lib/utils/scheduleRange';

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

describe('getSeasonBaseRange', () => {
  it('冬期は年を跨いで翌1月末まで', () => {
    const r = getSeasonBaseRange('winter', 2026);
    expect(ymd(r.start)).toBe('2026-10-01');
    expect(ymd(r.end)).toBe('2027-01-31');
  });

  it('夏期は4月〜8月', () => {
    const r = getSeasonBaseRange('summer', 2026);
    expect(ymd(r.start)).toBe('2026-04-01');
    expect(ymd(r.end)).toBe('2026-08-31');
  });
});

describe('getScheduleFullRange', () => {
  it('タスクが無ければ既定期間のまま（デフォルトを変えない）', () => {
    const r = getScheduleFullRange('summer', 2026, []);
    expect(isSameRange(r, getSeasonBaseRange('summer', 2026))).toBe(true);
  });

  it('日付を持たないタスクだけなら既定期間のまま', () => {
    const r = getScheduleFullRange('summer', 2026, [{ start_date: null, end_date: null }]);
    expect(isSameRange(r, getSeasonBaseRange('summer', 2026))).toBe(true);
  });

  it('既定期間に収まるタスクでは枠を縮めない', () => {
    // 6月だけにタスクがあっても 4月〜8月のまま（縮めるとドラッグできる範囲まで狭まるため）
    const r = getScheduleFullRange('summer', 2026, [
      { start_date: '2026-06-10', end_date: '2026-06-20' },
    ]);
    expect(ymd(r.start)).toBe('2026-04-01');
    expect(ymd(r.end)).toBe('2026-08-31');
  });

  it('前にはみ出したタスクの月頭まで広げる', () => {
    const r = getScheduleFullRange('summer', 2026, [
      { start_date: '2026-02-14', end_date: '2026-05-01' },
    ]);
    expect(ymd(r.start)).toBe('2026-02-01');
    expect(ymd(r.end)).toBe('2026-08-31');
  });

  it('後ろにはみ出したタスクの月末まで広げる', () => {
    const r = getScheduleFullRange('summer', 2026, [
      { start_date: '2026-08-20', end_date: '2026-09-15' },
    ]);
    expect(ymd(r.start)).toBe('2026-04-01');
    expect(ymd(r.end)).toBe('2026-09-30');
  });

  it('うるう年の2月末を正しく取る', () => {
    const r = getScheduleFullRange('winter', 2027, [
      { start_date: '2028-02-10', end_date: '2028-02-10' },
    ]);
    expect(ymd(r.end)).toBe('2028-02-29');
  });

  it('終了日が無く開始日だけのタスクも範囲に含める', () => {
    const r = getScheduleFullRange('summer', 2026, [{ start_date: '2026-10-05', end_date: null }]);
    expect(ymd(r.end)).toBe('2026-10-31');
  });

  it('マーカーだけが枠外にある場合も広げる（枠外だと表示されないため）', () => {
    const r = getScheduleFullRange('summer', 2026, [
      { start_date: null, end_date: null, markers: [{ marker_date: '2026-09-03' }] },
    ]);
    expect(ymd(r.end)).toBe('2026-09-30');
  });

  it('複数タスクの最小と最大で決まる', () => {
    const r = getScheduleFullRange('winter', 2026, [
      { start_date: '2026-09-20', end_date: '2026-10-05' },
      { start_date: '2027-01-10', end_date: '2027-03-02' },
    ]);
    expect(ymd(r.start)).toBe('2026-09-01');
    expect(ymd(r.end)).toBe('2027-03-31');
  });

  it('不正な日付文字列は無視して既定期間を保つ', () => {
    const r = getScheduleFullRange('summer', 2026, [{ start_date: 'not-a-date', end_date: '' }]);
    expect(isSameRange(r, getSeasonBaseRange('summer', 2026))).toBe(true);
  });
});
