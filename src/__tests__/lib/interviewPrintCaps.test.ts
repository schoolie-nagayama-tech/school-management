import { describe, it, expect } from 'vitest';
import { INTERVIEW_PRINT_CAPS, capItems, capLinesWithRest } from '@/lib/interview/printCaps';

describe('capItems', () => {
  it('上限以下ならそのまま・hidden は0', () => {
    expect(capItems(['a', 'b'], 3)).toEqual({ shown: ['a', 'b'], hidden: 0 });
  });

  it('上限を超えたら先頭から残し、残りの件数を返す（先頭ほど大事）', () => {
    expect(capItems(['a', 'b', 'c', 'd', 'e'], 3)).toEqual({ shown: ['a', 'b', 'c'], hidden: 2 });
  });

  it('上限0なら何も出さず全件を hidden にする', () => {
    expect(capItems(['a', 'b'], 0)).toEqual({ shown: [], hidden: 2 });
  });

  it('負や小数の上限でも壊れない', () => {
    expect(capItems(['a', 'b'], -1)).toEqual({ shown: [], hidden: 2 });
    expect(capItems(['a', 'b', 'c'], 1.9)).toEqual({ shown: ['a'], hidden: 2 });
  });

  it('元の配列を書き換えない', () => {
    const src = ['a', 'b', 'c'];
    capItems(src, 1);
    expect(src).toEqual(['a', 'b', 'c']);
  });
});

describe('capLinesWithRest', () => {
  it('上限以下なら「ほか」を足さない', () => {
    expect(capLinesWithRest(['成績', '通知表'], 4)).toEqual(['成績', '通知表']);
  });

  it('削ったら末尾に「ほかN件」を足す（黙って消さない）', () => {
    expect(capLinesWithRest(['1', '2', '3', '4', '5', '6'], 4)).toEqual([
      '1',
      '2',
      '3',
      '4',
      'ほか2件',
    ]);
  });
});

describe('INTERVIEW_PRINT_CAPS', () => {
  it('どの上限も1以上（0にすると紙からその行が黙って消える）', () => {
    for (const [key, value] of Object.entries(INTERVIEW_PRINT_CAPS)) {
      expect(value, key).toBeGreaterThanOrEqual(1);
    }
  });
});
