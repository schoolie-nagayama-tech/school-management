/**
 * AIヘルプの2つ目の材料 — 高校マスタの引き当て。
 *
 * ★ここは純関数だけ。DBの読み込みは schoolMaster.ts（server-only）が行う。
 *   faqIndex.ts と同じ分け方（引き当ての決まりをテストから直接触れるようにするため）。
 *
 * ★学校ごとの数字を faqData.ts に書かない、と決めた代わりがここ。
 *   FAQ本文に書くと (1) 見出しカタログが400校ぶん膨らむ (2) 数字がソースコードに凍って
 *   毎年の差し替えがPRになる (3) high_school_standards の版管理（source_year・verified_at）が
 *   二重管理になる。マスタは既に版と出典を持っているので、そこを読む。
 *   正典: docs/ai-help-school-lookup.md ／ データ: docs/data/README.md
 *
 * ★渡すのは学校の公開情報だけ。生徒・保護者の情報は一切触らない。
 *   AIヘルプが「個人情報を送らない唯一のAI機能」である性質は、この追加でも変わらない。
 *
 * ★東京と神奈川で数字の意味が違う。ラベルはここで県ごとに出し分ける（renderSchools）。
 *   DBの total_score 列は、東京では「総合得点」、神奈川では「基準S1値」。
 *   同じ1000点満点でも算出法が違うので、県をまたいで比べさせない。
 *
 * ★場所（市区町村・駅・沿線）で引けるのは東京だけ（都立・私立・国立とも）。
 *   神奈川は所在地のデータが後から入ったが、市区町村が「横浜市港北区」の形で、
 *   東京の「北区」「中央区」と呼び名がぶつかる。読み分けを作るまで場所では引かない。
 *
 * ★私立・国立も引く（2026-09-28）。都立・県立との違いは3つ。
 *   (1) 同じ学校でもコースごとに行がある（淑徳巣鴨（特進）・淑徳巣鴨（選抜）…）
 *   (2) 偏差値は男子表・女子表で別の行（hensachiByGender）。片方に寄せない
 *   (3) 内申のめやすは無く、代わりに推薦・併願優遇の基準（admission）がある。
 *       ★基準を示すだけで、生徒の内申に当てて判定はしない（生徒の情報を送らないため）。
 */

import {
  ruleConditionChips,
  ruleCriterionText,
  ruleHeading,
  scopeApplies,
  type AdmissionRule,
} from '@/lib/interview/privateAdmission';

/** 設置区分。high_schools.establishment と同じ値 */
export type Establishment = '公立' | '私立' | '国立';

/** 男女別の偏差値。私立の偏差値表は男子表・女子表で別 */
export type HensachiByGender = { 男子?: number; 女子?: number };

/**
 * 推薦・併願優遇の基準1区分を、AIに渡せる文にしたもの（toAdmissionText）。
 * ★文にしてから持つ。式（AdmissionRule）のまま持つと、渡す側が式を読み違える余地が残る。
 */
export interface AdmissionText {
  /** 区分の見出し（「A推薦」「併願（公私）」「B推薦（併願，都神外生）（女子）」） */
  heading: string;
  /** 内申の基準（「5科22」「5科21または9科38」「内申基準なし（学力重視）」） */
  criterion: string;
  /** 数値の強さ（出願資格／出願基準／目安）。冊子に無ければ null */
  strength: string | null;
  /** 前提・条件の札（「公立併願のみ」「9科に1は不可」「英検準2級」） */
  conditions: string[];
  /** 加点（「英・漢・数検準2級（各）+1」…）。無ければ null */
  bonus: string | null;
  /** 式にできない確認事項（欠席日数・面接・作文…） */
  checks: string[];
  sourceLabel: string;
  /** false＝紙の原本と未照合（AIの書き起こしのまま） */
  verified: boolean;
}

/** 学校から通える駅と、そこまでの直線距離 */
export interface StationDistance {
  name: string;
  /** 直線距離（m）。公式案内で手入力した駅は距離が無いことがある */
  m: number | null;
}

/** 1校×1学科ぶん。最新年度のめやすを添えたもの */
export interface SchoolMatch {
  prefecture: string;
  schoolName: string;
  /** 設置区分。★同名の公立と私立がありうるので、答えには必ず添える */
  establishment: Establishment;
  /** 共学・男子校・女子校（私立のみ入る。公立は null） */
  genderType: string | null;
  /** ★空文字＝普通科の本体（NULLではない） */
  course: string;
  category: string;
  /** 神奈川の資料上の地区。都立は null */
  region: string | null;
  /** 都立の旧学区（1〜10）。神奈川は null */
  oldDistrict: number | null;
  municipality: string | null;
  /** 学校の緯度経度（東京のみ）。沿線の学校が駅からどれくらい離れているかの目安に使う */
  lat: number | null;
  lon: number | null;
  /** ★直線距離で出した最寄駅。保護者向けの「最寄駅」としては使えない（docs/data/README.md） */
  primaryStation: string | null;
  /** 主たる最寄駅に乗り入れる全路線（`運営会社 路線名`） */
  primaryLines: string[] | null;
  /** 通える駅の全路線。沿線での絞り込みはこれを使う */
  accessLines: string[] | null;
  /** 直線2km圏の駅（公式案内で上書きした学校は、その案内の駅） */
  accessStations: StationDistance[] | null;
  sourceLabel: string;
  sourceYear: number;
  /** 東京＝総合得点／神奈川＝基準S1値。どちらも1000点満点だが算出法が違う */
  totalScore: number | null;
  naishin: number | null;
  /** 東京 65/75/52 ／ 神奈川は常に 135 */
  naishinMax: number | null;
  /**
   * 偏差値。★私立で男子表・女子表の値が違うときは null にして hensachiByGender に両方を持つ
   * （targetSchools.ts と同じ決まり。どちらかに寄せると半分の生徒に違う表の数字を言う）
   */
  hensachi: number | null;
  /** 男女別の偏差値（私立）。公立は null */
  hensachiByGender: HensachiByGender | null;
  examType: string | null;
  gakuryokuRatio: string | null;
  note: string | null;
  /** null＝人間が紙と突き合わせていない。答えに必ず添える */
  verifiedAt: string | null;
  /** 推薦・併願優遇の基準（私立・国立の最新年度）。公立は空 */
  admission: AdmissionText[];
}

/** 質問に出た駅の路線と、およその位置 */
export interface StationInfo {
  name: string;
  lines: string[];
  /** ★駅の座標は持っていない。その駅にいちばん近い学校の座標で代える（誤差はその学校までの距離） */
  lat: number | null;
  lon: number | null;
}

/** 引き当ての結果。行と、何の条件で引いたか */
export interface SchoolLookup {
  rows: SchoolMatch[];
  /** 回答に渡す「探した条件」。場所や範囲で引いたときだけ入る */
  conditions: string[];
  /** 質問に出た駅（距離を添えるのに使う） */
  stations: string[];
  /** その駅の路線とおよその位置（「同じ沿線」を添えるのに使う） */
  stationInfo: StationInfo[];
  /** 行が無いときに、黙らずに伝えること（神奈川を場所で聞かれたとき） */
  notice: string | null;
}

/** 1回の質問で渡す上限。これ以上並べても読む側が追えないし、プロンプトが膨らむ */
export const MAX_SCHOOLS = 24;
/** 範囲で引いたときの帯の広さ（偏差値・内申とも ±この値） */
const BAND = 2;
/** 場所で絞ったあと帯に1校も入らなかったとき、近い順に出す数 */
const NEAREST = 5;
/**
 * 駅で聞かれたとき、2km圏の外でも同じ沿線なら出す範囲（直線km）。
 * ★これが無いと「清瀬駅から近い」に、西武池袋線の反対側の中野区の学校まで並ぶ。
 */
