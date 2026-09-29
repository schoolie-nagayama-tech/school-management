import { describe, expect, it } from 'vitest';
import { detectPcsSubject, normalizeKey, parsePcs, pcsKey } from '@/lib/scoreSheet/pcsParse';
import type { PdfTextItem } from '@/lib/scoreSheet/pcsParse';
// 実物の PCS 帳票から取り出した文字と座標（氏名の文字は除いてある）
import mathItems from '../fixtures/scoreSheet/pcsMath.json';
import engItems from '../fixtures/scoreSheet/pcsEng.json';

const math = mathItems as PdfTextItem[];
const eng = engItems as PdfTextItem[];

describe('normalizeKey / pcsKey', () => {
  it('空白とかっこ書きの補足を落とす', () => {
    expect(normalizeKey('方程式の利用［応用］(濃度,割合,図形,規則性)')).toBe(
      '方程式の利用［応用］'
    );
    expect(normalizeKey('関数 y = ax2')).toBe('関数y=ax2');
  });
  it('群名を付けて同じ単元名を区別する', () => {
    expect(pcsKey('文字と式', '文字式の利用')).not.toBe(pcsKey('式の計算', '文字式の利用'));
  });
});

describe('detectPcsSubject', () => {
  it('数学・英語を見分け、PCS でなければ null', () => {
    expect(detectPcsSubject(math)).toBe('math');
    expect(detectPcsSubject(eng)).toBe('eng');
    expect(detectPcsSubject([{ str: '学力分析表', x: 0, y: 0, w: 1 }])).toBeNull();
  });
});

describe('parsePcs（数学・実物）', () => {
  const r = parsePcs(math)!;
  const nowOf = (group: string, unit: string) =>
    r.units.find((u) => pcsKey(u.group, u.unit) === pcsKey(group, unit))?.now ?? null;

  it('学年と回を読む', () => {
    expect(r.subject).toBe('math');
    expect(r.grade).toBe(2);
    expect(r.examLabel).toBe('2026年08月Iテスト');
  });

  it('今回の印を23件読み、取りこぼしが無い', () => {
    expect(r.units.filter((u) => u.now).length).toBe(23);
    expect(r.orphanMarks).toBe(0);
  });

  it('群名つきで単元と印を組み立てる（画像と照合済みの値）', () => {
    expect(nowOf('比例・反比例', '比例の式')).toBe('×');
    expect(nowOf('比例・反比例', '比例，反比例の利用')).toBe('×');
    expect(nowOf('正負の数', '四則混合')).toBe('△');
    expect(nowOf('正負の数', '減法，加減混合')).toBe('●');
    expect(nowOf('正負の数', '素数と素因数分解')).toBe('×');
    expect(nowOf('方程式', '方程式の解き方')).toBe('△');
    expect(nowOf('文字と式', '文字式の利用')).toBe('×');
    expect(nowOf('式の計算', '単項式の乗除，式の値')).toBe('●');
    expect(nowOf('空間図形', '空間図形の基礎')).toBe('△');
    expect(nowOf('連立方程式', '連立方程式の解き方')).toBe('●');
  });

  it('空欄の単元は印なし（出題なし）', () => {
    expect(nowOf('正負の数', '乗法')).toBeNull();
    expect(nowOf('平面図形', '作図')).toBeNull();
  });
});

describe('parsePcs（英語・実物）', () => {
  const r = parsePcs(eng)!;
  const nowOf = (group: string, unit: string) =>
    r.units.find((u) => pcsKey(u.group, u.unit) === pcsKey(group, unit))?.now ?? null;

  it('印21件をすべて様式の表で単元に当てる', () => {
    expect(r.subject).toBe('eng');
    expect(r.grade).toBe(2);
    expect(r.units.length).toBe(21);
    expect(r.orphanMarks).toBe(0);
  });

  it('画像と照合済みの値', () => {
    expect(nowOf('助動詞', 'shall / should')).toBe('×');
    expect(nowOf('助動詞', 'must / have to')).toBe('△');
    expect(nowOf('未来の文', 'be going to ～ / will')).toBe('×');
    expect(nowOf('一般動詞（過去）', '規則動詞')).toBe('×');
    expect(nowOf('疑問詞', 'what＋名詞 / how many')).toBe('×');
    expect(nowOf('疑問詞', 'how')).toBe('●');
  });
});
