/**
 * ポータルの New 判定・並び替えのテスト
 *
 * 受付開始から7日間だけ New にして先頭へ浮上させ、8日目以降は手動の並び順に戻ることを固定する。
 */
import { describe, it, expect } from 'vitest';
import { isRecentlyOpened, sortNewFirst, PORTAL_NEW_DAYS } from '@/lib/utils/portalNew';

const NOW = Date.parse('2026-08-08T12:00:00+09:00');
const daysAgo = (n: number) => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString();

describe('isRecentlyOpened', () => {
  it('受付開始が7日以内なら New', () => {
    expect(isRecentlyOpened(daysAgo(0), NOW)).toBe(true);
    expect(isRecentlyOpened(daysAgo(6.9), NOW)).toBe(true);
    expect(isRecentlyOpened(daysAgo(PORTAL_NEW_DAYS), NOW)).toBe(true);
  });

  it('7日を過ぎたら New ではない', () => {
    expect(isRecentlyOpened(daysAgo(7.1), NOW)).toBe(false);
    expect(isRecentlyOpened(daysAgo(30), NOW)).toBe(false);
  });

  it('未設定・不正な日付・未来の日付は New ではない', () => {
    expect(isRecentlyOpened(null, NOW)).toBe(false);
    expect(isRecentlyOpened(undefined, NOW)).toBe(false);
    expect(isRecentlyOpened('not-a-date', NOW)).toBe(false);
    expect(isRecentlyOpened(daysAgo(-1), NOW)).toBe(false);
  });
});

describe('sortNewFirst', () => {
  it('New を先頭（受付開始が新しい順）に、それ以外は元の並びを保つ', () => {
    const items = [
      { key: 'a', openedAt: daysAgo(30) },
      { key: 'b', openedAt: daysAgo(5) },
      { key: 'c', openedAt: null },
      { key: 'd', openedAt: daysAgo(1) },
      { key: 'e', openedAt: daysAgo(100) },
    ];
    const sorted = sortNewFirst(items, (i) => i.openedAt, NOW);
    expect(sorted.map((i) => i.key)).toEqual(['d', 'b', 'a', 'c', 'e']);
  });

  it('New が無ければ並びは変わらない', () => {
    const items = [
      { key: 'a', openedAt: daysAgo(30) },
      { key: 'b', openedAt: null },
      { key: 'c', openedAt: daysAgo(8) },
    ];
    const sorted = sortNewFirst(items, (i) => i.openedAt, NOW);
    expect(sorted.map((i) => i.key)).toEqual(['a', 'b', 'c']);
  });
});