const ALONG_KM = 8;

/**
 * 「DB の text[]（`清瀬(850m)`）」を距離つきの配列にする。
 * ★私立の行は単位なし（`矢部(617)`）で入っている。どちらもメートルとして読む。
 *   単位つきだけを読むと、私立の駅がすべて「距離なし」になり、駅から近い順に並ばない。
 */
export function parseAccessStations(raw: string[] | null): StationDistance[] | null {
  if (!raw || raw.length === 0) return null;
  return raw.map((x) => {
    const m = x.match(/^(.+?)\((\d+)m?\)$/);
    return m ? { name: m[1], m: Number(m[2]) } : { name: x, m: null };
  });
}

/**
 * 質問が県を名指ししていればそれを返す。2つ以上・どれでもなければ null。
 * ★私立は埼玉・千葉などの学校も入っているので、その県名も読む。
 */
const PREFECTURE_HINTS: [string, RegExp][] = [
  ['東京都', /都立|東京/],
  // ★「県立」だけでは神奈川と断定しない（他県の話かもしれない）が、
  //   公立は都立と神奈川県立しか入っていないので、神奈川として扱ってよい。
  ['神奈川県', /神奈川|県立|横浜|川崎|相模原|横須賀|藤沢|厚木|平塚|小田原/],
  ['埼玉県', /埼玉/],
  ['千葉県', /千葉/],
  ['茨城県', /茨城/],
  ['栃木県', /栃木/],
  ['山梨県', /山梨/],
];
export function prefectureHint(question: string): string | null {
  const hits = PREFECTURE_HINTS.filter(([, re]) => re.test(question)).map(([p]) => p);
  return hits.length === 1 ? hits[0] : null;
}

/**
 * 質問が設置区分を名指ししていればそれを返す。どれでもなければ null（絞らない）。
 * ★「国立」は学校名（都立国立）と地名（国立市）でもあるので、それだけでは区分とみなさない。
 *   「国立大附属」「国公立」「国立校」「国立・私立」のように、区分と分かる形のときだけ。
 * ★「都立」「県立」「市立」は公立。「都立で」と言われたら私立を混ぜない
 *   （「八王子にある都立」に私立が並ぶと、私立を都立として案内してしまう）。
 */
export function establishmentHint(question: string): Establishment[] | null {
  const out: Establishment[] = [];
  if (/私立|私学/.test(question)) out.push('私立');
  if (/都立|県立|市立|公立/.test(question)) out.push('公立');
  if (/国立大学?(?:附属|付属)|国立の(?:附属|付属)|国立校|国公立|国立・|・国立/.test(question)) {
    out.push('国立');
  }
  return out.length > 0 ? out : null;
}

/** 区分の絞り込み。ヒントが無ければ全部 */
function establishmentOk(s: SchoolMatch, hint: Establishment[] | null) {
  return !hint || hint.includes(s.establishment);
}

/** 並べ替え・帯の判定に使う偏差値。男女で違うときは両方 */
function hensachiValues(s: SchoolMatch): number[] {
  if (s.hensachi != null) return [s.hensachi];
  const g = s.hensachiByGender;
  if (!g) return [];
  return [g.男子, g.女子].filter((v): v is number => v != null);
}

/** 偏差値の高い順に並べるときの鍵（男女で違えば高いほう） */
function hensachiTop(s: SchoolMatch): number {
  const v = hensachiValues(s);
  return v.length ? Math.max(...v) : 0;
}

// ─────────────────────────────────────────────────────────────
// 私立の基準・偏差値を文にする（schoolMaster.ts から使う純関数）
// ─────────────────────────────────────────────────────────────

/**
 * 最新年度のめやすの行（男女別を含む）から、偏差値を1つ、または男女別にまとめる。
 * ★targetSchools.ts の hensachiOf と同じ決まり。男女共通（gender=NULL）の行があればそれ、
 *   男女の値が同じなら1つ、違えば null にして男女別を見る。
 */
export function summarizeHensachi(
  rows: { gender: '男子' | '女子' | null; hensachi: number | null }[]
): { hensachi: number | null; byGender: HensachiByGender | null } {
  const byGender: HensachiByGender = {};
  for (const r of rows) if (r.gender && r.hensachi != null) byGender[r.gender] = r.hensachi;
  const hasGender = byGender.男子 != null || byGender.女子 != null;
  const common = rows.find((r) => r.gender == null)?.hensachi;
  if (common != null) return { hensachi: common, byGender: hasGender ? byGender : null };
  const values = Array.from(new Set([byGender.男子, byGender.女子].filter((v) => v != null)));
  return {
    hensachi: values.length === 1 ? (values[0] as number) : null,
    byGender: hasGender ? byGender : null,
  };
}

/**
 * 基準の式を、AIに渡す文に。privateAdmission.ts の読み（面談の表と同じ言葉）を使う。
 * ★ここでは判定しない。生徒の内申に当てるのは面談ワークスペースだけ（生徒の情報を送らないため）。
 */
export function toAdmissionText(rule: AdmissionRule): AdmissionText {
  const b = rule.body.bonus;
  const bonus =
    b && b.items.length > 0
      ? b.items.map((i) => `${i.label}+${i.points}`).join('、') +
        (b.max != null ? `（上限+${b.max}）` : '') +
        (b.note ? `／${b.note}` : '')
      : null;
  const heading = rule.applicantScope
    ? `${ruleHeading(rule)}［${rule.applicantScope}］`
    : ruleHeading(rule);
  return {
    heading,
    criterion: ruleCriterionText(rule),
    strength: rule.strength,
    conditions: ruleConditionChips(rule),
    bonus,
    checks: rule.checks,
    sourceLabel: rule.sourceLabel,
    verified: rule.verifiedAt != null,
  };
}

/**
 * 1校ぶんの基準を文の列に。
 * ★東京・神奈川のどちらの生徒も受けられない区分（「都神外生」＝埼玉・千葉の生徒向けの推薦など）は外す。
 *   NESTの教室は東京と神奈川だけ。渡すと、受けられない区分の基準をそのまま案内してしまう。
 */
export function toAdmissionTexts(rules: readonly AdmissionRule[]): AdmissionText[] {
  return rules
    .filter(
      (r) => scopeApplies(r.applicantScope, 'tokyo') || scopeApplies(r.applicantScope, 'kanagawa')
    )
    .map(toAdmissionText);
}

// ─────────────────────────────────────────────────────────────
// 質問文から語を拾う共通の道具
// ─────────────────────────────────────────────────────────────

/**
 * 質問と名前の表記をそろえる。
 *   - 全角数字→半角（IMEのまま「偏差値５０」と打たれる）、全角空白→半角
 *   - 漢字・ひらがなと漢字にはさまれた「ケ」「ヵ」→「ヶ」（緑ケ丘／緑ヶ丘、ひばりケ丘／ひばりヶ丘）。
 *     カタカナ語（ケース等）の「ケ」は前後が漢字・ひらがなにならないので変わらない
 * ★「が」は助詞と区別できないので質問側では直さない。名前の側に「が」の別名を足す（kanaVariants）。
 */
export function normalizeText(s: string): string {
  return s
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/　/g, ' ')
    .replace(/([ぁ-ん一-鿿])[ケヵ](?=[一-鿿])/g, '$1ヶ');
}

