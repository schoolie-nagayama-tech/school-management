/**
 * 私立高校の推薦・併願優遇の基準を、生徒本人の内申に当てて判定する。
 * ------------------------------------------------------------------
 * 正典: docs/private-high-school-master.md
 *
 * 私立の基準は学校・コース・入試区分ごとにばらばらで（「5科20または9科35」「9科に1は不可」
 * 「英検準2級で+1」「2年次+3年次で44/50」…）、面談の前に人が冊子をめくって照らし合わせていた。
 * ★教室長の方針（2026-09-25）:「私立の方が複雑で個別の条件がある。だからこそシステムに手伝ってほしい」。
 *   条件を式として持ち、本人の通知表から「届いている／あといくつ／なぜ不可か」を出す。
 *
 * ★式にできない条件（欠席日数・説明会参加・作文・校内順位・入試点への加算）は判定に混ぜない。
 *   確認事項（checks）として並べ、人が面談で確かめる。無理に式にすると、判定が「届いている」と
 *   言い切ってしまい、欠席日数で落ちる生徒を見落とす。
 * ★検定（英検・漢検・数検）は NEST に持っていない。「持っていれば届く」を条件つきで出す
 *  （持っていると仮定して「届いている」と言わない）。
 * ★DBにもこのファイルにも、学校ごとの if 文を書かない。学校の違いはすべて rule（JSON）で表す。
 */

import type { Region } from './region';

/* ============================================================
 * 型（DBの high_school_admission_rules.rule に入る JSON と同じ形）
 * ========================================================== */

/** 通知表の9教科。冊子の表記に合わせた短い名前 */
export type Subject = '国' | '数' | '英' | '理' | '社' | '音' | '美' | '保体' | '技家';

export const SUBJECTS_9: readonly Subject[] = [
  '国',
  '数',
  '英',
  '理',
  '社',
  '音',
  '美',
  '保体',
  '技家',
];
const SUBJECTS_5: readonly Subject[] = ['国', '数', '英', '理', '社'];
const SUBJECTS_3: readonly Subject[] = ['国', '数', '英'];
const SUBJECTS_PRACTICAL: readonly Subject[] = ['音', '美', '保体', '技家'];

/** assessment_scores.subject（英語コード）→ 冊子の教科名 */
export const SUBJECT_BY_CODE: Record<string, Subject> = {
  japanese: '国',
  math: '数',
  english: '英',
  science: '理',
  social: '社',
  music: '音',
  art: '美',
  pe: '保体',
  tech_home: '技家',
};

/**
 * 教科の束。
 * - '3科' は国数英。★学校によって3科の中身が違う（「国英社・数英理でも可」）。その学校は
 *   best 型で表すか、書き起こしの段階で manual に倒してある。
 * - best 型は「5科のうち任意の3科」「英＋国数社理から2科」。本人に最も有利な選び方で計算する
 *  （学校が選ばせる／上位を取る、のどちらの書き方でも、本人の最大値を取れば一致する）。
 */
export type SubjectSet =
  | '3科'
  | '5科'
  | '9科'
  | '実技4科'
  | Subject[]
  | { best: number; of: SubjectSet; plus?: Subject[] };

/**
 * どの学年の評定を何倍して合わせるか。省略時は3年次だけ（×1）。
 * 1年次は「各学年9科に1は不可」「3年間の平均」のような学校のためにある。
 */
export interface YearWeight {
  grade: 1 | 2 | 3;
  w: number;
}

export type Clause =
  | { t: 'sum'; s: SubjectSet; min: number; of?: number; years?: YearWeight[] }
  | { t: 'avg'; s: SubjectSet; min: number; years?: YearWeight[] }
  | { t: 'each'; s: SubjectSet; min: number; years?: YearWeight[] }
  | { t: 'none_le'; s: SubjectSet; grade: number; years?: YearWeight[] }
  | { t: 'any_ge'; s: SubjectSet; grade: number; years?: YearWeight[] }
  | { t: 'cert'; name: string }
  | { t: 'manual'; text: string };

