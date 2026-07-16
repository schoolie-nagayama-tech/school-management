import { describe, it, expect } from 'vitest';
import { isTransferDeadlinePassed, transferDeadlineMs } from '@/lib/mypage/transferDeadline';

/**
 * 振替締切（前日21:00 JST）の境界テスト。
 * 正典: docs/portal-v2-requirements.md §7-2「振替ルール」。
 *   前日20:59=可 / 前日21:00=不可 / 当日=不可。
 *
 * JST=UTC+9。前日21:00 JST = 前日12:00 UTC。
 */
describe('transferDeadline', () => {
  const lessonDate = '2026-07-20'; // 対象授業日（月）

  it('締切の絶対時刻は前日12:00 UTC（=前日21:00 JST）', () => {
    // 2026-07-19 12:00:00 UTC
    expect(transferDeadlineMs(lessonDate)).toBe(Date.UTC(2026, 6, 19, 12, 0, 0));
  });

  it('前日 20:59 JST（=11:59 UTC）は振替可（false）', () => {
    const now = new Date(Date.UTC(2026, 6, 19, 11, 59, 0));
    expect(isTransferDeadlinePassed(lessonDate, now)).toBe(false);
  });

  it('前日 21:00 JST（=12:00 UTC）ちょうどは振替不可（true）', () => {
    const now = new Date(Date.UTC(2026, 6, 19, 12, 0, 0));
    expect(isTransferDeadlinePassed(lessonDate, now)).toBe(true);
  });

  it('前日 21:01 JST は振替不可（true）', () => {
    const now = new Date(Date.UTC(2026, 6, 19, 12, 1, 0));
    expect(isTransferDeadlinePassed(lessonDate, now)).toBe(true);
  });

  it('当日 0:00 JST は振替不可（true）', () => {
    // 2026-07-20 00:00 JST = 2026-07-19 15:00 UTC
    const now = new Date(Date.UTC(2026, 6, 19, 15, 0, 0));
    expect(isTransferDeadlinePassed(lessonDate, now)).toBe(true);
  });

  it('数日前は振替可（false）', () => {
    const now = new Date(Date.UTC(2026, 6, 17, 3, 0, 0));
    expect(isTransferDeadlinePassed(lessonDate, now)).toBe(false);
  });

  it('月初の授業日でも前月末に正しく繰り下がる', () => {
    // 2026-08-01 の締切 = 2026-07-31 12:00 UTC
    expect(transferDeadlineMs('2026-08-01')).toBe(Date.UTC(2026, 6, 31, 12, 0, 0));
  });

  it('不正な日付は安全側（振替不可=true）', () => {
    expect(isTransferDeadlinePassed('not-a-date', new Date())).toBe(true);
    expect(transferDeadlineMs('2026/07/20')).toBeNull();
  });
});
