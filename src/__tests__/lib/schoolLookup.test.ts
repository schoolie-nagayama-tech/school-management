/**
 * AIヘルプの高校マスタ引き当て（src/lib/ai/schoolLookup.ts）。
 * 正典: docs/ai-help-school-lookup.md
 *
 * ★ここで固定しているのは「誤爆しない」「満点の違う数字を混ぜない」「県で語を変える」
 * 「場所で引いても遠い学校を近いと言わない」の4つ。
 *   どれも壊れると、AIが自信たっぷりに間違った数字を案内する。
 * ★私立・国立（末尾の describe）では「区分を取り違えない」「男女の偏差値を片方に寄せない」
 *   「基準は示すだけで判定しない」「受けられない区分（都神外生）を渡さない」を固定している。
 */
import { describe, expect, it } from 'vitest';
import {
  establishmentHint,
  findByName,
  findByRange,
  lineAliases,
  matchSchools,
  parseAccessStations,
  prefectureHint,
  renderSchools,
  summarizeHensachi,
  toAdmissionTexts,
  type SchoolMatch,
} from '@/lib/ai/schoolLookup';
import type { AdmissionRule } from '@/lib/interview/privateAdmission';

function school(
  p: Partial<SchoolMatch> & Pick<SchoolMatch, 'prefecture' | 'schoolName'>
): SchoolMatch {
  return {
    establishment: '公立',
    genderType: null,
    hensachiByGender: null,
    admission: [],
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

  it('★会社名で呼ぶ路線（「西武線」）は、その会社の全路線に当てる', () => {
    const r = matchSchools('西武線沿線　都立', PLACES);
    expect(r.rows.map((s) => s.schoolName)).toEqual(['清瀬', '武蔵丘', '保谷', '久留米西']);
    expect(r.conditions[0]).toContain('西武鉄道 新宿線');
  });

  it('★「京王線」は京王電鉄の京王線だけ（会社名の呼び方でもあるが、路線名が優先）', () => {
    const all = [
      school({
        prefecture: '東京都',
        schoolName: '神代',
        accessLines: ['京王電鉄 京王線'],
        hensachi: 54,
      }),
      school({
        prefecture: '東京都',
        schoolName: '芦花',
        accessLines: ['京王電鉄 井の頭線'],
        hensachi: 50,
      }),
    ];
    expect(matchSchools('京王線沿線の都立', all).rows.map((s) => s.schoolName)).toEqual(['神代']);
  });

  it('★同じ呼び名の路線は全部当てる（「新宿線」＝西武新宿線と都営新宿線）', () => {
    const all = [
      ...PLACES,
      school({
        prefecture: '東京都',
        schoolName: '新宿',
        accessLines: ['東京都 10号線新宿線'],
        hensachi: 63,
      }),
    ];
    const r = matchSchools('新宿線沿いの都立', all);
    expect(r.rows.map((s) => s.schoolName)).toEqual(['新宿', '保谷']);
    // 路線まで言えば、その路線だけ
    expect(matchSchools('都営新宿線沿いの都立', all).rows.map((s) => s.schoolName)).toEqual([
      '新宿',
    ]);
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
    // 神奈川は所在地のデータが後から入ったが、引き当てはまだ東京だけ（schoolLookup.ts 冒頭）
    expect(renderSchools(r)).toContain('場所の条件（市区町村・駅・沿線）で探せない');
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

describe('ふだんの言い方で聞かれても引ける（本番の質問ログより）', () => {
  const all = [...ALL, ...PLACES];
  const names = (q: string) => matchSchools(q, all).rows.map((s) => s.schoolName);

  it('★助詞をはさんだ数字・全角数字も拾う（「内申が３５くらい」）', () => {
    expect(names('八王子で内申が３５くらいの都立教えて')).toEqual(['八王子北']);
    expect(names('偏差値は５０くらい。町田で')).toEqual(['成瀬']);
  });

  it('★「都立」を付けなくても場所で引く（「偏差値50くらいの学校ある？八王子で」）', () => {
    const r = matchSchools('偏差値50くらいの学校ある？八王子で', all);
    expect(r.rows.map((s) => s.schoolName)).toEqual(['八王子東', '八王子北']);
    expect(r.conditions[0]).toContain('八王子市');
  });

  it('★学校名と同じ地名は「で」「の高校」なら場所、「の偏差値」なら学校', () => {
    expect(names('町田で偏差値50')).toEqual(['成瀬']);
    expect(names('清瀬の高校')).toEqual(['清瀬']);
    expect(matchSchools('清瀬の高校', all).conditions[0]).toContain('清瀬市');
    expect(matchSchools('清瀬の偏差値', all).conditions).toEqual([]);
  });

  it('「清瀬近くの高校」は駅として読む', () => {
    expect(matchSchools('清瀬近くの高校', all).stations).toEqual(['清瀬']);
  });

  it('★会社名だけの沿線（「西武沿線」「西武沿い」）', () => {
    expect(names('西武沿線で内申40')).toEqual(['保谷']);
    expect(names('西武沿いの学校')).toContain('清瀬');
  });

  it('「23区」「多摩地区」はまとめて引く', () => {
    expect(names('23区で偏差値49')).toEqual(['武蔵丘']);
    expect(names('多摩地区で偏差値63')).toEqual(['八王子東']);
    expect(matchSchools('多摩地区で偏差値63', all).conditions[0]).toContain('多摩地区');
  });

  it('★地名を冠した学校の略称（翠嵐）とあだ名（サイフロ）', () => {
    expect(names('翠嵐の内申')).toEqual(['横浜翠嵐']);
    expect(names('サイフロの偏差値')).toEqual(['市立横浜サイエンスフロンティア']);
  });

  it('「ヶ」と「が」「ケ」の書き分けをそろえる（ひばりが丘駅＝ひばりヶ丘）', () => {
    expect(matchSchools('ひばりが丘駅から近い都立', all).stations).toEqual(['ひばりヶ丘']);
    expect(matchSchools('ひばりケ丘駅の近く', all).stations).toEqual(['ひばりヶ丘']);
  });

  it('路線のふだんの呼び名（丸の内線・京浜東北線・埼京線）', () => {
    expect(lineAliases('東京地下鉄 4号線丸ノ内線')).toContain('丸の内線');
    expect(lineAliases('東日本旅客鉄道 東北線')).toContain('京浜東北線');
    expect(lineAliases('東日本旅客鉄道 赤羽線')).toContain('埼京線');
  });
});

// ─────────────────────────────────────────────────────────────
// 私立・国立（2026-09-28）
// ─────────────────────────────────────────────────────────────

function rule(
  p: Partial<AdmissionRule> & Pick<AdmissionRule, 'kind' | 'examLabel'>
): AdmissionRule {
  return {
    id: `r-${p.examLabel}`,
    publicOnly: false,
    applicantScope: null,
    gender: null,
    strength: null,
    body: { any: [], gates: [], bonus: null, no_criterion: null },
    checks: [],
    rawText: '',
    sourceLabel: '私立 推薦・一般入試の基準表 テスト版',
    verifiedAt: null,
    sortOrder: 0,
    ...p,
  };
}

/** 本番の淑徳巣鴨（特進）の形をもとにした基準（数値はテスト用） */
const TOKUSHIN_RULES: AdmissionRule[] = [
  rule({
    kind: '推薦',
    examLabel: 'A推薦',
    body: {
      any: [[{ t: 'sum', s: '5科', min: 19 }]],
      gates: [{ t: 'none_le', s: '9科', grade: 1 }],
      bonus: {
        max: 3,
        items: [{ label: '英・漢・数検準2級（各）', points: 1 }],
      },
      no_criterion: null,
    },
    checks: ['推薦基礎力検査（3科）'],
    sortOrder: 1,
  }),
  // ★東京・神奈川の生徒は受けられない区分。AIに渡してはいけない
  rule({
    kind: '併願',
    examLabel: 'B推薦（併願，都神外生）',
    applicantScope: '都神外生',
    body: { any: [[{ t: 'sum', s: '5科', min: 22 }]], gates: [], bonus: null, no_criterion: null },
    sortOrder: 2,
  }),
  rule({
    kind: '併願',
    examLabel: '併願（公私）',
    body: {
      any: [[{ t: 'sum', s: '5科', min: 22 }], [{ t: 'sum', s: '9科', min: 38 }]],
      gates: [{ t: 'none_le', s: '9科', grade: 1 }],
      bonus: null,
      no_criterion: null,
    },
    checks: ['3年次の欠席 各9回以内'],
    sortOrder: 3,
  }),
];

const PRIVATE: SchoolMatch[] = [
  school({
    prefecture: '東京都',
    schoolName: '淑徳巣鴨',
    establishment: '私立',
    genderType: '共学',
    course: '特進',
    municipality: '豊島区',
    sourceLabel: 'Vもぎ 私立 テスト版',
    hensachi: null,
    hensachiByGender: { 男子: 57, 女子: 60 },
    verifiedAt: null,
    admission: toAdmissionTexts(TOKUSHIN_RULES),
  }),
  school({
    prefecture: '東京都',
    schoolName: '淑徳巣鴨',
    establishment: '私立',
    genderType: '共学',
    course: '選抜',
    municipality: '豊島区',
    sourceLabel: 'Vもぎ 私立 テスト版',
    hensachi: 59,
    hensachiByGender: { 男子: 59, 女子: 59 },
    verifiedAt: null,
    admission: toAdmissionTexts(TOKUSHIN_RULES),
  }),
  // 県名と同じ名前の私立（「東京の私立は」で当ててはいけない）
  school({
    prefecture: '東京都',
    schoolName: '東京',
    establishment: '私立',
    genderType: '共学',
    sourceLabel: 'Vもぎ 私立 テスト版',
    hensachi: 50,
    hensachiByGender: { 男子: 50, 女子: 50 },
    verifiedAt: null,
  }),
  // 名前に「東京」を含む埼玉の私立（県のヒントで自分自身を落とさない）
  school({
    prefecture: '埼玉県',
    schoolName: '東京農大三',
    establishment: '私立',
    genderType: '共学',
    sourceLabel: 'Vもぎ 私立 テスト版',
    hensachi: 55,
    verifiedAt: null,
  }),
  // ★架空。公立と同じ名前の私立（両方を区分つきで出すことを確かめる）
  school({
    prefecture: '東京都',
    schoolName: '上野',
    establishment: '私立',
    genderType: '女子',
    course: '普通',
    sourceLabel: 'Vもぎ 私立 テスト版',
    hensachi: 52,
    hensachiByGender: { 女子: 52 },
    verifiedAt: null,
  }),
  // 清瀬駅の近くの私立（架空）。駅の距離は単位なしで入っている
  school({
    prefecture: '東京都',
    schoolName: '清瀬学園',
    establishment: '私立',
    genderType: '共学',
    municipality: '清瀬市',
    lat: 35.772,
    lon: 139.52,
    accessLines: [IKEBUKURO],
    accessStations: parseAccessStations(['清瀬(300)']),
    sourceLabel: 'Vもぎ 私立 テスト版',
    hensachi: 45,
    verifiedAt: null,
  }),
  // 国立（めやすの行が無く、推薦の基準だけがある）
  school({
    prefecture: '東京都',
    schoolName: '筑波大附属',
    establishment: '国立',
    sourceLabel: '',
    sourceYear: 0,
    verifiedAt: null,
    admission: toAdmissionTexts([
      rule({
        kind: '推薦',
        examLabel: '推薦',
        strength: '出願資格',
        body: {
          any: [[{ t: 'sum', s: '9科', min: 40 }]],
          gates: [],
          bonus: null,
          no_criterion: null,
        },
        verifiedAt: '2026-09-25T00:00:00Z',
      }),
    ]),
  }),
];

describe('私立・国立', () => {
  const all = [...ALL, ...PLACES, ...PRIVATE];
  const rows = (q: string) =>
    matchSchools(q, all).rows.map(
      (s) => `${s.establishment} ${s.schoolName}${s.course ? `（${s.course}）` : ''}`
    );

  it('私立の駅の距離（単位なし「矢部(617)」）もメートルとして読む', () => {
    expect(parseAccessStations(['矢部(617)', '清瀬(850m)'])).toEqual([
      { name: '矢部', m: 617 },
      { name: '清瀬', m: 850 },
    ]);
  });

  it('★男女で偏差値が違えば1つに寄せない。同じなら1つ。片方の表だけならその値', () => {
    expect(
      summarizeHensachi([
        { gender: '男子', hensachi: 57 },
        { gender: '女子', hensachi: 60 },
      ])
    ).toEqual({ hensachi: null, byGender: { 男子: 57, 女子: 60 } });
    expect(
      summarizeHensachi([
        { gender: '男子', hensachi: 59 },
        { gender: '女子', hensachi: 59 },
      ]).hensachi
    ).toBe(59);
    expect(summarizeHensachi([{ gender: '男子', hensachi: 65 }]).hensachi).toBe(65);
    expect(summarizeHensachi([{ gender: null, hensachi: 69 }])).toEqual({
      hensachi: 69,
      byGender: null,
    });
  });

  it('★東京・神奈川の生徒が受けられない区分（都神外生）は基準から外す', () => {
    const texts = toAdmissionTexts(TOKUSHIN_RULES);
    expect(texts.map((t) => t.heading)).toEqual(['A推薦', '併願（公私）']);
    expect(texts[1].criterion).toBe('5科22または9科38');
    expect(texts[1].conditions).toContain('9科に1は不可');
    expect(texts[1].verified).toBe(false);
  });

  it('設置区分のヒント。「国立」だけでは区分とみなさない（都立国立・国立市）', () => {
    expect(establishmentHint('私立で偏差値60')).toEqual(['私立']);
    expect(establishmentHint('八王子にある都立')).toEqual(['公立']);
    expect(establishmentHint('国立大附属の推薦')).toEqual(['国立']);
    expect(establishmentHint('国立の偏差値')).toBe(null);
  });

  it('学校名で引くと、コースごとの行が全部出る', () => {
    expect(rows('淑徳巣鴨の偏差値')).toEqual(['私立 淑徳巣鴨（特進）', '私立 淑徳巣鴨（選抜）']);
  });

  it('★同じ名前の公立と私立は両方出す。「私立」「都立」と言われたらそれだけ', () => {
    expect(rows('上野の偏差値')).toEqual(['公立 上野', '私立 上野（普通）']);
    expect(rows('私立の上野の偏差値')).toEqual(['私立 上野（普通）']);
    expect(rows('都立上野の偏差値')).toEqual(['公立 上野']);
  });

  it('★県名と同じ名前の私立は「◯◯高」「私立◯◯」の形のときだけ当てる', () => {
    expect(findByName('東京の私立の入試相談っていつ', all)).toEqual([]);
    expect(findByName('東京高校の偏差値', all).map((s) => s.schoolName)).toEqual(['東京']);
  });

  it('★名前に「東京」を含む他県の私立を、県のヒントで落とさない', () => {
    expect(rows('東京農大三の偏差値')).toEqual(['私立 東京農大三']);
  });

  it('偏差値の範囲で私立も引く。男女で違う学校はどちらかの表で帯に入れば出す', () => {
    const r = matchSchools('偏差値60くらいの私立', all);
    expect(r.rows.map((s) => s.course)).toEqual(['特進', '選抜']);
    expect(r.conditions.join('／')).toContain('設置区分が 私立');
    // 都立と言われたら私立を混ぜない
    expect(findByRange('偏差値57くらいの都立', all).every((s) => s.establishment === '公立')).toBe(
      true
    );
  });

  it('★私立を内申の数字で探そうとしたら、探せないと伝える本文を渡す', () => {
    const r = matchSchools('内申30で行ける私立は？', all);
    expect(r.rows).toEqual([]);
    expect(renderSchools(r)).toContain('私立高校は内申の数字では探せない');
  });

  it('場所で引くと東京の私立も入る。「都立」と言われたら私立を混ぜない', () => {
    expect(rows('清瀬駅から近い私立')).toEqual(['私立 清瀬学園']);
    expect(rows('清瀬駅から近い都立')).not.toContain('私立 清瀬学園');
    const text = renderSchools(matchSchools('清瀬駅から近い私立', all));
    expect(text).toContain('清瀬駅まで直線300m');
  });

  it('★本文: 区分・コース・男女別の偏差値・基準・未突合を書き、受けられない区分は書かない', () => {
    const t = renderSchools(matchSchools('淑徳巣鴨の併願優遇', all));
    expect(t).toContain('東京都 私立 淑徳巣鴨（特進）');
    expect(t).toContain('偏差値 男子57・女子60');
    expect(t).toContain('偏差値 59');
    expect(t).toContain('併願（公私）: 内申 5科22または9科38');
    expect(t).toContain('条件 9科に1は不可');
    expect(t).toContain('加点 英・漢・数検準2級（各）+1（上限+3）');
    expect(t).toContain('ほかに確認 3年次の欠席 各9回以内');
    expect(t).toContain('紙と未突合');
    expect(t).not.toContain('都神外生');
    // 判定はしない（生徒の内申は渡していない）
    expect(t).toContain('判定しない');
    expect(t).not.toMatch(/届いている|届かない/);
  });

  it('片方の表しかない学校は、どちらの表かを書く', () => {
    expect(renderSchools(matchSchools('私立の上野', all))).toContain('偏差値 52（女子の表）');
  });

  it('公立の行にも区分を書く（従来の数字はそのまま）', () => {
    const t = renderSchools(matchSchools('日比谷の偏差値', all));
    expect(t).toContain('東京都 公立 日比谷');
    expect(t).toContain('換算内申 61/65');
    // 私立が混ざらないときは私立の読み方の注意を足さない（プロンプトを膨らませない）
    expect(t).not.toContain('推薦・併願優遇');
  });

  it('国立はめやすが無くても基準で答える。資料が無いことを書く', () => {
    const t = renderSchools(matchSchools('筑波大附属の推薦', all));
    expect(t).toContain('東京都 国立 筑波大附属 偏差値 資料なし');
    expect(t).toContain('出典: めやすの資料なし');
    expect(t).toContain('推薦: 内申 9科40（出願資格）');
    expect(t).not.toMatch(/推薦: .*紙と未突合/);
  });
});