/** 「ヶ」を含む名前は「が」でも書かれる（ひばりヶ丘→ひばりが丘） */
function kanaVariants(name: string): string[] {
  const n = normalizeText(name);
  return n.includes('ヶ') ? [n, n.replace(/ヶ/g, 'が')] : [n];
}

/**
 * 当たった語を伏せ字にして返す。
 * ★先に当てた語を伏せてから次の種類を当てる。「日比谷線」を路線で当てたあと、
 *   同じ文字列の「日比谷」を学校名で拾い直さないため。「清瀬駅」の清瀬も同じ。
 */
function mask(q: string, at: number, len: number) {
  return q.slice(0, at) + '＿'.repeat(len) + q.slice(at + len);
}

interface Alias {
  alias: string;
  key: string;
}

/** 長い別名から順に当て、当たったキーと伏せ字にした質問を返す */
function takeHits(
  q: string,
  aliases: Alias[],
  accept: (after: string) => boolean = () => true
): { q: string; keys: string[] } {
  // ★同じ呼び名が複数のキーを指すことがある（「新宿線」＝西武新宿線と都営新宿線、
  //   「西武線」＝西武の全路線）。呼び名ごとにまとめてから当てる。
  //   1件ずつ当てると、最初のキーで伏せ字にした時点で2件目以降が当たらなくなる。
  const byAlias = new Map<string, string[]>();
  for (const { alias, key } of aliases) {
    const ks = byAlias.get(alias) ?? [];
    if (!ks.includes(key)) ks.push(key);
    byAlias.set(alias, ks);
  }
  const keys: string[] = [];
  const sorted = Array.from(byAlias.keys()).sort((a, b) => b.length - a.length);
  for (const alias of sorted) {
    for (let i = q.indexOf(alias); i >= 0; i = q.indexOf(alias, i + 1)) {
      if (!accept(q.slice(i + alias.length))) continue;
      for (const key of byAlias.get(alias) as string[]) if (!keys.includes(key)) keys.push(key);
      q = mask(q, i, alias.length);
    }
  }
  return { q, keys };
}

// ─────────────────────────────────────────────────────────────
// 路線
// ─────────────────────────────────────────────────────────────

/** 会社名の呼び方。「西武新宿線」「都営新宿線」を区別するのに使う */
const COMPANY_SHORT: Record<string, string[]> = {
  東日本旅客鉄道: ['JR'],
  東京地下鉄: ['東京メトロ', 'メトロ'],
  東京都: ['都営'],
  西武鉄道: ['西武'],
  東武鉄道: ['東武'],
  京王電鉄: ['京王'],
  小田急電鉄: ['小田急'],
  東急電鉄: ['東急'],
  京成電鉄: ['京成'],
  京浜急行電鉄: ['京急'],
};

/** 国土数値情報の路線名と、ふだんの呼び名が違うもの */
const LINE_NICKNAMES: Record<string, string[]> = {
  // ★国土数値情報は運行系統ではなく線路の名前で持っている。
  //   京浜東北線は東京駅の北が「東北線」、南が「東海道線」の線路を走る。
  //   埼京線は都内ではほぼ「赤羽線」（池袋〜赤羽）。東北線に当てると京浜東北線の上野まで並ぶので当てない。
  '東日本旅客鉄道 東北線': ['京浜東北線'],
  '東日本旅客鉄道 東海道線': ['京浜東北線'],
  '東日本旅客鉄道 赤羽線': ['埼京線'],
  '東京地下鉄 4号線丸ノ内線': ['丸の内線'],
  '首都圏新都市鉄道 常磐新線': ['つくばエクスプレス', 'TX'],
  'ゆりかもめ 東京臨海新交通臨海線': ['ゆりかもめ'],
  '東京臨海高速鉄道 臨海副都心線': ['りんかい線'],
  '東京モノレール 東京モノレール羽田空港線': ['東京モノレール'],
  '多摩都市モノレール 多摩都市モノレール線': ['多摩モノレール'],
  '東京都 荒川線': ['都電荒川線', '都電'],
  '東武鉄道 伊勢崎線': ['スカイツリーライン'],
  '東京都 日暮里・舎人ライナー': ['舎人ライナー', '日暮里舎人ライナー'],
};

/**
 * 路線の呼び方。「東京地下鉄 5号線東西線」→「東西線」「東京メトロ東西線」。
 * ★「本線」だけは会社名なしで当てない（京成本線と京急本線を取り違える）。
 */
export function lineAliases(line: string): string[] {
  const sp = line.indexOf(' ');
  const company = sp >= 0 ? line.slice(0, sp) : '';
  const name = (sp >= 0 ? line.slice(sp + 1) : line).replace(/^\d+号線/, '');
  if (!name) return [];
  const shorts = COMPANY_SHORT[company] ?? [];
  const out = new Set<string>(LINE_NICKNAMES[line] ?? []);
  if (name === '本線') {
    for (const s of shorts) {
      out.add(`${s}本線`);
      out.add(`${s}線`);
    }
  } else {
    out.add(name);
    for (const s of shorts) out.add(`${s}${name}`);
    // 「東上本線」は「東上線」とも呼ぶ
    if (name.endsWith('本線')) out.add(name.replace(/本線$/, '線'));
  }
  return Array.from(out);
}

// ─────────────────────────────────────────────────────────────
// 学校名
// ─────────────────────────────────────────────────────────────

/**
 * 学校名の当て方。
 *
 * ★日本語は分かち書きしないので、質問文に学校名が部分文字列として出るかで当てる
 *   （keywordSearch の2段目と同じ考え方）。
 *
 * ★1文字の学校名（西・東・菅・旭・橘）はそのまま当てると誤爆する。
 *   「東京の私立は」で「東」、「関西」で「西」に当たってしまう。
 *   1文字の名前は「◯◯高」「都立◯◯」のように高校だと分かる書き方のときだけ当てる。
 *
 * ★2文字の名前には文脈を求めない。戸山・湘南・三田・上野・北園・鎌倉・上溝など、
 *   いちばん聞かれる学校の多くが2文字で、「戸山の偏差値」と書くのが普通だから。
 *   最初は2文字にも文脈を求めていて、「上溝の内申」が当たらなかった。
 *   2文字の地名（厚木・鎌倉など）に当たっても、渡るのはその学校の行だけで、
 *   答えるかどうかはプロンプト側が質問に照らして決める。害は小さい。
 *
 * ★例外は「国立」。「国立大学」の国立に当てないよう、後ろに「大」が続くときは外す。
 */
function aliasesOf(name: string): string[] {
  const stripped = name.replace(/^(都立|県立|市立)/, '');
  const base = stripped && stripped !== name ? [name, stripped] : [name];
  return base.flatMap(kanaVariants);
}

/** ふだんの呼び方が正式名の部分文字列にならないもの */
const SCHOOL_NICKNAMES: Record<string, string[]> = {
  市立横浜サイエンスフロンティア: ['サイフロ', 'YSFH'],
};

/**
 * 地名を冠した学校の、冠を外した呼び方（横浜翠嵐→翠嵐、横浜緑ヶ丘→緑ヶ丘）。
 * ★冠を外すと一般語になるもの（工業・商業・国際・総合…）と1文字（横浜栄→栄）は作らない。
 *   「工科高校」で川崎工科に、「国際」で横浜国際に当たってしまう。
 */
const PLACE_PREFIX = /^(横浜|川崎|相模原|横須賀)/;
const GENERIC_REMAINDER =
  /^(工業|工科|商業|総合|国際|農業|水産|高等|中央|北|南|東|西)$|(工業|商業|総合|工科|定時|通信)/;