export interface BonusItem {
  label: string;
  points: number;
  /** 省略時は「条件の中身が分からない加点」として要確認扱い */
  when?: Clause;
}

export interface Bonus {
  /** 全体の上限。null＝書かれていない */
  max: number | null;
  /** 「5科に+1、9科に+2まで」のような合計ごとの上限 */
  max_by?: Record<string, number> | null;
  /** 加点が乗る合計（'3科' '5科' '9科'）。null＝どれにも乗る */
  applies_to?: string[] | null;
  items: BonusItem[];
  note?: string | null;
}

/** high_school_admission_rules.rule の中身 */
export interface AdmissionRuleBody {
  /** 外側がOR（①②③のいずれか）、内側がAND（「かつ」） */
  any: Clause[][];
  /** 区分全体の前提（9科に1は不可 など）。1つでも満たさなければ不可 */
  gates: Clause[];
  bonus: Bonus | null;
  /** 内申の基準が無い理由（「内申基準なし（学力重視）」）。あれば any は空 */
  no_criterion: string | null;
}

/** 判定に使う入試区分の正規化。冊子の呼び方（A推薦・書類選考・専願…）は examLabel に残す */
export type AdmissionKind = '推薦' | '単願' | '併願';

export interface AdmissionRule {
  id: string;
  kind: AdmissionKind;
  /** 冊子の呼び方そのまま（「B推薦（公私併願, 都神外生）」「併願（公私）」） */
  examLabel: string;
  /** （公）＝公立併願のみ */
  publicOnly: boolean;
  /** 受験者の住所の限定（「都神外生」「東京・神奈川県生」）。null＝限定なし */
  applicantScope: string | null;
  /** 男女で基準が違う学校だけ入る */
  gender: '男子' | '女子' | null;
  /** 数値の強さ（出願資格／出願基準／目安）。null＝冊子に書かれていない */
  strength: '出願資格' | '出願基準' | '目安' | null;
  body: AdmissionRuleBody;
  checks: string[];
  rawText: string;
  sourceLabel: string;
  /** NULL＝紙の原本と未照合（AIの書き起こしのまま） */
  verifiedAt: string | null;
  sortOrder: number;
}

/* ============================================================
 * 本人の通知表
 * ========================================================== */

export type GradeSheet = Partial<Record<Subject, number | null>>;

export interface StudentReportCards {
  /** 3年次（中3）の評定。入試に使う2学期を優先 */
  grade3: GradeSheet | null;
  /** 2年次（中2）の学年末の評定 */
  grade2: GradeSheet | null;
  /** 1年次（中1）の学年末の評定。「各学年」の条件にだけ使う */
  grade1?: GradeSheet | null;
  /**
   * 3年次の評定が確定前のもので仮に判定していること。
   * - '1学期': 中3の1学期（前期）しかない
   * - '2年学年末': 中3の評定がまだ1つも無く、中2の学年末で代わりに判定した
   */
  provisional: '1学期' | '2年学年末' | null;
}

/** assessments.name_code のうち、中3の評定として使う順（入試は2学期＝後期の評定） */
const GRADE3_CODE_PRIORITY = ['term2', 'second', 'year_end', 'term1', 'first'] as const;
const GRADE3_PROVISIONAL_CODES = new Set(['term1', 'first']);
/** 中2の学年末。2期制は後期が学年の評定 */
const GRADE2_YEAR_END_CODES = ['year_end', 'second', 'term2'] as const;

interface ReportCardLike {
  category: string;
  grade: number;
  name_code: string;
  scores: { subject: string; value: number | null }[];
}

function toSheet(a: ReportCardLike): GradeSheet {
  const sheet: GradeSheet = {};
  for (const s of a.scores) {
    const subject = SUBJECT_BY_CODE[s.subject];
    if (subject) sheet[subject] = s.value;
  }
  return sheet;
}

