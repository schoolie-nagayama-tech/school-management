/**
 * AIヘルプの高校マスタ引き当て（src/lib/ai/schoolLookup.ts）。
 * 正典: docs/ai-help-school-lookup.md
 *
 * ★ここで固定しているのは「誤爆しない」「満点の違う数字を混ぜない」「県で語を変える」の3つ。
 *   どれも壊れると、AIが自信たっぷりに間違った数字を案内する。
 */
import { describe, expect, it } from 'vitest';
import {
  findByName,
  findByRange,
  matchSchools,
  prefectureHint,
  renderSchools,
  type SchoolMatch,
} from '@/lib/ai/schoolLookup';

function school(
  p: Partial<SchoolMatch> & Pick<SchoolMatch, 'prefecture' | 'schoolName'>
): SchoolMatch {
  return {
    course: '',
    category: '普通科',
    region: null,
    oldDistrict: null,
    municipality: null,
    accessLines: null,
    sourceLabel: 'テスト版',
    sourceYear: 2027,
    totalScore: null,
    naishin: null,
    naishinMax: null,
    hensachi: null,
    examType: null,
    gakuryokuRatio: null,
    note: null,
    verifiedAt: '2026-09-22T00:00:00Z',
    ...p,
  };
}

const ALL: SchoolMatch[] = [
  school({
    prefecture: '東京都',
    schoolName: '日比谷',
    oldDistrict: 1,
    totalScore: 920,
    naishin: 61,
    naishinMax: 65,
    hensachi: 69,
    examType: '自校作成',
    gakuryokuRatio: '7:3',
  }),
  school({
    prefecture: '東京都',
    schoolName: '西',
    oldDistrict: 3,
    totalScore: 900,
    naishin: 59,
    naishinMax: 65,
    hensachi: 68,
  }),
  school({
    prefecture: '東京都',
    schoolName: '東',
    oldDistrict: 6,
    totalScore: 665,
    naishin: 43,
    naishinMax: 65,
    hensachi: 49,
  }),
  school({
    prefecture: '東京都',
    schoolName: '国立',
    oldDistrict: 10,
    totalScore: 900,
    naishin: 60,
    naishinMax: 65,
    hensachi: 67,
  }),
  school({
    prefecture: '東京都',
    schoolName: '上野',
    oldDistrict: 5,
    totalScore: 785,
    naishin: 51,
    naishinMax: 65,
    hensachi: 57,
  }),
  school({
    prefecture: '東京都',
    schoolName: '駒場',
    course: '保健体育',
    totalScore: 705,
    naishin: 55,
    naishinMax: 75,
    hensachi: 51,
  }),
  school({
    prefecture: '神奈川県',
    schoolName: '横浜翠嵐',
    region: '横浜東部・北部・川崎地区',
    sourceLabel: '合格基準一覧表 2026年度',
    sourceYear: 2026,
    totalScore: 928,
    naishin: 124,
    naishinMax: 135,
    hensachi: 72,
    verifiedAt: null,
  }),
  school({
    prefecture: '神奈川県',
    schoolName: '市立横浜サイエンスフロンティア',
    course: '理数',
    sourceYear: 2026,
    totalScore: 897,
    naishin: 119,
    naishinMax: 135,
    hensachi: 69,
    verifiedAt: null,
  }),
  school({
    prefecture: '神奈川県',
    schoolName: '市立横浜総合',
    course: '総合学科Ⅰ部',
    sourceYear: 2026,
    totalScore: 413,
    naishin: 61,
    naishinMax: 135,
    hensachi: 36,
    verifiedAt: null,
  }),
  school({
    prefecture: '神奈川県',
    schoolName: '上溝',
    sourceYear: 2026,
    totalScore: 612,
    naishin: null,
    naishinMax: null,
    hensachi: 48,
    verifiedAt: null,
  }),
];