interface SchoolAlias {
  alias: string;
  name: string;
  /** true＝「◯◯高」「私立◯◯」の形のときだけ当てる（ふつうの言葉・地名と同じ名前の私立） */
  needsContext?: boolean;
}

/**
 * 私立の学校名のうち、ふつうの言葉や県・市の名前と同じもの。
 * ★私立を入れたら「東京」「横浜」という名前の学校が入った。そのまま当てると
 *   「東京の私立の入試相談は？」で東京高校、「横浜の私立」で横浜高校の行だけが渡る。
 *   「成績が向上」「大成功」のような言葉も同じ。1文字の学校名と同じく、
 *   「東京高」「私立横浜」のように高校だと分かる書き方のときだけ当てる。
 * ★公立に同じ名前が無い私立・国立だけに効かせる（公立の当て方は変えない）。
 */
const GENERIC_PRIVATE_NAMES = new Set([
  '東京',
  '神奈川',
  '埼玉',
  '千葉',
  '横浜',
  '川崎',
  '向上',
  '大成',
  '中村',
  '正則',
  '城北',
  '東洋',
]);

/** 学校名の別名の一覧。長い順に当てる */
function schoolAliasTable(all: SchoolMatch[]): SchoolAlias[] {
  const names = Array.from(new Set(all.map((s) => s.schoolName)));
  const nameSet = new Set(names);
  const publicNames = new Set(
    all.filter((s) => s.establishment === '公立').map((s) => s.schoolName)
  );
  const out: SchoolAlias[] = [];
  for (const name of names) {
    const needsContext = GENERIC_PRIVATE_NAMES.has(name) && !publicNames.has(name);
    for (const alias of aliasesOf(name)) out.push({ alias, name, needsContext });
    for (const nick of SCHOOL_NICKNAMES[name] ?? []) out.push({ alias: nick, name });
  }
  // 冠を外した呼び方は、ほかの学校名とかぶらず、1校にしか当たらないものだけ
  const remainders = new Map<string, string[]>();
  for (const name of names) {
    const base = name.replace(/^(都立|県立|市立)/, '');
    if (!PLACE_PREFIX.test(base)) continue;
    const rest = base.replace(PLACE_PREFIX, '');
    if (rest.length < 2 || GENERIC_REMAINDER.test(rest) || nameSet.has(rest)) continue;
    remainders.set(rest, [...(remainders.get(rest) ?? []), name]);
  }
  remainders.forEach((ns, rest) => {
    if (ns.length !== 1) return;
    for (const alias of kanaVariants(rest)) out.push({ alias, name: ns[0] });
  });
  return out.sort((a, b) => b.alias.length - a.alias.length);
}

/**
 * 別名が当たった位置と長さ。伏せ字にするのに使う。
 * aliasAt は名前そのものの位置（文脈の「都立」「高」を除いた部分）。
 */
function hitsInQuestion(
  question: string,
  alias: string,
  needsContext = false
): { at: number; len: number; aliasAt: number } | null {
  if (alias.length >= 2 && !needsContext) {
    for (let i = question.indexOf(alias); i >= 0; i = question.indexOf(alias, i + 1)) {
      // 「国立大学」の国立のように、直後に「大」が続くのは高校名ではない
      if (question[i + alias.length] !== '大') return { at: i, len: alias.length, aliasAt: i };
    }
    return null;
  }
  // 1文字の名前と、ふつうの言葉と同じ私立の名前は文脈を要求する
  const contexts = needsContext
    ? [`${alias}高`, `私立${alias}`]
    : [`${alias}高`, `都立${alias}`, `県立${alias}`, `市立${alias}`];
  for (const ctx of contexts) {
    const i = question.indexOf(ctx);
    if (i >= 0) return { at: i, len: ctx.length, aliasAt: i + ctx.indexOf(alias) };
  }
  return null;
}

/**
 * 質問文に名前が出ている学校名（長い名前を優先して重複を避ける）と、伏せ字にした質問。
 * hintQ は名前の部分だけを伏せた質問（県・区分のヒントを読む用）。
 * ★県のヒントは学校名を伏せてから読む。「東京農大三」（埼玉の私立）の「東京」で東京都に絞ると、
 *   その学校自身が落ちる。ただし「都立西」の「都立」は名前ではないので残す。
 */
function takeSchoolNames(
  q: string,
  all: SchoolMatch[]
): { q: string; hintQ: string; names: string[] } {
  const matched: string[] = [];
  let hintQ = q;
  for (const { alias, name, needsContext } of schoolAliasTable(all)) {
    const hit = hitsInQuestion(q, alias, needsContext);
    if (!hit) continue;
    if (!matched.includes(name)) matched.push(name);
    // 当たった箇所を伏せる（「市立横浜総合」に当たったあと「横浜」で拾わない）
    q = mask(q, hit.at, hit.len);
    hintQ = mask(hintQ, hit.aliasAt, alias.length);
  }
  return { q, hintQ, names: matched };
}

/** 質問文に名前が出ている学校（全学科）を返す */
export function findByName(question: string, all: SchoolMatch[]): SchoolMatch[] {
  const q = normalizeText(question);
  const { names, hintQ } = takeSchoolNames(q, all);
  return rowsOfNames(q, hintQ, names, all).rows;
}

/**
 * 名前で当たった学校の行。
 * ★同じ名前の公立と私立があれば両方返す（区分は renderSchools が書く）。
 *   「私立」「都立」と言われたときだけ区分で絞る。
 */
function rowsOfNames(
  question: string,
  hintQ: string,
  names: string[],
  all: SchoolMatch[]
): { rows: SchoolMatch[]; total: number } {
  if (names.length === 0) return { rows: [], total: 0 };
  const pref = prefectureHint(hintQ);
  const est = establishmentHint(question);
  const hit = all.filter(
    (s) =>
      names.includes(s.schoolName) && (!pref || s.prefecture === pref) && establishmentOk(s, est)
  );
  return { rows: hit.slice(0, MAX_SCHOOLS), total: hit.length };
}

// ─────────────────────────────────────────────────────────────
// 範囲（偏差値・内申）
// ─────────────────────────────────────────────────────────────

interface RangeQuery {
  hensachi: number | null;
  naishin: number | null;
}

/**
 * ★人は「偏差値が50」「内申は35くらい」「内申点40」のように助詞を挟んで書く。
 *   最初は「偏差値50」「内申35」の形しか拾っておらず、本番の質問
 *   「八王子で内申が35くらいの都立教えて」を取りこぼしていた。
 */
function parseRange(question: string): RangeQuery {
  const q = normalizeText(question);
  const h = q.match(/偏差値\s*(?:が|は|で|の|も)?\s*(\d{2})/);
  const n = q.match(/(?:換算内申|基準内申|内申)点?\s*(?:が|は|で|の|も)?\s*(\d{2,3})/);
  return { hensachi: h ? Number(h[1]) : null, naishin: n ? Number(n[1]) : null };
}

/**
 * ★満点が違う行を同じ数字で比べない。質問の数字が65以下なら65点満点系、
 *   66以上なら135点満点系を見ているとみなす。
 */
function naishinScaleOk(s: SchoolMatch, v: number) {
  const wantMax = v <= 65 ? [65, 75, 52] : [135];
  return s.naishin != null && s.naishinMax != null && wantMax.includes(s.naishinMax);
}