/**
 * 成績（assessments）から判定用の通知表を組む。
 * ★学年は小1=1 の通し番号（中2=8・中3=9）。assessments は新しい順で来る前提。
 * ★中3が無ければ中2の学年末で代わりに判定する（秋の面談までは中3の評定が無いことがあり、
 *   何も出さないより「仮」と明示して出すほうが面談で使える）。
 */
export function buildStudentReportCards(
  assessments: readonly ReportCardLike[]
): StudentReportCards {
  const cards = assessments.filter((a) => a.category === 'report_card');
  const pick = (grade: number, codes: readonly string[]) => {
    for (const code of codes) {
      const hit = cards.find((a) => a.grade === grade && a.name_code === code);
      if (hit) return hit;
    }
    return undefined;
  };
  const g3 = pick(9, GRADE3_CODE_PRIORITY);
  const g2 = pick(8, GRADE2_YEAR_END_CODES);
  const g1 = pick(7, GRADE2_YEAR_END_CODES);
  const grade2 = g2 ? toSheet(g2) : null;
  const grade1 = g1 ? toSheet(g1) : null;

  if (g3) {
    return {
      grade3: toSheet(g3),
      grade2,
      grade1,
      provisional: GRADE3_PROVISIONAL_CODES.has(g3.name_code) ? '1学期' : null,
    };
  }
  if (grade2) return { grade3: grade2, grade2, grade1, provisional: '2年学年末' };
  return { grade3: null, grade2: null, grade1, provisional: null };
}

/* ============================================================
 * 教科の束・学年の解決
 * ========================================================== */

function resolveSubjects(s: SubjectSet): readonly Subject[] | null {
  if (s === '3科') return SUBJECTS_3;
  if (s === '5科') return SUBJECTS_5;
  if (s === '9科') return SUBJECTS_9;
  if (s === '実技4科') return SUBJECTS_PRACTICAL;
  if (Array.isArray(s)) return s;
  return null; // best 型
}

/** 表示用の名前（「5科」「英」「5科のうち3科」） */
export function subjectSetLabel(s: SubjectSet): string {
  if (typeof s === 'string') return s;
  if (Array.isArray(s)) return s.join('');
  const base = `${subjectSetLabel(s.of)}のうち${s.best}科`;
  return s.plus && s.plus.length > 0 ? `${s.plus.join('')}＋${base}` : base;
}

const DEFAULT_YEARS: readonly YearWeight[] = [{ grade: 3, w: 1 }];

function sheetFor(cards: StudentReportCards, grade: 1 | 2 | 3): GradeSheet | null {
  if (grade === 3) return cards.grade3;
  if (grade === 2) return cards.grade2;
  return cards.grade1 ?? null;
}

/** 束の評定を取り出す。1つでも欠けていれば null（推測で埋めない） */
function valuesOf(sheet: GradeSheet, subjects: readonly Subject[]): number[] | null {
  const out: number[] = [];
  for (const sub of subjects) {
    const v = sheet[sub];
    if (v == null || !Number.isFinite(v)) return null;
    out.push(v);
  }
  return out;
}

/** 1学年ぶんの束の合計。best 型は本人に最も有利な選び方 */
function sumOfYear(sheet: GradeSheet, s: SubjectSet): number | null {
  const direct = resolveSubjects(s);
  if (direct) {
    const vals = valuesOf(sheet, direct);
    return vals ? vals.reduce((a, b) => a + b, 0) : null;
  }
  const best = s as { best: number; of: SubjectSet; plus?: Subject[] };
  const pool = resolveSubjects(best.of);
  if (!pool) return null;
  const poolVals = valuesOf(sheet, pool);
  const plusVals = valuesOf(sheet, best.plus ?? []);
  if (!poolVals || !plusVals) return null;
  const top = [...poolVals].sort((a, b) => b - a).slice(0, best.best);
  return [...top, ...plusVals].reduce((a, b) => a + b, 0);
}

function countOf(s: SubjectSet): number {
  const direct = resolveSubjects(s);
  if (direct) return direct.length;
  const best = s as { best: number; plus?: Subject[] };
  return best.best + (best.plus?.length ?? 0);
}

