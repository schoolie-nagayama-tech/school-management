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
 * ★場所（市区町村・駅・沿線）で引けるのは東京だけ。神奈川は所在地のデータがまだ無い
 *   （合格基準一覧表に所在地が載っていないため）。
 */

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
  hensachi: number | null;
  examType: string | null;
  gakuryokuRatio: string | null;
  note: string | null;
  /** null＝人間が紙と突き合わせていない。答えに必ず添える */
  verifiedAt: string | null;
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

/** 「DB の text[]（`清瀬(850m)`）」を距離つきの配列にする */
export function parseAccessStations(raw: string[] | null): StationDistance[] | null {
  if (!raw || raw.length === 0) return null;
  return raw.map((x) => {
    const m = x.match(/^(.+?)\((\d+)m\)$/);
    return m ? { name: m[1], m: Number(m[2]) } : { name: x, m: null };
  });
}

/** 質問が県を名指ししていればそれを返す。両方・どちらでもなければ null */
export function prefectureHint(question: string): string | null {
  const tokyo = /都立|東京/.test(question);
  // ★「県立」だけでは神奈川と断定しない（他県の話かもしれない）が、
  //   このマスタに他県は無いので、神奈川として扱ってよい。
  const kanagawa = /神奈川|県立|横浜|川崎|相模原|横須賀|藤沢|厚木|平塚|小田原/.test(question);
  if (tokyo && !kanagawa) return '東京都';
  if (kanagawa && !tokyo) return '神奈川県';
  return null;
}