/**
 * 要求した値からの離れ具合。比べられない行は null。
 * ★私立で男子表・女子表の偏差値が違うときは、近いほうで測る（どちらかの表で帯に入れば出す。
 *   渡す行には両方の値が書かれるので、読む側がどちらの表かを取り違えない）。
 * ★私立には内申のめやすが無い（naishin=null）ので、内申で聞かれたら比べられない＝出さない。
 */
function rangeDistance(s: SchoolMatch, r: RangeQuery): number | null {
  let d = 0;
  if (r.hensachi != null) {
    const vs = hensachiValues(s);
    if (vs.length === 0) return null;
    d = Math.max(d, Math.min(...vs.map((v) => Math.abs(v - (r.hensachi as number)))));
  }
  if (r.naishin != null) {
    if (!naishinScaleOk(s, r.naishin)) return null;
    d = Math.max(d, Math.abs((s.naishin as number) - r.naishin));
  }
  return d;
}

function rangeLabel(r: RangeQuery) {
  return [
    r.hensachi != null ? `偏差値${r.hensachi}±${BAND}` : null,
    r.naishin != null ? `内申${r.naishin}±${BAND}` : null,
  ]
    .filter(Boolean)
    .join('・');
}

/**
 * 「偏差値55くらいの都立」「内申40で行ける神奈川の高校」のような範囲の引き当て。
 * 見つからなければ空。
 */
export function findByRange(question: string, all: SchoolMatch[]): SchoolMatch[] {
  return rangeRows(normalizeText(question), all).slice(0, MAX_SCHOOLS);
}

/** 範囲で引いた全行（上限で切る前）。切ったことを条件に書くために分けてある */
function rangeRows(question: string, all: SchoolMatch[]): SchoolMatch[] {
  const r = parseRange(question);
  if (r.hensachi == null && r.naishin == null) return [];
  const pref = prefectureHint(question);
  const est = establishmentHint(question);
  return all
    .filter((s) => (!pref || s.prefecture === pref) && establishmentOk(s, est) && s.sourceYear > 0)
    .filter((s) => {
      const d = rangeDistance(s, r);
      return d != null && d <= BAND;
    })
    .sort((a, b) => hensachiTop(b) - hensachiTop(a));
}

// ─────────────────────────────────────────────────────────────
// 場所（市区町村・駅・沿線）— 東京だけ
// ─────────────────────────────────────────────────────────────

/** 地名のあとに続けば「場所として聞いている」とみなす語 */
/**
 * 地名のあとに続けば「場所として聞いている」とみなす語。
 * ★「で」を入れている。「町田で偏差値50」の町田は町田市（学校の町田なら「町田の偏差値」と書く）。
 *   本番の質問「偏差値50くらいの学校ある？八王子で」もこの形。
 * ★「の私立」「の国立」「の県立」も入れている。私立に「八王子」「千代田」「武蔵野」という名前の学校があり、
 *   学校名と同じ呼び方の地名は最後の段（M2）で当てないため、「八王子の私立」が場所として読めなくなる。
 */
const PLACE_INTENT =
  /^(市|区|町|村|にある|の都立|の私立|の国立|の県立|の高|の公立|の学校|周辺|付近|近辺|の近く|近く|エリア|方面|あたり|辺り|界隈|市内|区内|に住|から通|で)/;
/**
 * 駅名のあとに続けば駅として聞いているとみなす語（「清瀬駅」「清瀬から近い」「清瀬近くの高校」）。
 * ★「から」単独は入れない。「日比谷から西に変えたい」の日比谷は学校なのに駅に取られる。
 *   「あたり」も入れない。「日比谷あたりの学校」はたいてい偏差値の水準の話。
 */
const STATION_INTENT = /^(駅|から近|から通|から行|周辺|付近|近辺|の近く|近く|界隈)/;
/** 会社名だけで沿線を言う形（「西武沿線」「小田急沿い」） */
const COMPANY_ALONG = /^(沿|の沿線|線沿)/;

/**
 * 市区町村をまとめて言う呼び方。
 * ★多摩は島しょ部を外す（「多摩地区の都立」に大島海洋国際を並べない）。
 */
const ISLANDS = ['大島町', '八丈町', '三宅村', '新島村', '神津島村', '小笠原村'];
const AREAS: { pattern: RegExp; label: string; pick: (m: string) => boolean }[] = [
  { pattern: /23区|都区部|区部/, label: '23区', pick: (m) => m.endsWith('区') },
  {
    pattern: /多摩地区|多摩地域|多摩エリア|多摩方面|都下|市部/,
    label: '多摩地区',
    pick: (m) => !m.endsWith('区') && !ISLANDS.includes(m),
  },
];

interface Places {
  q: string;
  lines: string[];
  stations: string[];
  /** 質問に名前が出た市区町村 */
  municipalities: string[];
  /** 「23区」「多摩地区」のようにまとめて言われた範囲と、その市区町村 */
  areas: string[];
  areaMunicipalities: string[];
  /** 学校名として当たったもの */
  names: string[];
  /** 学校名だけを伏せた質問（県のヒントを読む用。takeSchoolNames の hintQ） */
  hintQ: string;
}

/**
 * 質問から場所と学校名を拾う。順番に意味がある。
 *
 *   1. 路線（「日比谷線」を学校の日比谷より先に取る）
 *   2. 駅（「◯◯駅」「◯◯から」の形だけ。「清瀬駅」を学校の清瀬より先に取る）
 *   3. 場所として聞いている市区町村（「町田にある」を学校の町田より先に取る）
 *   4. 学校名
 *   5. 残りの市区町村（学校名と同じ呼び方のものは除く。「府中の偏差値」は学校）
 */
