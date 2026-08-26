/**
 * 枠の定員解決（講座の定員 > 形態の既定値）のテスト。
 *
 * ★ なぜ要るか: 「HAL50分=3名 / HAL80分=5名 / 国理社=10名」のように
 *   同じ形態の中で講座ごとに定員が違う。ここが崩れると座席表の空席行と
 *   API の定員チェックが食い違い、定員オーバーの枠が静かに作れてしまう。
 */
import { describe, it, expect } from 'vitest';
import { resolveClassCapacity } from '@/lib/schedule/classCapacity';

describe('resolveClassCapacity', () => {
  it('講座に定員があれば講座の定員を使う', () => {
    expect(resolveClassCapacity({ courseCapacity: 3, formationDefault: 8 })).toBe(3);
    // 形態の既定値より大きい講座定員もそのまま通す（講座が正）
    expect(resolveClassCapacity({ courseCapacity: 10, formationDefault: 8 })).toBe(10);
    expect(resolveClassCapacity({ courseCapacity: 1, formationDefault: 8 })).toBe(1);
  });

  it('講座の定員が未設定なら形態の既定値を使う', () => {
    expect(resolveClassCapacity({ courseCapacity: null, formationDefault: 8 })).toBe(8);
    expect(resolveClassCapacity({ courseCapacity: undefined, formationDefault: 5 })).toBe(5);
  });

  it('講座の定員が0以下・非整数なら未設定として扱う', () => {
    expect(resolveClassCapacity({ courseCapacity: 0, formationDefault: 8 })).toBe(8);
    expect(resolveClassCapacity({ courseCapacity: -2, formationDefault: 8 })).toBe(8);
    expect(resolveClassCapacity({ courseCapacity: 2.5, formationDefault: 8 })).toBe(8);
  });

  it('形態の既定値が1未満でも1に切り上げる', () => {
    expect(resolveClassCapacity({ courseCapacity: null, formationDefault: 0 })).toBe(1);
    expect(resolveClassCapacity({ courseCapacity: null, formationDefault: -5 })).toBe(1);
    expect(resolveClassCapacity({ courseCapacity: undefined, formationDefault: Number.NaN })).toBe(
      1
    );
  });
});