describe('学校名で引く', () => {
  it('3文字以上の名前は質問文に出ていれば当たる', () => {
    expect(findByName('日比谷の偏差値は？', ALL).map((s) => s.schoolName)).toEqual(['日比谷']);
    expect(findByName('横浜翠嵐の内申どれくらい', ALL).map((s) => s.schoolName)).toEqual([
      '横浜翠嵐',
    ]);
  });

  it('市立・県立・都立を外した呼び方でも当たる', () => {
    const r = findByName('横浜サイエンスフロンティアの基準', ALL);
    expect(r.map((s) => s.schoolName)).toEqual(['市立横浜サイエンスフロンティア']);
  });

  it('★1文字の名前は、ふつうの文では当たらない（誤爆しない）', () => {
    expect(findByName('東京の私立の入試相談っていつ', ALL)).toEqual([]);
    expect(findByName('西口の教室はどこ', ALL)).toEqual([]);
  });

  it('★1文字の名前は「◯◯高」「都立◯◯」の形なら当たる', () => {
    expect(findByName('都立西の偏差値', ALL).map((s) => s.schoolName)).toEqual(['西']);
    expect(findByName('東高の内申', ALL).map((s) => s.schoolName)).toEqual(['東']);
  });

  it('★2文字の名前は文脈なしで当たる（戸山・湘南・上溝など一番聞かれる学校が2文字）', () => {
    expect(findByName('上溝の内申', ALL).map((s) => s.schoolName)).toEqual(['上溝']);
    expect(findByName('上野ってどれくらい', ALL).map((s) => s.schoolName)).toEqual(['上野']);
  });

  it('★「国立大学」の国立には当てない。「国立の偏差値」には当てる', () => {
    expect(findByName('国立大学を目指す生徒の志望校', ALL)).toEqual([]);
    expect(findByName('国立の偏差値', ALL).map((s) => s.schoolName)).toEqual(['国立']);
  });

  it('長い名前を先に当て、その一部の短い名前では重ねて拾わない', () => {
    const r = findByName('市立横浜総合のⅠ部', ALL);
    expect(r.map((s) => s.schoolName)).toEqual(['市立横浜総合']);
  });
});

describe('範囲で引く', () => {
  it('偏差値±2の帯で引き、県で絞る', () => {
    const r = findByRange('偏差値55くらいの都立ってどこ', ALL);
    expect(r.map((s) => s.schoolName)).toEqual(['上野']);
  });

  it('★内申の数字が65以下なら65/75点満点の行だけ（神奈川の135点満点を混ぜない）', () => {
    // 市立横浜総合の基準内申 61/135 は「内申60」に近いが、満点が違うので出してはいけない
    const r = findByRange('内申60くらいで行ける高校', ALL);
    expect(r.every((s) => s.naishinMax !== 135)).toBe(true);
    expect(r.map((s) => s.schoolName)).toContain('日比谷');
  });

  it('★内申の数字が66以上なら135点満点の行だけ', () => {
    const r = findByRange('内申123くらいの高校', ALL);
    expect(r.every((s) => s.naishinMax === 135)).toBe(true);
    // 翠嵐124（差1）は入り、SFF119（差4）は帯の外
    expect(r.map((s) => s.schoolName)).toEqual(['横浜翠嵐']);
  });

  it('数字が無ければ引かない', () => {
    expect(findByRange('おすすめの高校は', ALL)).toEqual([]);
  });
});

describe('県のヒント', () => {
  it('都立・東京なら東京都、神奈川・県立・横浜などなら神奈川県、両方か無しなら絞らない', () => {
    expect(prefectureHint('都立の話')).toBe('東京都');
    expect(prefectureHint('神奈川の話')).toBe('神奈川県');
    expect(prefectureHint('横浜の高校')).toBe('神奈川県');
    expect(prefectureHint('東京と神奈川の違い')).toBe(null);
    expect(prefectureHint('入試の話')).toBe(null);
  });
});

describe('回答に渡す本文', () => {
  it('★東京は「総合得点」、神奈川は「基準S1値」。同じ語で書かない', () => {
    const t = renderSchools(matchSchools('日比谷の偏差値', ALL));
    const k = renderSchools(matchSchools('横浜翠嵐の偏差値', ALL));
    expect(t).toContain('総合得点 920/1000');
    expect(t).toContain('換算内申 61/65');
    expect(t).toContain('偏差値 69');
    expect(k).toContain('基準S1値 928/1000');
    expect(k).toContain('基準内申 124/135');
    expect(k).toContain('偏差値 72');
  });

  it('★人間が紙と突き合わせていない版には「紙と未突合」を付ける', () => {
    expect(renderSchools(matchSchools('日比谷', ALL))).not.toContain('紙と未突合');
    expect(renderSchools(matchSchools('横浜翠嵐', ALL))).toContain('紙と未突合');
  });

  it('読めていない内申は「未確認」と書く（0点や空欄にしない）', () => {
    const r = renderSchools(matchSchools('上溝の内申', ALL));
    expect(r).toContain('内申 未確認');
  });

  it('当たらなければ空文字（プロンプトに見出しだけ残さない）', () => {
    expect(renderSchools([])).toBe('');
  });
});