function readPlaces(question: string, all: SchoolMatch[]): Places {
  const tokyo = all.filter((s) => s.prefecture === '東京都');

  const allLines = Array.from(new Set(tokyo.flatMap((s) => s.accessLines ?? [])));
  const lineAliasList: Alias[] = [];
  for (const line of allLines) {
    for (const alias of lineAliases(line)) lineAliasList.push({ alias, key: line });
  }
  // 会社名で呼ぶ言い方（「西武線」「小田急線」「都営線」）は、その会社の全路線に当てる。
  // ★「西武新宿線」のように路線まで言っていれば、長い呼び名が先に当たってそちらになる。
  // ★「京王線」「京成線」のように、その呼び名が特定の路線の呼び名でもあるときは、その路線だけ。
  //   「京王線沿線」で井の頭線まで並べない。
  const named = new Set(lineAliasList.map((a) => a.alias));
  for (const line of allLines) {
    const company = line.slice(0, Math.max(0, line.indexOf(' ')));
    for (const s of COMPANY_SHORT[company] ?? []) {
      if (!named.has(`${s}線`)) lineAliasList.push({ alias: `${s}線`, key: line });
    }
  }
  const L = takeHits(question, lineAliasList);
  // 「西武沿線」「小田急沿い」のように「線」を付けない言い方も、その会社の全路線
  const L2 = takeHits(
    L.q,
    allLines.flatMap((line) => {
      const company = line.slice(0, Math.max(0, line.indexOf(' ')));
      return (COMPANY_SHORT[company] ?? []).map((s) => ({ alias: s, key: line }));
    }),
    (after) => COMPANY_ALONG.test(after)
  );

  const stationNames = Array.from(
    new Set(tokyo.flatMap((s) => (s.accessStations ?? []).map((x) => x.name)))
  );
  const S = takeHits(
    L2.q,
    stationNames.flatMap((n) => kanaVariants(n).map((alias) => ({ alias, key: n }))),
    (after) => STATION_INTENT.test(after)
  );
  // 「清瀬駅」の「駅」も伏せる（後ろの段で邪魔にならないように）
  let q = S.q.replace(/＿駅/g, '＿＿');

  const munis = Array.from(new Set(tokyo.map((s) => s.municipality).filter(Boolean))) as string[];

  // 正式名（八王子市・北区）は紛れが無いので、いつでも当てる
  const M0 = takeHits(
    q,
    munis.map((m) => ({ alias: m, key: m }))
  );
  q = M0.q;
  // まとめた呼び方（23区・多摩地区）は正式名のあとで取る。先に取ると「八王子市部活」の「市部」を拾う
  const areas: string[] = [];
  const areaMunicipalities: string[] = [];
  for (const a of AREAS) {
    const m = q.match(a.pattern);
    if (!m || m.index == null) continue;
    areas.push(a.label);
    areaMunicipalities.push(...munis.filter(a.pick));
    q = mask(q, m.index, m[0].length);
  }
  // ★「市」「区」を外した呼び方は2文字以上だけ。1文字（北区→北・港区→港）を当てると
  //   「八王子北にある」の北で北区に当たる。
  const shortAliases: Alias[] = munis
    .map((m) => ({ alias: m.replace(/[市区町村]$/, ''), key: m }))
    .filter((a) => a.alias.length >= 2 && a.alias !== a.key);
  const M1 = takeHits(q, shortAliases, (after) => PLACE_INTENT.test(after));
  q = M1.q;

  const N = takeSchoolNames(q, all);
  q = N.q;

  // 学校名と同じ呼び方の地名（府中・町田・国立など）は、ここでは当てない。
  // 「中央大学」の中央のように、直後に「大」が続くものも地名ではない。
  const schoolNames = new Set(all.map((s) => s.schoolName));
  const M2 = takeHits(
    q,
    shortAliases.filter((a) => !schoolNames.has(a.alias)),
    (after) => !after.startsWith('大')
  );

  return {
    q: M2.q,
    lines: Array.from(new Set([...L.keys, ...L2.keys])),
    stations: S.keys,
    municipalities: Array.from(new Set([...M0.keys, ...M1.keys, ...M2.keys])),
    areas,
    areaMunicipalities,
    names: N.names,
    hintQ: N.hintQ,
  };
}

/**
 * 駅の路線と、およその位置。
 *
 * ★駅→路線・駅の座標の表を別に持っていない。手元のマスタから次のように代える。
 *   - 路線: その駅を主たる最寄駅にしている学校の primary_lines（主たる最寄駅の全路線＝正確）。
 *     どの学校の最寄駅でもない駅（立川・吉祥寺など）は、その駅を通える駅に持つ学校の
 *     access_lines の共通部分で代える。access_lines は通える駅の全路線なので、
 *     その駅の路線は必ず全校の access_lines に入っている＝共通部分は駅の路線を含む。
 *     ただし学校が1校だと共通部分がその学校の全路線になり広すぎるので、2校以上のときだけ使う
 *   - 位置: その駅がいちばん近い学校の座標。誤差はその学校から駅までの距離（多くは1km未満）
 */
function stationLinesOf(name: string, tokyo: SchoolMatch[]): string[] {
  const exact = Array.from(
    new Set(tokyo.filter((s) => s.primaryStation === name).flatMap((s) => s.primaryLines ?? []))
  );
  if (exact.length) return exact;
  const around = tokyo.filter((s) => s.accessStations?.some((a) => a.name === name));
  const bySchool = Array.from(new Set(around.map((s) => s.schoolName))).map((n) =>
    around.find((s) => s.schoolName === n)
  ) as SchoolMatch[];
  if (bySchool.length < 2) return [];
  return (bySchool[0].accessLines ?? []).filter((l) =>
    bySchool.every((s) => s.accessLines?.includes(l))
  );
}

function stationInfoOf(stations: string[], all: SchoolMatch[]): StationInfo[] {
  const tokyo = all.filter((s) => s.prefecture === '東京都');
  return stations.map((name) => {
    const lines = stationLinesOf(name, tokyo);
    let anchor: SchoolMatch | null = null;
    let best = Number.MAX_SAFE_INTEGER;
    for (const s of tokyo) {
      const x = s.accessStations?.find((a) => a.name === name && a.m != null);
      if (x && (x.m as number) < best && s.lat != null && s.lon != null) {
        best = x.m as number;
        anchor = s;
      }
    }
    return { name, lines, lat: anchor?.lat ?? null, lon: anchor?.lon ?? null };
  });
}

/** 学校のマスタに載っている、その駅までの直線距離（m）。2km圏の外なら null */
function distanceTo(s: SchoolMatch, stations: string[]): number | null {
  let best: number | null = null;
  for (const x of s.accessStations ?? []) {
    if (!stations.includes(x.name)) continue;
    const m = x.m ?? Number.MAX_SAFE_INTEGER;
    if (best == null || m < best) best = m;
  }
  return best;
}

/** 2点間の直線距離（km）。平面の近似で十分（数km〜数十kmの目安にしか使わない） */
function km(aLat: number, aLon: number, bLat: number, bLon: number) {
  const r = Math.PI / 180;
  const x = (bLon - aLon) * r * Math.cos(((aLat + bLat) / 2) * r);
  const y = (bLat - aLat) * r;
  return Math.sqrt(x * x + y * y) * 6371;
}

/** 2km圏の外の学校が、同じ沿線でどれくらい離れているか。沿線でなければ null */
function alongLine(
  s: SchoolMatch,
  info: StationInfo[]
): { station: string; lines: string[]; km: number | null } | null {
  for (const st of info) {
    const shared = (s.accessLines ?? []).filter((l) => st.lines.includes(l));
    if (shared.length === 0) continue;
    const d =
      st.lat != null && st.lon != null && s.lat != null && s.lon != null
        ? km(st.lat, st.lon, s.lat, s.lon)
        : null;
    return { station: st.name, lines: shared, km: d };
  }
  return null;
}

/** 駅で聞かれたときの並べ順の鍵（m）。2km圏は正確な距離、沿線はおよその距離 */
function stationSortKey(s: SchoolMatch, stations: string[], info: StationInfo[]): number {
  const near = distanceTo(s, stations);
  if (near != null) return near;
  const a = alongLine(s, info);
  return a?.km != null ? a.km * 1000 : Number.MAX_SAFE_INTEGER;
}

/** 場所の条件で引く。種類が違う条件は「かつ」、同じ種類は「または」 */
function findByPlace(
  p: Places,
  all: SchoolMatch[],
  est: Establishment[] | null
): { rows: SchoolMatch[]; conditions: string[] } {
  // ★私立・国立も対象（東京の私立は所在地・駅のデータがある学校だけ当たる）。
  //   国立はめやすの行が無いが、推薦の基準があれば渡す価値があるので残す。
  const tokyo = all.filter(
    (s) =>
      s.prefecture === '東京都' &&
      establishmentOk(s, est) &&
      (s.sourceYear > 0 || s.admission.length > 0)
  );
  const sets: SchoolMatch[][] = [];
  const conditions: string[] = [];

  if (p.municipalities.length || p.areaMunicipalities.length) {
    const ms = [...p.municipalities, ...p.areaMunicipalities];
    sets.push(tokyo.filter((s) => s.municipality && ms.includes(s.municipality)));
    conditions.push(`所在地が ${[...p.areas, ...p.municipalities].join('・')}`);
  }
  if (p.lines.length) {
    sets.push(tokyo.filter((s) => s.accessLines?.some((l) => p.lines.includes(l))));
    conditions.push(`${p.lines.join('・')} の沿線（学校から直線2km圏に駅がある）`);
  }
  if (p.stations.length) {
    const info = stationInfoOf(p.stations, all);
    const near = tokyo.filter((s) => distanceTo(s, p.stations) != null);
    // 同じ沿線でも、駅からの目安の距離が ALONG_KM を超える学校は「近い」に入れない。
    // 位置が分からない学校（座標なし）も入れない。
    const along = tokyo.filter((s) => {
      if (near.includes(s)) return false;
      const a = alongLine(s, info);
      return a != null && a.km != null && a.km <= ALONG_KM;
    });
    sets.push([...near, ...along]);
    const lines = Array.from(new Set(info.flatMap((x) => x.lines)));
    conditions.push(
      `${p.stations.map((x) => `${x}駅`).join('・')} から直線2km圏（学校が案内している駅を含む）` +
        (lines.length ? `、または同じ沿線（${lines.join('・')}）で直線およそ${ALONG_KM}km以内` : '')
    );
  }
  if (sets.length === 0) return { rows: [], conditions: [] };
  const rows = sets.reduce((acc, cur) => acc.filter((s) => cur.includes(s)));
  return { rows, conditions };
}