/** 束に含まれる各教科の評定（学年ごと）。best 型は判定しようがないので束全体の元の教科で見る */
function subjectsForEachCheck(s: SubjectSet): readonly Subject[] | null {
  const direct = resolveSubjects(s);
  if (direct) return direct;
  const best = s as { of: SubjectSet; plus?: Subject[] };
  const pool = resolveSubjects(best.of);
  return pool ? [...pool, ...(best.plus ?? [])] : null;
}

/* ============================================================
 * 1つの条件の評価
 * ========================================================== */

export type ClauseState =
  /** 満たす */
  | 'met'
  /** 満たさない（数値の不足。gap を持つ） */
  | 'short'
  /** 満たさない（数値でない条件。「9科に2がある」など、加点では取り返せない） */
  | 'fail'
  /** 本人の評定が入っていない */
  | 'nodata'
  /** 検定。NESTに無いので分からない */
  | 'cert'
  /** 式にできない条件 */
  | 'manual';

export interface ClauseResult {
  /** 元の条件の種類 */
  type: Clause['t'];
  state: ClauseState;
  /** 条件の読み（「5科 20 以上」） */
  label: string;
  /** 本人の値（合計・平均） */
  have?: number;
  /** 不足（sum は点、avg は平均の差） */
  gap?: number;
  /** fail の理由（「技家が2」） */
  reason?: string;
  /** 加点の対象になる合計か（sum だけ） */
  sumKey?: string;
}

function yearsLabel(years: readonly YearWeight[] | undefined): string {
  if (!years || years.length === 0) return '';
  if (years.length === 1 && years[0].grade === 3 && years[0].w === 1) return '';
  if (years.length === 1) return `${years[0].grade}年次の`;
  return (
    years.map((y) => (y.w === 1 ? `${y.grade}年次` : `${y.grade}年次×${y.w}`)).join('＋') + 'の'
  );
}

export function clauseLabel(c: Clause): string {
  switch (c.t) {
    case 'sum':
      return `${yearsLabel(c.years)}${subjectSetLabel(c.s)} ${c.min}${c.of ? `/${c.of}` : ''} 以上`;
    case 'avg':
      return `${yearsLabel(c.years)}${subjectSetLabel(c.s)}の平均 ${c.min} 以上`;
    case 'each':
      return `${yearsLabel(c.years)}${subjectSetLabel(c.s)}${countOf(c.s) > 1 ? 'がそれぞれ' : 'が'} ${c.min} 以上`;
    case 'none_le':
      return `${yearsLabel(c.years)}${subjectSetLabel(c.s)}に${c.grade}以下が無い`;
    case 'any_ge':
      return `${yearsLabel(c.years)}${subjectSetLabel(c.s)}に${c.grade}以上がある`;
    case 'cert':
      return c.name;
    case 'manual':
      return c.text;
  }
}

/** 小数1桁に丸める（平均の表示と比較の誤差よけ） */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function evaluateClause(c: Clause, cards: StudentReportCards): ClauseResult {
  return { type: c.t, ...evaluateClauseInner(c, cards) };
}