// ─────────────────────────────────────────────────────────────
// 質問文から語を拾う共通の道具
// ─────────────────────────────────────────────────────────────

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
  const keys: string[] = [];
  const sorted = [...aliases].sort((a, b) => b.alias.length - a.alias.length);
  for (const { alias, key } of sorted) {
    for (let i = q.indexOf(alias); i >= 0; i = q.indexOf(alias, i + 1)) {
      if (!accept(q.slice(i + alias.length))) continue;
      if (!keys.includes(key)) keys.push(key);
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
  '首都圏新都市鉄道 常磐新線': ['つくばエクスプレス'],
  'ゆりかもめ 東京臨海新交通臨海線': ['ゆりかもめ'],
  '東京臨海高速鉄道 臨海副都心線': ['りんかい線'],
  '東京モノレール 東京モノレール羽田空港線': ['東京モノレール'],
  '多摩都市モノレール 多摩都市モノレール線': ['多摩モノレール'],
  '東京都 荒川線': ['都電荒川線', '都電'],
  '東武鉄道 伊勢崎線': ['スカイツリーライン'],
  '東京都 日暮里・舎人ライナー': ['舎人ライナー'],
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
  return stripped && stripped !== name ? [name, stripped] : [name];
}

/** 学校名が当たった位置と長さ。伏せ字にするのに使う */
function hitsInQuestion(question: string, name: string): { at: number; len: number } | null {
  for (const alias of aliasesOf(name)) {
    if (alias.length >= 2) {
      for (let i = question.indexOf(alias); i >= 0; i = question.indexOf(alias, i + 1)) {
        // 「国立大学」の国立のように、直後に「大」が続くのは高校名ではない
        if (question[i + alias.length] !== '大') return { at: i, len: alias.length };
      }
    } else {
      // 1文字の名前は文脈を要求する
      for (const ctx of [`${alias}高`, `都立${alias}`, `県立${alias}`, `市立${alias}`]) {
        const i = question.indexOf(ctx);
        if (i >= 0) return { at: i, len: ctx.length };
      }
    }
  }
  return null;
}

/** 質問文に名前が出ている学校名（長い名前を優先して重複を避ける）と、伏せ字にした質問 */
function takeSchoolNames(q: string, all: SchoolMatch[]): { q: string; names: string[] } {
  const names = Array.from(new Set(all.map((s) => s.schoolName))).sort(
    (a, b) => b.length - a.length
  );
  const matched: string[] = [];
  for (const n of names) {
    const hit = hitsInQuestion(q, n);
    if (!hit) continue;
    matched.push(n);
    // 当たった箇所を伏せる（「市立横浜総合」に当たったあと「横浜」で拾わない）
    q = mask(q, hit.at, hit.len);
  }
  return { q, names: matched };
}

/** 質問文に名前が出ている学校（全学科）を返す */
export function findByName(question: string, all: SchoolMatch[]): SchoolMatch[] {
  const { names } = takeSchoolNames(question, all);
  return rowsOfNames(question, names, all);
}

function rowsOfNames(question: string, names: string[], all: SchoolMatch[]): SchoolMatch[] {
  if (names.length === 0) return [];
  const pref = prefectureHint(question);
  return all
    .filter((s) => names.includes(s.schoolName) && (!pref || s.prefecture === pref))
    .slice(0, MAX_SCHOOLS);
}

// ─────────────────────────────────────────────────────────────
// 範囲（偏差値・内申）
// ─────────────────────────────────────────────────────────────

interface RangeQuery {
  hensachi: number | null;
  naishin: number | null;
}

function parseRange(question: string): RangeQuery {
  const h = question.match(/偏差値\s*(\d{2})/);
  const n = question.match(/(?:内申|換算内申|基準内申)\s*(\d{2,3})/);
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

/** 要求した値からの離れ具合。比べられない行は null */
function rangeDistance(s: SchoolMatch, r: RangeQuery): number | null {
  let d = 0;
  if (r.hensachi != null) {
    if (s.hensachi == null) return null;
    d = Math.max(d, Math.abs(s.hensachi - r.hensachi));
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
  const r = parseRange(question);
  if (r.hensachi == null && r.naishin == null) return [];
  const pref = prefectureHint(question);
  return all
    .filter((s) => (!pref || s.prefecture === pref) && s.sourceYear > 0)
    .filter((s) => {
      const d = rangeDistance(s, r);
      return d != null && d <= BAND;
    })
    .sort((a, b) => (b.hensachi ?? 0) - (a.hensachi ?? 0))
    .slice(0, MAX_SCHOOLS);
}

// ─────────────────────────────────────────────────────────────
// 場所（市区町村・駅・沿線）— 東京だけ
// ─────────────────────────────────────────────────────────────

/** 地名のあとに続けば「場所として聞いている」とみなす語 */
const PLACE_INTENT =
  /^(市|区|町|村|にある|の都立|の高校|の公立|の学校|周辺|付近|近辺|エリア|方面|あたり|界隈|市内|区内|に住|から通)/;
/**
 * 駅名のあとに続けば駅として聞いているとみなす語（「清瀬駅」「清瀬から近い」）。
 * ★「から」単独は入れない。「日比谷から西に変えたい」の日比谷は学校なのに駅に取られる。
 *   「あたり」も入れない。「日比谷あたりの学校」はたいてい偏差値の水準の話。
 */
const STATION_INTENT = /^(駅|から近|から通|から行|周辺|付近|近辺|の近く|界隈)/;

interface Places {
  q: string;
  lines: string[];
  stations: string[];
  municipalities: string[];
  /** 学校名として当たったもの */
  names: string[];
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

  const lineAliasList: Alias[] = [];
  for (const line of Array.from(new Set(tokyo.flatMap((s) => s.accessLines ?? [])))) {
    for (const alias of lineAliases(line)) lineAliasList.push({ alias, key: line });
  }
  const L = takeHits(question, lineAliasList);

  const stationNames = Array.from(
    new Set(tokyo.flatMap((s) => (s.accessStations ?? []).map((x) => x.name)))
  );
  const S = takeHits(
    L.q,
    stationNames.map((n) => ({ alias: n, key: n })),
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
    lines: L.keys,
    stations: S.keys,
    municipalities: Array.from(new Set([...M0.keys, ...M1.keys, ...M2.keys])),
    names: N.names,
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
function findByPlace(p: Places, all: SchoolMatch[]): { rows: SchoolMatch[]; conditions: string[] } {
  const tokyo = all.filter((s) => s.prefecture === '東京都' && s.sourceYear > 0);
  const sets: SchoolMatch[][] = [];
  const conditions: string[] = [];

  if (p.municipalities.length) {
    sets.push(tokyo.filter((s) => s.municipality && p.municipalities.includes(s.municipality)));
    conditions.push(`所在地が ${p.municipalities.join('・')}`);
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
    return (b.hensachi ?? 0) - (a.hensachi ?? 0);
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
export function matchSchools(question: string, all: SchoolMatch[]): SchoolLookup {
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

  if (p.names.length > 0) {
    return { ...empty, ...at, rows: rowsOfNames(question, p.names, all) };
  }

  if (p.municipalities.length || p.lines.length || p.stations.length) {
    const found = findByPlace(p, all);
    const conditions = [...found.conditions];
    const rows = arrangePlaceRows(found.rows, r, p.stations, at.stationInfo, conditions);
    if (rows.length > 0) return { ...empty, ...at, rows, conditions };
  }

  const rows = findByRange(question, all);
  if (rows.length > 0) return { ...empty, rows, conditions: [rangeLabel(r)] };

  if (prefectureHint(question) === '神奈川県' && KANAGAWA_PLACE.test(question)) {
    return {
      ...empty,
      notice:
        '神奈川の公立高校は、所在地・最寄駅・沿線のデータがまだ高校マスタに無い。' +
        '場所の条件（市区町村・駅・沿線）では探せないと伝え、学校名か偏差値・内申で聞き直してもらう。',
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

/**
 * 2回目（回答）に渡す本文。★県ごとに語を変える。
 * 東京の「総合得点」と神奈川の「基準S1値」は別物なので、同じ語で書かせない。
 */
export function renderSchools(input: SchoolLookup | SchoolMatch[]): string {
  const lookup: SchoolLookup = Array.isArray(input)
    ? { rows: input, conditions: [], stations: [], stationInfo: [], notice: null }
    : input;
  if (lookup.rows.length === 0) {
    return lookup.notice ? `【学校のめやす】\n★${lookup.notice}` : '';
  }
  const lines: string[] = [];
  for (const s of lookup.rows) {
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
    const extra = [
      stationNote(s, lookup),
      s.examType,
      s.gakuryokuRatio ? `比率${s.gakuryokuRatio}` : null,
      s.note,
    ]
      .filter(Boolean)
      .join('・');
    lines.push(
      `- ${s.prefecture} ${label(s)} ${parts.join('・')}${extra ? ` ／ ${extra}` : ''}` +
        ` ／ 出典: ${s.sourceLabel}${s.verifiedAt ? '' : '（紙と未突合）'}`
    );
  }
  const head = [
    '【学校のめやす】（高校マスタから引いた行。ここに無い学校のことは答えない）',
    '★数字の意味が都県で違う。東京の「総合得点」は 学力検査＋調査書＝1000点満点（ESAT-Jを含まない）。',
    '  神奈川の「基準S1値」は各校の内申と学力検査の比率で計算した1000点満点（特色検査を含まない）。',
    '  算出法が違うので、都県をまたいで数字を比べない。',
    '★内申の満点が違う。東京は65（3教科入試の学科は75、産業技術高専は52）、神奈川は135（中2＋中3×2）。',
    '  満点の違う数字を並べて比べない。',
  ];
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