/** 場所で絞った行を、範囲の条件と並べ順で整える */
function arrangePlaceRows(
  rows: SchoolMatch[],
  r: RangeQuery,
  stations: string[],
  info: StationInfo[],
  conditions: string[]
): SchoolMatch[] {
  const hasRange = r.hensachi != null || r.naishin != null;
  let out = rows;
  if (hasRange) {
    const scored = rows
      .map((s) => ({ s, d: rangeDistance(s, r) }))
      .filter((x): x is { s: SchoolMatch; d: number } => x.d != null);
    const inBand = scored.filter((x) => x.d <= BAND).map((x) => x.s);
    if (inBand.length > 0) {
      out = inBand;
      conditions.push(rangeLabel(r));
    } else {
      // ★場所で絞ると帯に1校も入らないことが多い（清瀬駅の2km圏は3校しかない）。
      //   黙るより、近い順に出して「帯には無い」と言わせるほうが役に立つ。
      out = scored
        .sort((a, b) => a.d - b.d)
        .slice(0, NEAREST)
        .map((x) => x.s);
      conditions.push(
        `${rangeLabel(r)} に入る学校は無い。値の近い順に${out.length}行だけ渡している`
      );
    }
  }
  // 駅で聞かれたら近い順（2km圏の外＝沿線の学校は後ろ）、それ以外は偏差値の高い順
  out = [...out].sort((a, b) => {
    if (stations.length) {
      const da = stationSortKey(a, stations, info);
      const db = stationSortKey(b, stations, info);
      if (da !== db) return da - db;
    }
    return hensachiTop(b) - hensachiTop(a);
  });
  if (out.length > MAX_SCHOOLS) {
    conditions.push(`条件に合うのは${out.length}行。先頭の${MAX_SCHOOLS}行だけ渡している`);
    out = out.slice(0, MAX_SCHOOLS);
  }
  return out;
}

/** 神奈川を場所で聞かれたかどうか（データが無いので断るため） */
const KANAGAWA_PLACE = /駅|沿線|沿い|にある|近く|周辺|付近|市内|区内/;

/**
 * 質問から学校を引き当てる。
 *   学校名が出ていれば学校名で（駅が出ていれば距離を添える）。
 *   無ければ場所（市区町村・駅・沿線）で。場所も無ければ範囲（偏差値・内申）で。
 */
export function matchSchools(rawQuestion: string, all: SchoolMatch[]): SchoolLookup {
  const question = normalizeText(rawQuestion);
  const p = readPlaces(question, all);
  const r = parseRange(question);
  const empty: SchoolLookup = {
    rows: [],
    conditions: [],
    stations: [],
    stationInfo: [],
    notice: null,
  };
  const at = { stations: p.stations, stationInfo: stationInfoOf(p.stations, all) };
  const est = establishmentHint(question);

  if (p.names.length > 0) {
    // ★県のヒントは学校名だけを伏せた質問から読む（takeSchoolNames の hintQ と同じ理由）
    const byName = rowsOfNames(question, p.hintQ, p.names, all);
    const conditions =
      byName.total > MAX_SCHOOLS
        ? [
            `名前が当たったのは${byName.total}行（コース・学科ごと）。先頭の${MAX_SCHOOLS}行だけ渡している`,
          ]
        : [];
    return { ...empty, ...at, rows: byName.rows, conditions };
  }

  if (p.municipalities.length || p.areas.length || p.lines.length || p.stations.length) {
    const found = findByPlace(p, all, est);
    const conditions = [...found.conditions];
    if (est) conditions.push(`設置区分が ${est.join('・')}`);
    const rows = arrangePlaceRows(found.rows, r, p.stations, at.stationInfo, conditions);
    if (rows.length > 0) return { ...empty, ...at, rows, conditions };
  }

  const ranged = rangeRows(question, all);
  if (ranged.length > 0) {
    const conditions = [rangeLabel(r)];
    if (est) conditions.push(`設置区分が ${est.join('・')}`);
    if (ranged.length > MAX_SCHOOLS) {
      conditions.push(
        `条件に合うのは${ranged.length}行。偏差値の高い順に先頭の${MAX_SCHOOLS}行だけ渡している` +
          '（「私立」「都立」や都県を付けると絞れる）'
      );
    }
    return { ...empty, rows: ranged.slice(0, MAX_SCHOOLS), conditions };
  }

  // ★私立を内申の数字で探すことはできない。基準は学校・区分ごとに5科・9科・3科と形が違い、
  //   同じ「内申30」でも比べられない。黙らずに、そう伝える本文を渡す。
  if (est?.includes('私立') && r.naishin != null && r.hensachi == null) {
    return {
      ...empty,
      notice:
        '私立高校は内申の数字では探せない（推薦・併願優遇の基準は学校・区分ごとに5科・9科・3科など形が違い、' +
        '都立の換算内申とも別物）。学校名か偏差値で聞き直してもらう。',
    };
  }

  if (prefectureHint(question) === '神奈川県' && KANAGAWA_PLACE.test(question)) {
    return {
      ...empty,
      notice:
        '神奈川の高校（公立・私立とも）は、AIヘルプではまだ場所の条件（市区町村・駅・沿線）で探せない。' +
        'そう伝え、学校名か偏差値・内申で聞き直してもらう。',
    };
  }
  return empty;
}

// ─────────────────────────────────────────────────────────────
// 回答に渡す本文
// ─────────────────────────────────────────────────────────────

function label(s: SchoolMatch) {
  // 東京は市区町村と旧学区を両方出す（場所で聞かれたときに、どこの学校か分かるように）
  const where =
    s.region ??
    [s.municipality, s.oldDistrict != null ? `旧${s.oldDistrict}学区` : null]
      .filter(Boolean)
      .join('・');
  const head = [s.schoolName, s.course].filter(Boolean).join('（') + (s.course ? '）' : '');
  return where ? `${head}［${where}］` : head;
}