function evaluateClauseInner(c: Clause, cards: StudentReportCards): Omit<ClauseResult, 'type'> {
  const label = clauseLabel(c);
  if (c.t === 'cert') return { state: 'cert', label };
  if (c.t === 'manual') return { state: 'manual', label };

  const years = c.years && c.years.length > 0 ? c.years : DEFAULT_YEARS;

  if (c.t === 'sum' || c.t === 'avg') {
    let total = 0;
    let weight = 0;
    for (const y of years) {
      const sheet = sheetFor(cards, y.grade);
      if (!sheet) return { state: 'nodata', label };
      const v = sumOfYear(sheet, c.s);
      if (v == null) return { state: 'nodata', label };
      total += v * y.w;
      weight += y.w;
    }
    if (c.t === 'sum') {
      const gap = c.min - total;
      return gap <= 0
        ? { state: 'met', label, have: total, sumKey: sumKeyOf(c.s) }
        : { state: 'short', label, have: total, gap, sumKey: sumKeyOf(c.s) };
    }
    const avg = round1(total / (weight * countOf(c.s)));
    const gap = round1(c.min - avg);
    return gap <= 0
      ? { state: 'met', label, have: avg }
      : { state: 'short', label, have: avg, gap };
  }

  // each / none_le / any_ge は教科ごとに見る
  const subjects = subjectsForEachCheck(c.s);
  if (!subjects) return { state: 'nodata', label };
  const offenders: string[] = [];
  let anyHit = false;
  for (const y of years) {
    const sheet = sheetFor(cards, y.grade);
    if (!sheet) return { state: 'nodata', label };
    const vals = valuesOf(sheet, subjects);
    if (!vals) return { state: 'nodata', label };
    const prefix = years.length > 1 ? `${y.grade}年次の` : '';
    subjects.forEach((sub, i) => {
      const v = vals[i];
      if (c.t === 'each' && v < c.min) offenders.push(`${prefix}${sub}が${v}`);
      if (c.t === 'none_le' && v <= c.grade) offenders.push(`${prefix}${sub}が${v}`);
      if (c.t === 'any_ge' && v >= c.grade) anyHit = true;
    });
  }
  if (c.t === 'any_ge') {
    return anyHit
      ? { state: 'met', label }
      : { state: 'fail', label, reason: `${subjectSetLabel(c.s)}に${c.grade}が無い` };
  }
  return offenders.length === 0
    ? { state: 'met', label }
    : { state: 'fail', label, reason: offenders.join('・') };
}

/** 加点の上限を引く鍵。'3科' '5科' '9科' '実技4科' のどれか。それ以外は null */
function sumKeyOf(s: SubjectSet): string | undefined {
  return typeof s === 'string' ? s : undefined;
}

/* ============================================================
 * 1つの入試区分の判定
 * ========================================================== */

export type AdmissionStatus =
  /** 内申だけで届いている */
  | 'ok'
  /** 本人の評定で自動で分かる加点（9科に5がある など）を足すと届いている */
  | 'ok_with_bonus'
  /** 数値は届いているが、検定などNESTで分からない条件が要る */
  | 'conditional'
  /** 検定などの加点があれば届く */
  | 'bonus'
  /** 足りない */
  | 'short'
  /** 数値以外の前提（9科に2は不可 など）で出願できない */
  | 'ng'
  /** 内申の基準が無い（学力検査・入試点で決まる） */
  | 'na'
  /** 本人の通知表が入っていない */
  | 'nodata';

export interface AlternativeResult {
  clauses: ClauseResult[];
  /** この選択肢を満たしているか（検定・manual は満たしたとは数えない） */
  met: boolean;
  /** 数値だけの不足の合計（加点で埋められる可能性があるもの）。数値以外で落ちていれば null */
  gap: number | null;
}

export interface BonusView {
  label: string;
  points: number;
  /** auto=本人の評定で満たしている／unmet=満たしていない／unknown=検定など要確認 */
  state: 'auto' | 'unmet' | 'unknown';
}

export interface AdmissionJudgment {
  status: AdmissionStatus;
  /** 表に出す短い一言（「5科19（基準18）を満たす」「9科に2は不可（技家が2）」） */
  summary: string;
  alternatives: AlternativeResult[];
  gates: ClauseResult[];
  bonuses: BonusView[];
  /** 加点の上限（全体）。null＝書かれていない */
  bonusMax: number | null;
  /** 面談で確かめること（式にできない条件＋検定の条件） */
  checks: string[];
  /** 3年次の評定を仮のもので判定したか */
  provisional: StudentReportCards['provisional'];
}

function bonusCapFor(bonus: Bonus, sumKey: string | undefined): number {
  if (bonus.applies_to && bonus.applies_to.length > 0) {
    if (!sumKey || !bonus.applies_to.includes(sumKey)) return 0;
  }
  const byKey = sumKey && bonus.max_by ? bonus.max_by[sumKey] : undefined;
  const caps = [byKey, bonus.max ?? undefined].filter((v): v is number => v != null);
  return caps.length > 0 ? Math.min(...caps) : Number.POSITIVE_INFINITY;
}

