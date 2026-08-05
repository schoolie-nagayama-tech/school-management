import { describe, it, expect } from 'vitest';
import { normalizeKomaBySubject, totalKoma } from '@/lib/utils/komaBySubject';

describe('normalizeKomaBySubject', () => {
  it('旧形式(number)を既定値(ratio=2, duration=90)付きの KomaSpec に正規化する', () => {
    expect(normalizeKomaBySubject({ uuid: 3 })).toEqual({
      uuid: { koma: 3, ratio: 2, duration: 90 },
    });
  });

  it('新形式(KomaSpec)はそのまま通す（unitPrice/regularKoma も保持）', () => {
    const input = {
      uuid: { koma: 2, ratio: 1, duration: 45, unitPrice: 3500, regularKoma: 1 },
    };
    expect(normalizeKomaBySubject(input)).toEqual(input);
  });

  it('number と KomaSpec が混在していてもそれぞれ正しく正規化する', () => {
    const input = {
      subjA: 4,
      subjB: { koma: 2, ratio: 1, duration: 45 },
    };
    expect(normalizeKomaBySubject(input)).toEqual({
      subjA: { koma: 4, ratio: 2, duration: 90 },
      subjB: { koma: 2, ratio: 1, duration: 45 },
    });
  });

  it('koma が無い/不正なオブジェクトはその科目を落とす', () => {
    expect(normalizeKomaBySubject({ a: {} })).toEqual({});
    expect(normalizeKomaBySubject({ a: { koma: 'x' } })).toEqual({});
  });

  it('null/負数/文字列など不正な値を持つ科目は落とす（例外は投げない）', () => {
    expect(normalizeKomaBySubject({ a: null, b: -1, c: {}, d: '3' })).toEqual({});
  });

  it('不正な科目と正常な科目が混在するときは正常な科目だけ残す', () => {
    expect(normalizeKomaBySubject({ ok: 2, bad: -1 })).toEqual({
      ok: { koma: 2, ratio: 2, duration: 90 },
    });
  });

  it('ratio/duration が許容値外なら既定値(2/90)に丸める', () => {
    expect(normalizeKomaBySubject({ a: { koma: 1, ratio: 3, duration: 60 } })).toEqual({
      a: { koma: 1, ratio: 2, duration: 90 },
    });
  });

  it('空オブジェクト・null・undefined 入力は空マップを返す', () => {
    expect(normalizeKomaBySubject({})).toEqual({});
    expect(normalizeKomaBySubject(null)).toEqual({});
    expect(normalizeKomaBySubject(undefined)).toEqual({});
  });

  it('配列や文字列など object 以外のトップレベル入力は空マップを返す', () => {
    expect(normalizeKomaBySubject([1, 2, 3])).toEqual({});
    expect(normalizeKomaBySubject('invalid')).toEqual({});
  });
});

describe('totalKoma', () => {
  it('正規化済みマップの koma を合算する', () => {
    const map = normalizeKomaBySubject({ a: 3, b: { koma: 2, ratio: 1, duration: 45 } });
    expect(totalKoma(map)).toBe(5);
  });

  it('空マップは0を返す', () => {
    expect(totalKoma({})).toBe(0);
  });
});
