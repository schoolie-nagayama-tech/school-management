/**
 * AIヘルプの高校マスタ引き当て（src/lib/ai/schoolLookup.ts）。
 * 正典: docs/ai-help-school-lookup.md
 *
 * ★ここで固定しているのは「誤爆しない」「満点の違う数字を混ぜない」「県で語を変える」
 * 「場所で引いても遠い学校を近いと言わない」の4つ。
 *   どれも壊れると、AIが自信たっぷりに間違った数字を案内する。
 */
import { describe, expect, it } from 'vitest';
import {
  findByName,
  findByRange,
  lineAliases,
  matchSchools,
  parseAccessStations,
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
    lat: null,
    lon: null,
    primaryStation: null,
    primaryLines: null,
    accessLines: null,
    accessStations: null,
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

const IKEBUKURO = '西武鉄道 池袋線';

/** 場所で引くための都立（座標・駅は本番マスタの値をもとにした近似） */
const PLACES: SchoolMatch[] = [
  school({
    prefecture: '東京都',
    schoolName: '八王子東',
    municipality: '八王子市',
    hensachi: 63,
    naishin: 56,
    naishinMax: 65,
  }),
  school({
    prefecture: '東京都',
    schoolName: '八王子北',
    municipality: '八王子市',
    hensachi: 37,
    naishin: 37,
    naishinMax: 65,
  }),
  school({
    prefecture: '東京都',
    schoolName: '町田',
    municipality: '町田市',
    hensachi: 59,
    naishin: 52,
    naishinMax: 65,
  }),
  school({
    prefecture: '東京都',
    schoolName: '成瀬',
    municipality: '町田市',
    hensachi: 50,
    naishin: 44,
    naishinMax: 65,
  }),
  school({
    prefecture: '東京都',
    schoolName: '清瀬',
    municipality: '清瀬市',
    lat: 35.7739,
    lon: 139.5158,
    primaryStation: '清瀬',
    primaryLines: [IKEBUKURO],
    accessLines: [IKEBUKURO],
    accessStations: [{ name: '清瀬', m: 439 }],
    hensachi: 51,
    naishin: 45,
    naishinMax: 65,
  }),
  school({
    prefecture: '東京都',
    schoolName: '久留米西',
    municipality: '東久留米市',
    lat: 35.763,
    lon: 139.5105,
    primaryStation: '清瀬',
    primaryLines: [IKEBUKURO],
    accessLines: [IKEBUKURO],
    accessStations: [{ name: '清瀬', m: 1500 }],
    hensachi: 37,
    naishin: 36,
    naishinMax: 65,
  }),
  // 同じ沿線で清瀬駅からおよそ5km（2km圏の外）
  school({
    prefecture: '東京都',
    schoolName: '保谷',
    municipality: '西東京市',
    lat: 35.745,
    lon: 139.556,
    accessLines: [IKEBUKURO, '西武鉄道 新宿線'],
    accessStations: [{ name: 'ひばりヶ丘', m: 1200 }],
    hensachi: 47,
    naishin: 41,
    naishinMax: 65,
  }),
  // 同じ沿線でも清瀬駅から15km近く離れている（「近い」に入れてはいけない）
  school({
    prefecture: '東京都',
    schoolName: '武蔵丘',
    municipality: '中野区',
    lat: 35.717,
    lon: 139.67,
    accessLines: [IKEBUKURO],
    accessStations: [{ name: '沼袋', m: 900 }],
    hensachi: 49,
    naishin: 44,
    naishinMax: 65,
  }),
];

const ALL: SchoolMatch[] = [
  school({
    prefecture: '東京都',
    schoolName: '日比谷',
    oldDistrict: 1,
    municipality: '千代田区',
    accessLines: ['東京地下鉄 2号線日比谷線', '東京地下鉄 7号線南北線'],
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

describe('場所で引く（都立だけ）', () => {
  const names = (q: string) => matchSchools(q, PLACES).rows.map((s) => s.schoolName);

  it('市区町村で引く。「八王子」だけでも八王子市の学校が出る', () => {
    expect(names('八王子にある都立は？')).toEqual(['八王子東', '八王子北']);
    expect(names('八王子市の高校')).toEqual(['八王子東', '八王子北']);
    expect(matchSchools('八王子にある都立は？', PLACES).conditions[0]).toContain('八王子市');
  });

  it('★学校名と同じ地名は、ふつうは学校。「にある」などが付けば市区町村', () => {
    expect(names('町田の偏差値')).toEqual(['町田']);
    expect(names('町田にある都立')).toEqual(['町田', '成瀬']);
  });

  it('★「八王子北にある」は八王子北高校（「北」で北区や八王子市に取らない）', () => {
    expect(names('八王子北にある部活')).toEqual(['八王子北']);
  });

  it('★「清瀬駅」は駅、「清瀬の偏差値」は清瀬高校', () => {
    expect(names('清瀬の偏差値')).toEqual(['清瀬']);
    expect(names('清瀬駅から近い都立')).toEqual(['清瀬', '久留米西', '保谷']);
  });

  it('★駅から近い＝直線2km圏＋同じ沿線で直線およそ8km以内。沿線の反対側の学校は出さない', () => {
    const r = matchSchools('清瀬駅から近い都立', PLACES);
    expect(r.rows.map((s) => s.schoolName)).not.toContain('武蔵丘');
    const text = renderSchools(r);
    expect(text).toContain('清瀬駅まで直線439m');
    expect(text).toContain('清瀬駅まで直線1.5km');
    expect(text).toMatch(/保谷.*2km圏の外・同じ沿線（西武鉄道 池袋線）・駅からおよそ直線4\.\dkm/);
    expect(text).toContain('直線距離');
  });

  it('場所と偏差値を組み合わせる', () => {
    expect(names('清瀬駅から近くて偏差値50の高校は？')).toEqual(['清瀬']);
  });

  it('★帯に1校も無ければ、値の近い順に出して「帯には無い」と条件に書く', () => {
    const r = matchSchools('八王子にある都立で偏差値50', PLACES);
    expect(r.rows.map((s) => s.schoolName)).toEqual(['八王子東', '八王子北']);
    expect(r.conditions.join('／')).toContain('に入る学校は無い');
  });

  it('★路線で引く。「日比谷線」は路線で、学校の日比谷としては当てない', () => {
    const all = [...ALL, ...PLACES];
    const r = matchSchools('日比谷線沿いの都立', all);
    expect(r.rows.map((s) => s.schoolName)).toEqual(['日比谷']);
    expect(r.conditions[0]).toContain('日比谷線');
    // 路線で聞かれたら偏差値の高い順（駅の距離の並べ方はしない）
    expect(names('西武池袋線の都立')).toEqual(['清瀬', '武蔵丘', '保谷', '久留米西']);
  });

  it('★「中央大学」の中央は地名として当てない', () => {
    const r = matchSchools('中央大学附属の話', [
      ...PLACES,
      school({
        prefecture: '東京都',
        schoolName: '晴海総合',
        municipality: '中央区',
        hensachi: 47,
      }),
    ]);
    expect(r.rows).toEqual([]);
  });

  it('神奈川を場所で聞かれたら、データが無いことを伝える本文を渡す（黙らない）', () => {
    const r = matchSchools('横浜駅から近い県立', [...ALL, ...PLACES]);
    expect(r.rows).toEqual([]);
    expect(renderSchools(r)).toContain('所在地・最寄駅・沿線のデータがまだ');
  });
});

describe('路線と駅の読み方', () => {
  it('国土数値情報の路線名から、ふだんの呼び名を作る', () => {
    const a = lineAliases('東京地下鉄 5号線東西線');
    expect(a).toContain('東西線');
    expect(a).toContain('東京メトロ東西線');
    expect(lineAliases('西武鉄道 新宿線')).toContain('西武新宿線');
    expect(lineAliases('東京都 10号線新宿線')).toContain('都営新宿線');
  });

  it('★「本線」だけは会社名なしで当てない（京成本線と京急本線の取り違え）', () => {
    expect(lineAliases('京成電鉄 本線')).not.toContain('本線');
    expect(lineAliases('京成電鉄 本線')).toContain('京成線');
  });

  it('DBの `駅名(距離m)` を読む', () => {
    expect(parseAccessStations(['清瀬(439m)', '秋津'])).toEqual([
      { name: '清瀬', m: 439 },
      { name: '秋津', m: null },
    ]);
    expect(parseAccessStations(null)).toBe(null);
  });
});