/**
 * ★検定の加点のうち、同じ系統（英検3級と英検準2級）は重ならない前提で、最大の1つだけを見込む。
 *   冊子の多くは「3級は+1、準2級は+2」と級で段を分けており、両方を足す学校はまず無い。
 *   多めに見込んで「加点で届く」と言うより、少なめに見込んで外すほうが面談の事故が小さい。
 */
function potentialOf(items: BonusView[]): number {
  let total = 0;
  const certGroups = new Map<string, number>();
  for (const it of items) {
    if (it.state !== 'unknown') continue;
    const group = /英検|英・漢・数|漢検|数検/.test(it.label)
      ? it.label.replace(/準?\d級.*$/, '')
      : null;
    if (group) certGroups.set(group, Math.max(certGroups.get(group) ?? 0, it.points));
    else total += it.points;
  }
  for (const v of Array.from(certGroups.values())) total += v;
  return total;
}

export function evaluateRule(rule: AdmissionRule, cards: StudentReportCards): AdmissionJudgment {
  const body = rule.body;
  const checks = [...rule.checks];
  const base = {
    alternatives: [] as AlternativeResult[],
    gates: [] as ClauseResult[],
    bonuses: [] as BonusView[],
    bonusMax: body.bonus?.max ?? null,
    checks,
    provisional: cards.provisional,
  };

  if (body.no_criterion || body.any.length === 0) {
    return {
      ...base,
      status: 'na',
      summary: body.no_criterion ?? '内申の基準が書かれていない',
    };
  }
  if (!cards.grade3) {
    return { ...base, status: 'nodata', summary: '通知表の評定が未入力' };
  }

  // --- 前提 ---
  const gates = body.gates.map((g) => evaluateClause(g, cards));
  for (const g of gates) {
    if (g.state === 'cert' || g.state === 'manual') checks.push(g.label);
    // ★評定が入っていない学年がある前提（「各学年9科に1は不可」で中1が未入力 など）は、
    //   満たしたとみなさず確認事項に回す
    if (g.state === 'nodata') checks.push(`${g.label}（評定が未入力の学年があり、確かめていない）`);
  }
  const failedGate = gates.find((g) => g.state === 'fail' || g.state === 'short');

  // --- 加点 ---
  const bonuses: BonusView[] = (body.bonus?.items ?? []).map((it) => {
    if (!it.when) return { label: it.label, points: it.points, state: 'unknown' };
    const r = evaluateClause(it.when, cards);
    if (r.state === 'met') return { label: it.label, points: it.points, state: 'auto' };
    if (r.state === 'cert' || r.state === 'manual' || r.state === 'nodata') {
      return { label: it.label, points: it.points, state: 'unknown' };
    }
    return { label: it.label, points: it.points, state: 'unmet' };
  });
  const autoPoints = bonuses.filter((b) => b.state === 'auto').reduce((a, b) => a + b.points, 0);
  const potentialPoints = potentialOf(bonuses);

  // --- 選択肢 ---
  const alternatives: AlternativeResult[] = body.any.map((clauses) => {
    const results = clauses.map((c) => evaluateClause(c, cards));
    const hardFail = results.some((r) => r.state === 'fail' || r.state === 'nodata');
    const shorts = results.filter((r) => r.state === 'short');
    const met = !hardFail && shorts.length === 0 && results.every((r) => r.state === 'met');
    const gap = hardFail ? null : shorts.reduce((a, r) => a + (r.gap ?? 0), 0);
    return { clauses: results, met, gap };
  });

  const view = { ...base, gates, bonuses, alternatives };

  if (failedGate) {
    return { ...view, status: 'ng', summary: failSummary(failedGate) };
  }

  // 数値の条件がすべて満たされた選択肢
  const fullyMet = alternatives.find((a) => a.met);
  if (fullyMet) {
    return { ...view, status: 'ok', summary: metSummary(fullyMet) };
  }

  // 数値は満たし、検定・manual だけが残る選択肢
  const conditional = alternatives.find(
    (a) => a.gap === 0 && a.clauses.some((c) => c.state === 'cert' || c.state === 'manual')
  );
  if (conditional) {
    const need = conditional.clauses
      .filter((c) => c.state === 'cert' || c.state === 'manual')
      .map((c) => c.label);
    for (const n of need) if (!checks.includes(n)) checks.push(n);
    return {
      ...view,
      status: 'conditional',
      summary: `数値は届いている。${need.join('・')}が要る`,
    };
  }

  // 加点で埋められるか。選択肢ごとに、合計ごとの上限を見て判定する
  const bonus = body.bonus;
  // ★加点は合計（sum）に乗るもの。平均（avg）の不足は加点で埋める扱いにしない
  const closableBy = (alt: AlternativeResult, points: number): boolean => {
    if (!bonus || alt.gap == null) return false;
    return alt.clauses
      .filter((c) => c.state === 'short')
      .every(
        (c) => c.type === 'sum' && (c.gap ?? 0) <= Math.min(points, bonusCapFor(bonus, c.sumKey))
      );
  };
  const onlyNumericShort = (alt: AlternativeResult) =>
    alt.gap != null && alt.clauses.every((c) => c.state === 'met' || c.state === 'short');

  const autoAlt = alternatives.find((a) => onlyNumericShort(a) && closableBy(a, autoPoints));
  if (autoAlt) {
    const autoLabels = bonuses.filter((b) => b.state === 'auto').map((b) => b.label);
    return {
      ...view,
      status: 'ok_with_bonus',
      summary: `加点込みで届いている（${autoLabels.join('・')}）`,
    };
  }

  const bonusAlt = alternatives.find(
    (a) => a.gap != null && closableBy(a, autoPoints + potentialPoints)
  );
  if (bonusAlt) {
    const shortText = bonusAlt.clauses
      .filter((c) => c.state === 'short')
      .map((c) => `${shortSubject(c)}であと${c.gap}`)
      .join('・');
    const candidates = bonuses.filter((b) => b.state === 'unknown').map((b) => b.label);
    return {
      ...view,
      status: 'bonus',
      summary: `${shortText}。${candidates.slice(0, 2).join('・')}などの加点で届く`,
    };
  }

  const numeric = alternatives.filter(
    (a) => a.gap != null && a.clauses.some((c) => c.state === 'short')
  );
  if (numeric.length > 0) {
    const best = numeric.reduce((a, b) => ((b.gap ?? 0) < (a.gap ?? 0) ? b : a));
    const shortText = best.clauses
      .filter((c) => c.state === 'short')
      .map((c) => `${shortSubject(c)}であと${c.gap}`)
      .join('・');
    return { ...view, status: 'short', summary: shortText };
  }

  // どの選択肢も数値以外で落ちている
  const nodata = alternatives.every((a) => a.clauses.some((c) => c.state === 'nodata'));
  if (nodata) {
    return { ...view, status: 'nodata', summary: '判定に要る学年の評定が未入力' };
  }
  const firstFail = alternatives.flatMap((a) => a.clauses).find((c) => c.state === 'fail');
  return {
    ...view,
    status: 'ng',
    summary: firstFail ? failSummary(firstFail) : 'どの基準も満たさない',
  };
}

