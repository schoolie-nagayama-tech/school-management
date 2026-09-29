import { describe, expect, it } from 'vitest';
import { checkArea, parseMockSheet, pickWrongItems } from '@/lib/scoreSheet/mockSheet';

// Vもぎの学力分析表の形（数字は作り物。実物の生徒の成績ではない）
const raw = {
  doc_type: 'vmogi_tokyo',
  exam_label: '3年 2026年8月',
  grade: 9,
  ss: { math: 58, eng: 50 },
  first_choice: { name: 'サンプル高校-普通', base_ss: 52 },
  student_name: 'テスト 太郎',
  subjects: {
    math: [
      {
        name: '関数',
        own_pct: 75,
        items: [
          { q: '3 問1', content: '線分の長さ', rate: 55, avg: null, result: 'o' },
          { q: '1 問6', content: '直線の式', rate: 50, avg: null, result: 'o' },
          { q: '3 問2①', content: '点の座標', rate: 48, avg: null, result: 'o' },
          { q: '3 問2②', content: '平行四辺形の面積', rate: 9, avg: null, result: 'x' },
        ],
      },
      {
        name: '平面・空間図形',
        own_pct: 0,
        items: [
          { q: '5 問1', content: '空間内の角の大きさ', rate: 44, avg: null, result: 'x_to_double' },
          { q: '5 問2', content: '立体の体積', rate: 2, avg: null, result: 'x' },
        ],
      },
      {
        name: '作図・証明',
        own_pct: null,
        items: [
          { q: '1 問9', content: '作図', rate: null, avg: 2.7, result: 0 },
          { q: '2 問2', content: '式の証明問題', rate: null, avg: 2.7, result: 7 },
        ],
      },
    ],
    eng: [
      {
        name: '読解',
        own_pct: 60, // ★わざと合わない（○は2/4＝50）
        items: [
          { q: '3 問2', content: '文脈把握', rate: 69, avg: null, result: 'x_to_double' },
          { q: '3 問4', content: '理由把握', rate: 54, avg: null, result: 'x_to_star' },
          { q: '4 問1', content: '文脈把握', rate: 59, avg: null, result: 'o' },
          { q: '2 2', content: '適語補充', rate: 55, avg: null, result: 'o' },
        ],
      },
    ],
  },
};

describe('parseMockSheet', () => {
  it('形を検めて取り込む', () => {
    const s = parseMockSheet(raw)!;
    expect(s.docType).toBe('vmogi_tokyo');
    expect(s.ss.math).toBe(58);
    expect(s.firstChoice).toEqual({ name: 'サンプル高校-普通', baseSs: 52 });
    expect(s.subjects.math!.length).toBe(3);
  });
  it('帳票の種類が分からなければ null（推測で埋めない）', () => {
    expect(parseMockSheet({ ...raw, doc_type: 'unknown' })).toBeNull();
    expect(parseMockSheet(null)).toBeNull();
  });
});

describe('checkArea（検算）', () => {
  const s = parseMockSheet(raw)!;
  it('○の数÷設問数が帳票の得点率と合えば ok', () => {
    expect(checkArea(s.subjects.math![0])).toEqual({ status: 'ok', counted: 75 });
    expect(checkArea(s.subjects.math![1])).toEqual({ status: 'ok', counted: 0 });
  });
  it('部分点の領域は検算の対象外', () => {
    expect(checkArea(s.subjects.math![2])).toEqual({ status: 'partial' });
  });
  it('合わなければ mismatch（読み違いがある）', () => {
    expect(checkArea(s.subjects.eng![0])).toEqual({ status: 'mismatch', counted: 50, printed: 60 });
  });
});

describe('pickWrongItems', () => {
  const s = parseMockSheet(raw)!;
  it('数学（偏差値58）は難問も入れ、部分点は平均点未満だけ×にする', () => {
    const r = pickWrongItems(s, 'math');
    expect(r.wrong.map((w) => `${w.q}:${w.mark}`)).toEqual([
      '3 問2②:×',
      '5 問1:×→◎',
      '5 問2:×',
      '1 問9:0点',
    ]);
    expect(r.wrong.find((w) => w.q === '5 問2')!.hard).toBe(true);
    expect(r.skippedHard).toEqual([]);
  });
  it('偏差値55未満なら難問を外して skippedHard に出す', () => {
    const low = { ...s, ss: { ...s.ss, math: 50 } };
    const r = pickWrongItems(low, 'math');
    expect(r.skippedHard.map((w) => w.q)).toEqual(['3 問2②', '5 問2']);
    expect(r.wrong.map((w) => w.q)).toEqual(['5 問1', '1 問9']);
  });
  it('検算が合わない領域は、人が確かめるまで使わない', () => {
    expect(pickWrongItems(s, 'eng')).toMatchObject({ wrong: [], unchecked: ['読解'] });
    const confirmed = pickWrongItems(s, 'eng', new Set(['読解']));
    expect(confirmed.wrong.map((w) => w.mark)).toEqual(['×→◎', '×→★']);
  });
});