function formatMeters(m: number) {
  return m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${m}m`;
}

/** 駅で聞かれたときの、その学校と駅の関係 */
function stationNote(s: SchoolMatch, l: SchoolLookup): string | null {
  if (l.stations.length === 0) return null;
  for (const x of s.accessStations ?? []) {
    if (!l.stations.includes(x.name)) continue;
    return x.m != null
      ? `${x.name}駅まで直線${formatMeters(x.m)}`
      : `${x.name}駅（学校の案内にある駅）`;
  }
  const a = alongLine(s, l.stationInfo);
  if (!a) return null;
  return (
    `${a.station}駅から2km圏の外・同じ沿線（${a.lines.join('・')}）` +
    (a.km != null ? `・駅からおよそ直線${a.km.toFixed(1)}km` : '')
  );
}

/** 名前で1〜数校を引いたときは、基準の確認事項・加点の中身まで渡す。一覧のときは短くする */
const DETAIL_SCHOOLS = 3;

/** 私立・国立の偏差値（男女で違えば両方）。資料に無ければそう書く（空欄にしない） */
function privateHensachiText(s: SchoolMatch): string {
  if (s.hensachi != null) {
    const g = s.hensachiByGender;
    // 片方の表にしか無い学校（男子校・女子校）は、どちらの表かも書く
    if (g && (g.男子 == null) !== (g.女子 == null)) {
      return `偏差値 ${s.hensachi}（${g.男子 != null ? '男子' : '女子'}の表）`;
    }
    return `偏差値 ${s.hensachi}`;
  }
  const g = s.hensachiByGender;
  if (g && g.男子 != null && g.女子 != null) return `偏差値 男子${g.男子}・女子${g.女子}`;
  return '偏差値 資料なし';
}

/** 基準1区分を1行に */
function admissionLine(a: AdmissionText, detail: boolean): string {
  const parts = [`${a.heading}: 内申 ${a.criterion}`];
  if (a.strength) parts.push(`（${a.strength}）`);
  const tail: string[] = [];
  if (a.conditions.length) tail.push(`条件 ${a.conditions.join('・')}`);
  if (a.bonus) tail.push(detail ? `加点 ${a.bonus}` : '加点あり');
  if (detail && a.checks.length) tail.push(`ほかに確認 ${a.checks.join('／')}`);
  return parts.join('') + (tail.length ? ` ／ ${tail.join(' ／ ')}` : '');
}

/** 公立の行（従来どおり） */
function publicParts(s: SchoolMatch): string[] {
  const isTokyo = s.prefecture === '東京都';
  const parts: string[] = [];
  if (s.totalScore != null) {
    parts.push(isTokyo ? `総合得点 ${s.totalScore}/1000` : `基準S1値 ${s.totalScore}/1000`);
  }
  if (s.naishin != null && s.naishinMax != null) {
    parts.push(isTokyo ? `換算内申 ${s.naishin}/${s.naishinMax}` : `基準内申 ${s.naishin}/135`);
  } else {
    parts.push('内申 未確認（資料が読めていない）');
  }
  if (s.hensachi != null) parts.push(`偏差値 ${s.hensachi}`);
  return parts;
}

/**
 * 2回目（回答）に渡す本文。★県ごとに語を変える。
 * 東京の「総合得点」と神奈川の「基準S1値」は別物なので、同じ語で書かせない。
 * ★設置区分（公立・私立・国立）を必ず行の頭に書く。同じ名前の公立と私立がありうる。
 * ★私立・国立は内申のめやすの代わりに推薦・併願優遇の基準を書く。基準を示すだけで、
 *   生徒に当てた判定は書かない（AIヘルプには生徒の情報を渡さない）。
 */
export function renderSchools(input: SchoolLookup | SchoolMatch[]): string {
  const lookup: SchoolLookup = Array.isArray(input)
    ? { rows: input, conditions: [], stations: [], stationInfo: [], notice: null }
    : input;
  if (lookup.rows.length === 0) {
    return lookup.notice ? `【学校のめやす】\n★${lookup.notice}` : '';
  }
  const detail = new Set(lookup.rows.map((s) => s.schoolName)).size <= DETAIL_SCHOOLS;
  const lines: string[] = [];
  for (const s of lookup.rows) {
    const isPublic = s.establishment === '公立';
    const parts = isPublic ? publicParts(s) : [privateHensachiText(s)];
    const extra = [
      !isPublic && s.genderType ? s.genderType : null,
      stationNote(s, lookup),
      s.examType,
      s.gakuryokuRatio ? `比率${s.gakuryokuRatio}` : null,
      s.note,
    ]
      .filter(Boolean)
      .join('・');
    // 国立はめやすの行が無い（偏差値の資料が無い）。出典を空にせず、無いと書く
    const source = s.sourceLabel
      ? `${s.sourceLabel}${s.verifiedAt ? '' : '（紙と未突合）'}`
      : 'めやすの資料なし';
    lines.push(
      `- ${s.prefecture} ${s.establishment} ${label(s)} ${parts.join('・')}` +
        `${extra ? ` ／ ${extra}` : ''} ／ 出典: ${source}`
    );
    if (!isPublic) {
      if (s.admission.length === 0) {
        lines.push('  - 推薦・併願優遇の基準: 高校マスタに無い');
        continue;
      }
      for (const a of s.admission) lines.push(`  - ${admissionLine(a, detail)}`);
      const sources = Array.from(
        new Set(s.admission.map((a) => `${a.sourceLabel}${a.verified ? '' : '（紙と未突合）'}`))
      );
      lines.push(`  - 基準の出典: ${sources.join('／')}`);
    }
  }
  const head = [
    '【学校のめやす】（高校マスタから引いた行。ここに無い学校のことは答えない）',
    '★数字の意味が都県で違う。東京の「総合得点」は 学力検査＋調査書＝1000点満点（ESAT-Jを含まない）。',
    '  神奈川の「基準S1値」は各校の内申と学力検査の比率で計算した1000点満点（特色検査を含まない）。',
    '  算出法が違うので、都県をまたいで数字を比べない。',
    '★内申の満点が違う。東京は65（3教科入試の学科は75、産業技術高専は52）、神奈川は135（中2＋中3×2）。',
    '  満点の違う数字を並べて比べない。',
  ];
  if (lookup.rows.some((s) => s.establishment !== '公立')) {
    head.push(
      '★行の頭の「公立」「私立」「国立」が設置区分。同じ名前でも区分が違えば別の学校として扱う。',
      '★私立・国立の偏差値は、出典に書いた模試会社の資料の数字。公立の偏差値と資料が違えば、並べて比べない。',
      '  「男子◯・女子◯」と書いた学校は男子表と女子表で値が違う。片方だけを答えない。',
      '★私立・国立は同じ学校でもコースごとに行がある。コース名を添えて答える。',
      '★字下げした行は推薦・併願優遇の基準（最新年度の冊子）。内申は素内申（5段階の評定の合計。',
      '  「5科22」＝5教科の評定の合計が22）で、都立の換算内申・神奈川の135点満点とは別物。',
      '  書いてある条件だけを伝える。「公立併願のみ」と書いていない区分に公立との併願が条件だと言わない。',
      '  何校まで併願できるか、合格が約束されるか、など書かれていないことを足さない。',
      '  「ほかに確認」は冊子にある、内申の数字では決まらない条件。省かずに添える。',
      '★生徒が基準に届くかどうかは判定しない（ここに生徒の内申は無い）。基準を示すところまで。'
    );
  }
  if (lookup.stations.length) {
    head.push(
      '★駅までの距離は、学校と駅の座標から出した直線距離。歩く道のりではない。',
      '  「およそ」と書いた距離は、駅にいちばん近い学校の位置から測った目安（1km程度ずれることがある）。',
      '  「最寄駅」「徒歩◯分」とは言わない。通学経路は学校の案内で確かめるよう添える。'
    );
  }
  if (lookup.conditions.length) {
    head.push(`【探した条件】${lookup.conditions.join('／')}`);
  }
  return `${head.join('\n')}\n${lines.join('\n')}`;
}
