import { describe, it, expect } from 'vitest';
import { zoukomaKomaCount } from '@/lib/utils/zoukomaKoma';

describe('zoukomaKomaCount', () => {
  it('total_koma があればそれを採用する', () => {
    expect(zoukomaKomaCount({ total_koma: 5 })).toBe(5);
  });

  it('total_koma が無い/0 のときは subjects のコマ数合計を採用する', () => {
    expect(zoukomaKomaCount({ subjects: { 英語: 2, 数学: 3 } })).toBe(5);
    expect(zoukomaKomaCount({ total_koma: 0, subjects: { 国語: 4 } })).toBe(4);
  });

  it('コマ数情報が無いときは最低1にフォールバックする', () => {
    expect(zoukomaKomaCount({})).toBe(1);
    expect(zoukomaKomaCount(null)).toBe(1);
    expect(zoukomaKomaCount(undefined)).toBe(1);
    expect(zoukomaKomaCount({ subjects: {} })).toBe(1);
  });

  it('subjects に数値以外が混じっても無視して合計する', () => {
    // 想定外データでも落ちずにコマ数を算出できること
    expect(zoukomaKomaCount({ subjects: { 英語: 2, 数学: 'x' as unknown as number } })).toBe(2);
  });
});