/** 「9科に2は不可（技家が2）」「英が 4 以上を満たさない（英が3）」 */
function failSummary(c: ClauseResult): string {
  const reason = c.reason ? `（${c.reason}）` : '';
  if (c.type === 'none_le') return `${c.label.replace(/以下が無い$/, 'は不可')}${reason}`;
  if (c.type === 'sum' || c.type === 'avg') {
    return `${shortSubject(c)}であと${c.gap}`;
  }
  return `${c.label}を満たさない${reason}`;
}

function shortSubject(c: ClauseResult): string {
  // 「5科 20 以上」→「5科」、「2年次＋3年次×2の9科 128/135 以上」→ そのまま前半
  return c.label.replace(/\s[\d./]+\s以上$/, '');
}

function metSummary(alt: AlternativeResult): string {
  const sums = alt.clauses.filter((c) => c.have != null);
  if (sums.length === 0) return '基準を満たす';
  return sums
    .map(
      (c) => `${shortSubject(c)}${c.have}（基準${c.label.match(/\s([\d./]+)\s以上$/)?.[1] ?? ''}）`
    )
    .join('・')
    .concat('を満たす');
}

/* ============================================================
 * どの区分を代表として表に出すか
 * ========================================================== */

const PREF_ALIASES: Array<[RegExp, string]> = [
  [/都|東京/, '東京'],
  [/神奈川|神/, '神奈川'],
  [/埼玉|埼/, '埼玉'],
  [/千葉|千/, '千葉'],
  [/茨城/, '茨城'],
];

