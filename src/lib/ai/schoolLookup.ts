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
 */

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
  accessLines: string[] | null;
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

/** 1回の質問で渡す上限。これ以上並べても読む側が追えないし、プロンプトが膨らむ */
export const MAX_SCHOOLS = 24;
/** 範囲で引いたときの帯の広さ（偏差値・内申とも ±この値） */
const BAND = 2;

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

function hitsInQuestion(question: string, name: string): boolean {
  for (const alias of aliasesOf(name)) {
    if (alias.length >= 2) {
      for (let i = question.indexOf(alias); i >= 0; i = question.indexOf(alias, i + 1)) {
        // 「国立大学」の国立のように、直後に「大」が続くのは高校名ではない
        if (question[i + alias.length] !== '大') return true;
      }
    } else if (
      // 1文字の名前は文脈を要求する
      question.includes(`${alias}高`) ||
      question.includes(`都立${alias}`) ||
      question.includes(`県立${alias}`) ||
      question.includes(`市立${alias}`)
    ) {
      return true;
    }
  }
  return false;
}

/** 質問文に名前が出ている学校（全学科）を返す。長い名前を優先して重複を避ける */
export function findByName(question: string, all: SchoolMatch[]): SchoolMatch[] {
  const names = Array.from(new Set(all.map((s) => s.schoolName))).sort(
    (a, b) => b.length - a.length
  );
  const matched: string[] = [];
  for (const n of names) {
    // すでに当たった長い名前の一部なら飛ばす（「市立横浜総合」に当たったあと「横浜」で拾わない）
    if (matched.some((m) => m.includes(n))) continue;
    if (hitsInQuestion(question, n)) matched.push(n);
  }
  if (matched.length === 0) return [];
  const pref = prefectureHint(question);
  return all
    .filter((s) => matched.includes(s.schoolName) && (!pref || s.prefecture === pref))
    .slice(0, MAX_SCHOOLS);
}

/**
 * 「偏差値55くらいの都立」「内申40で行ける神奈川の高校」のような範囲の引き当て。
 * 見つからなければ空。
 */
export function findByRange(question: string, all: SchoolMatch[]): SchoolMatch[] {
  const hensachi = question.match(/偏差値\s*(\d{2})/);
  const naishin = question.match(/(?:内申|換算内申|基準内申)\s*(\d{2,3})/);
  if (!hensachi && !naishin) return [];
  const pref = prefectureHint(question);

  let rows = all.filter((s) => (!pref || s.prefecture === pref) && s.sourceYear > 0);
  if (hensachi) {
    const v = Number(hensachi[1]);
    rows = rows.filter((s) => s.hensachi != null && Math.abs(s.hensachi - v) <= BAND);
  }
  if (naishin) {
    const v = Number(naishin[1]);
    // ★満点が違う行を同じ数字で比べない。質問の数字が65以下なら65点満点系、
    //   66以上なら135点満点系を見ているとみなす。
    const wantMax = v <= 65 ? [65, 75, 52] : [135];
    rows = rows.filter(
      (s) =>
        s.naishin != null &&
        s.naishinMax != null &&
        wantMax.includes(s.naishinMax) &&
        Math.abs(s.naishin - v) <= BAND
    );
  }
  return rows.sort((a, b) => (b.hensachi ?? 0) - (a.hensachi ?? 0)).slice(0, MAX_SCHOOLS);
}

/** 質問から学校を引き当てる（名前 → 無ければ範囲） */
export function matchSchools(question: string, all: SchoolMatch[]): SchoolMatch[] {
  const byName = findByName(question, all);
  if (byName.length > 0) return byName;
  return findByRange(question, all);
}

function label(s: SchoolMatch) {
  const where =
    s.region ?? (s.oldDistrict != null ? `旧${s.oldDistrict}学区` : (s.municipality ?? ''));
  const head = [s.schoolName, s.course].filter(Boolean).join('（') + (s.course ? '）' : '');
  return where ? `${head}［${where}］` : head;
}

/**
 * 2回目（回答）に渡す本文。★県ごとに語を変える。
 * 東京の「総合得点」と神奈川の「基準S1値」は別物なので、同じ語で書かせない。
 */
export function renderSchools(rows: SchoolMatch[]): string {
  if (rows.length === 0) return '';
  const lines: string[] = [];
  for (const s of rows) {
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
    const extra = [s.examType, s.gakuryokuRatio ? `比率${s.gakuryokuRatio}` : null, s.note]
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
  ].join('\n');
  return `${head}\n${lines.join('\n')}`;
}
