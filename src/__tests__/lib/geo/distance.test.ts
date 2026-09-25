/**
 * 距離と自転車の所要時間の目安のテスト。
 *
 * ★なぜ要るか: 面談で保護者に見せる数字の元になる。桁や切り上げがずれると
 *   「自転車10分」が「100分」になっても画面上は気づきにくい。
 */
import { describe, it, expect } from 'vitest';
import { haversineKm, estimateBikeMinutes, BIKE_SPEED_KMH } from '@/lib/geo/distance';

describe('haversineKm', () => {
  it('同じ点は0km', () => {
    expect(haversineKm(35.633133, 139.447712, 35.633133, 139.447712)).toBe(0);
  });

  it('経度1度（赤道上）はおよそ111.2km', () => {
    expect(haversineKm(0, 0, 0, 1)).toBeCloseTo(111.2, 1);
  });

  it('京王永山〜京王堀之内はおよそ4.3km（実在の駅間の直線距離）', () => {
    const km = haversineKm(35.633133, 139.447712, 35.624357, 139.400532);
    expect(km).toBeGreaterThan(4.2);
    expect(km).toBeLessThan(4.5);
  });

  it('向きを入れ替えても同じ距離', () => {
    const a = haversineKm(35.772011, 139.519817, 35.439822, 139.522077);
    const b = haversineKm(35.439822, 139.522077, 35.772011, 139.519817);
    expect(a).toBeCloseTo(b, 10);
  });

  it('地球の反対側でも NaN にならない', () => {
    expect(Number.isNaN(haversineKm(0, 0, 0, 180))).toBe(false);
  });
});

describe('estimateBikeMinutes', () => {
  it('15km/h 前提', () => {
    expect(BIKE_SPEED_KMH).toBe(15);
    expect(estimateBikeMinutes(15)).toBe(60);
  });

  it('端数は切り上げる（短く見積もらない）', () => {
    // 1km = 4分ちょうど
    expect(estimateBikeMinutes(1)).toBe(4);
    // 1.01km = 4.04分 → 5分
    expect(estimateBikeMinutes(1.01)).toBe(5);
    // 0.1km = 0.4分 → 1分
    expect(estimateBikeMinutes(0.1)).toBe(1);
  });

  it('浮動小数の誤差で1分増えない', () => {
    // 0.5km = 2分ちょうど（0.5/15*60 は浮動小数で 2.0000000000000004 になりうる）
    expect(estimateBikeMinutes(0.5)).toBe(2);
    expect(estimateBikeMinutes(2.5)).toBe(10);
  });

  it('0・負・NaN・無限大は0分', () => {
    expect(estimateBikeMinutes(0)).toBe(0);
    expect(estimateBikeMinutes(-3)).toBe(0);
    expect(estimateBikeMinutes(Number.NaN)).toBe(0);
    expect(estimateBikeMinutes(Number.POSITIVE_INFINITY)).toBe(0);
  });
});
