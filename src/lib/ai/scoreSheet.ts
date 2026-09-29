/**
 * 成績表の読み取り（AI）のプロンプトと、答えの検め方。
 * 正典: docs/score-sheet-plan-draft.md §4.2
 *
 * ★AIにさせるのは2つだけ：
 *   1. 模試の個人帳票を**書き写す**（read）
 *   2. ×だった設問を、こちらが渡した単元一覧の**どれに当てるか選ぶ**（map）
 *   コマ数・難問の採否・教材の組み合わせは規則（lib/scoreSheet/planRules.ts）が決める。
 */

export const SCORE_SHEET_IMAGE_LIMIT = 8;

/** 読み取りのシステムプロンプト。★毎回同じなのでキャッシュに載せる */
export function readSystemPrompt(): string {
  return [
    'あなたは塾の事務担当で、模試の個人帳票を見たまま書き写す係です。',
    '帳票は進学研究会の「進研テスト」または「Vもぎ（都立そっくりもぎ）」です。',
    '',
    '# 守ること',
    '- 書き写すだけ。まとめない・推測しない・足さない。読めない欄は null にする。',
    '- 数学と英語だけを読む。国語・社会・理科は読まない。',
    '- 画像は、1ページ目を左右に2分割したものと、2ページ目「学力分析表」を上下左右に4分割したもの（端が少し重なっている）。',
    '  重なりで同じ設問が2枚に写っていたら1つにまとめる。',
    '- 答えは JSON だけ。前置きもコードフェンスも付けない。',
    '',
    '# 1ページ目から読むもの',
    '- doc_type: 「進研テスト」なら "shinken_test"、「そっくりもぎ」「Vもぎ」なら "vmogi_tokyo"',
    '- exam_label: 実施の欄のまま（例「(3号) 2026年9月」「2026年8月30日（日）」）',
    '- grade_in_school: 学年の欄の数字（「2年」なら 2）',
    '- student_name: 氏名の欄のまま',
    '- ss: 「テストの結果」の表の偏差値（S.S.）。{"math": 数学, "eng": 英語}。空欄・「－」は null',
    '- first_choice: Vもぎの「都立志望校の診断」の第1志望校。{"name": 学校名のまま（例「〇〇 - 普通」）, "base_ss": 志望校合格基準の偏差値}。',
    '  進研テストや、志望校の欄が無いときは null',
    '',
    '# 2ページ目「学力分析表」から読むもの（数学・英語）',
    '- 「領域名」の行ごとに1つの領域にする。name は領域名、own_pct は領域の行の右端「正誤」の欄の数字（本人の得点率）。',
    '  領域の行の「[80]」のような角かっこの数字は全体の正答率なので使わない。右端が空欄なら own_pct は null。',
    '- 領域の下の各行が設問。q は番号の欄のまま（例「5 問1」「3(3)①」「1 A 2」）、content は内容の欄のまま。',
    '- rate は設問の正答率（全体の正答率、%）。',
    '- result は正誤の欄：「○」→ "o"、「×」→ "x"、「×→◎」→ "x_to_double"、「×→★」→ "x_to_star"。',
    '- 部分点の設問（作図・証明・英作文など）は、正答率の欄が「2.7点」のような平均点、正誤の欄が「0点」のような本人の得点になっている。',
    '  そのときは rate を null、avg に平均点の数、result に本人の得点の数を入れる。',
    '',
    '# 答えの形',
    '{"doc_type":"vmogi_tokyo","exam_label":"…","grade_in_school":3,"student_name":"…",',
    '"ss":{"math":61,"eng":54},"first_choice":{"name":"…","base_ss":47},',
    '"subjects":{"math":[{"name":"関数","own_pct":75,"items":[{"q":"3 問1","content":"線分の長さ","rate":55,"avg":null,"result":"o"}]}],"eng":[…]}}',
  ].join('\n');
}

export function readUserText(): string {
  return '上の画像の帳票を、決められた形の JSON で書き写してください。';
}

/** 当てはめる設問1問 */
export interface MapQuestion {
  key: string;
  subject: string;
  area: string;
  q: string;
  content: string;
}

/** 当てはめ先の単元1つ */
export interface MapCandidate {
  id: number;
  /** 例「フォレスタゴール 3-2 空間図形①」 */
  label: string;
}

export function mapSystemPrompt(): string {
  return [
    'あなたは塾の教務担当です。模試で×だった設問それぞれについて、',
    'その設問の力をつけるのにいちばん合う単元を、渡した単元一覧の中から1つだけ選びます。',
    '',
    '# 守ること',
    '- 選べるのは一覧にある単元の id だけ。一覧に無い id を作らない。',
    '- 合う単元が一覧に無ければ unit_id は null にする（無理に近いものを選ばない）。',
    '- 1問につき1つだけ選ぶ。',
    '- 設問の番号（大問）も手がかりにする。都立入試の形の模試なら、数学は大問1が小問集合、2が式の証明・規則性、3が関数、4が平面図形、5が空間図形。',
    '  英語は大問1がリスニング、2が資料つきの対話文と英作文、3が対話文、4が長文。',
    '- 答えは JSON だけ。{"mapping":[{"key":"…","unit_id":123}]}',
  ].join('\n');
}

export function mapUserText(questions: MapQuestion[], candidates: MapCandidate[]): string {
  return [
    '# ×だった設問',
    ...questions.map(
      (q) => `- key=${q.key}｜${q.subject}｜領域「${q.area}」｜${q.q}｜${q.content}`
    ),
    '',
    '# 単元一覧（id: 単元）',
    ...candidates.map((c) => `- ${c.id}: ${c.label}`),
  ].join('\n');
}

/**
 * 当てはめの答えを検める。★一覧に無い id は捨てる（AI が作った id を信じない）
 */
export function parseMapResult(
  raw: unknown,
  questions: MapQuestion[],
  candidates: MapCandidate[]
): Record<string, number | null> {
  const allowed = new Set(candidates.map((c) => c.id));
  const keys = new Set(questions.map((q) => q.key));
  const out: Record<string, number | null> = {};
  for (const q of questions) out[q.key] = null;
  const list = (raw as { mapping?: unknown } | null)?.mapping;
  if (!Array.isArray(list)) return out;
  for (const m of list) {
    const key = (m as { key?: unknown })?.key;
    const id = (m as { unit_id?: unknown })?.unit_id;
    if (typeof key !== 'string' || !keys.has(key)) continue;
    out[key] = typeof id === 'number' && allowed.has(id) ? id : null;
  }
  return out;
}
