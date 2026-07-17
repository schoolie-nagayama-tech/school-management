/**
 * 振替クォータの純関数テスト（docs/portal-v2-requirements.md §7-3）。
 *
 * 固定する仕様:
 *   - フリー期間の境界（両端を含む・期間外）
 *   - 教室の追加許可が上限に上乗せされる
 *   - remaining が負にならない（超過していても0）
 *   - 月の基準は targetDate の月（今日の月ではない）＝ monthStartOf の契約
 */
import { describe, it, expect, vi } from 'vitest';

// transferQuota.ts は 'server-only' を import するため、node のテスト環境では空モジュールに差し替える。
vi.mock('server-only', () => ({}));

import { monthStartOf, findFreePeriod, computeQuota } from '@/lib/mypage/transferQuota';
import type { FreePeriodRow } from '@/lib/mypage/transferQuota';

describe('monthStartOf: 対象授業日 → その月の初日', () => {
  it('月中の日付はその月の初日になる', () => {
    expect(monthStartOf('2026-07-15')).toBe('2026-07-01');
  });

  it('月初・月末も同じ月の初日になる', () => {
    expect(monthStartOf('2026-07-01')).toBe('2026-07-01');
    expect(monthStartOf('2026-07-31')).toBe('2026-07-01');
  });

  it('★ 月の基準は対象授業日（今日ではない）: 7/31 の欠席は 8 月に持ち越さない', () => {
    // 8/1 に 7/31 の欠席を連絡しても、数える月は 7 月（§7-3 の罠）。
    expect(monthStartOf('2026-07-31')).toBe('2026-07-01');
    expect(monthStartOf('2026-08-01')).toBe('2026-08-01');
  });

  it('年跨ぎでも正しい', () => {
    expect(monthStartOf('2026-12-31')).toBe('2026-12-01');
    expect(monthStartOf('2027-01-01')).toBe('2027-01-01');
  });

  it('不正な日付は null', () => {
    expect(monthStartOf('2026-7-1')).toBeNull();
    expect(monthStartOf('')).toBeNull();
    expect(monthStartOf('2026-13-01')).toBeNull();
    expect(monthStartOf('not-a-date')).toBeNull();
  });
});

describe('findFreePeriod: 対象授業日がフリー期間に含まれるか', () => {
  const periods: FreePeriodRow[] = [
    { start_date: '2026-07-22', end_date: '2026-08-09', label: '夏期講習前期間' },
  ];

  it('期間内は該当する', () => {
    expect(findFreePeriod('2026-07-25', periods)?.label).toBe('夏期講習前期間');
  });

  it('境界（開始日ちょうど・終了日ちょうど）は両端とも含む', () => {
    expect(findFreePeriod('2026-07-22', periods)).not.toBeNull();
    expect(findFreePeriod('2026-08-09', periods)).not.toBeNull();
  });

  it('境界の外側（開始前日・終了翌日）は含まない', () => {
    expect(findFreePeriod('2026-07-21', periods)).toBeNull();
    expect(findFreePeriod('2026-08-10', periods)).toBeNull();
  });

  it('期間が無ければ null', () => {
    expect(findFreePeriod('2026-07-25', [])).toBeNull();
  });

  it('複数期間のうち該当する最初のものを返す', () => {
    const many: FreePeriodRow[] = [
      { start_date: '2026-03-20', end_date: '2026-04-05', label: '春期' },
      { start_date: '2026-07-22', end_date: '2026-08-09', label: '夏期' },
    ];
    expect(findFreePeriod('2026-03-25', many)?.label).toBe('春期');
    expect(findFreePeriod('2026-07-25', many)?.label).toBe('夏期');
  });

  it('不正な日付は該当なし（安全側）', () => {
    expect(findFreePeriod('2026-7-25', periods)).toBeNull();
  });
});

describe('computeQuota: 上限・使用・追加許可から残りを組み立てる', () => {
  it('許可なし: remaining = limit - used、振替可', () => {
    const q = computeQuota(2, 1, 0, '2026年7月');
    expect(q.limit).toBe(2);
    expect(q.effectiveLimit).toBe(2);
    expect(q.used).toBe(1);
    expect(q.remaining).toBe(1);
    expect(q.canRequestTransfer).toBe(true);
    expect(q.hasPermission).toBe(false);
  });

  it('上限ぴったり使用済みなら残り0＝振替不可（原則ハードストップ）', () => {
    const q = computeQuota(2, 2, 0, '2026年7月');
    expect(q.remaining).toBe(0);
    expect(q.canRequestTransfer).toBe(false);
  });

  it('★ 教室の追加許可が上限に上乗せされ、振替が再び選べる', () => {
    const q = computeQuota(2, 2, 1, '2026年7月');
    expect(q.effectiveLimit).toBe(3);
    expect(q.remaining).toBe(1);
    expect(q.canRequestTransfer).toBe(true);
    expect(q.hasPermission).toBe(true);
    expect(q.permissionExtra).toBe(1);
  });

  it('★ 超過していても remaining は負にならない（0に丸める）', () => {
    // スタッフ側はソフト上限なので、実際に used > limit は起こりうる。
    const q = computeQuota(2, 5, 0, '2026年7月');
    expect(q.remaining).toBe(0);
    expect(q.canRequestTransfer).toBe(false);
  });

  it('許可があっても超過ぶんが大きければ残り0のまま', () => {
    const q = computeQuota(2, 5, 1, '2026年7月');
    expect(q.effectiveLimit).toBe(3);
    expect(q.remaining).toBe(0);
    expect(q.canRequestTransfer).toBe(false);
  });

  it('負の許可回数は0として扱う（防御的）', () => {
    const q = computeQuota(2, 1, -3, '2026年7月');
    expect(q.effectiveLimit).toBe(2);
    expect(q.hasPermission).toBe(false);
  });

  it('通塾パターンが無い生徒（limit=0）は振替不可', () => {
    const q = computeQuota(0, 0, 0, '2026年7月');
    expect(q.remaining).toBe(0);
    expect(q.canRequestTransfer).toBe(false);
  });
});