function prefsIn(text: string): string[] {
  const out: string[] = [];
  for (const [re, name] of PREF_ALIASES) if (re.test(text)) out.push(name);
  return out;
}

/**
 * 受験者の住所の限定が、この教室の生徒に当てはまるか。
 * ★「都神外生」「都外生」は東京・神奈川の生徒は受けられない（埼玉・千葉の生徒向けの推薦）。
 *   NESTの教室は東京と神奈川なので、外生向けの区分を代表に選ぶと、受けられない基準で判定してしまう。
 * ★教室の都県が分からない（region=null）ときは限定の無い区分だけを当てはまるとみなす。
 */
export function scopeApplies(scope: string | null, region: Region | null): boolean {
  if (!scope) return true;
  if (!region) return false;
  const home = region === 'tokyo' ? '東京' : '神奈川';
  if (/外生/.test(scope)) {
    const excluded = prefsIn(scope.replace(/外生.*$/, ''));
    return !excluded.includes(home);
  }
  if (/生/.test(scope)) {
    const included = prefsIn(scope);
    return included.length === 0 || included.includes(home);
  }
  return true;
}

/**
 * 表に出す代表の区分を選ぶ。
 * ★既定は併願優遇（公私）。面談で一番よく使う（都立が第1志望の生徒の滑り止め）ため。
 *   （公）だけの区分は、公私が無いときに使う。併願が無い学校（推薦のみ・単願のみ）は推薦→単願。
 * ★教室の生徒が受けられない区分（都神外生など）は候補から外す。
 */
export function pickPrimaryRule(
  rules: readonly AdmissionRule[],
  region: Region | null
): AdmissionRule | null {
  const usable = rules.filter((r) => scopeApplies(r.applicantScope, region));
  const order: Array<(r: AdmissionRule) => boolean> = [
    (r) => r.kind === '併願' && !r.publicOnly,
    (r) => r.kind === '併願',
    (r) => r.kind === '推薦',
    (r) => r.kind === '単願',
  ];
  for (const test of order) {
    const hit = usable.filter(test).sort((a, b) => a.sortOrder - b.sortOrder)[0];
    if (hit) return hit;
  }
  return null;
}

export const ADMISSION_STATUS_LABEL: Record<AdmissionStatus, string> = {
  ok: '届いている',
  ok_with_bonus: '加点込みで届いている',
  conditional: '条件つき',
  bonus: '加点次第',
  short: '届かない',
  ng: '不可',
  na: '内申では決まらない',
  nodata: '内申が未入力',
};

/** 区分の見出し（「併願（公私）」「A推薦・都神外生」）。冊子の呼び方を優先する */
export function ruleHeading(rule: AdmissionRule): string {
  const extras: string[] = [];
  if (rule.gender) extras.push(rule.gender);
  return extras.length > 0 ? `${rule.examLabel}（${extras.join('・')}）` : rule.examLabel;
}

/** 仮判定の注記 */
export function provisionalNote(p: StudentReportCards['provisional']): string | null {
  if (p === '1学期') return '中3の1学期の評定で仮に判定';
  if (p === '2年学年末') return '中3の評定が無いので中2の学年末で仮に判定';
  return null;
}
