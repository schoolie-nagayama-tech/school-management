/**
 * 換算内申の計算ユーティリティ
 */

export type NaishinType = 'tokyo' | 'kanagawa';

export interface NaishinResult {
  /** 5科（英数国理社）の合計 */
  five_subject_total: number | null;
  /** 実技4科の合計（素点） */
  four_subject_total: number | null;
  /** 換算内申の値 */
  converted: number | null;
  /** 満点 */
  max_score: number;
  /** 計算方式の表示名 */
  label: string;
}

const FIVE_SUBJECTS = ['english', 'math', 'japanese', 'social', 'science'] as const;
const FOUR_SUBJECTS = ['music', 'art', 'tech_home', 'pe'] as const;

/**
 * 都立の換算内申を計算
 * 5科×1 + 実技4科×2 = 65点満点
 */
export function calcTokyoNaishin(scores: Record<string, number | null>): NaishinResult {
  const fiveValues = FIVE_SUBJECTS.map((s) => scores[s]).filter(
    (v): v is number => v !== null && v !== undefined
  );
  const fourValues = FOUR_SUBJECTS.map((s) => scores[s]).filter(
    (v): v is number => v !== null && v !== undefined
  );

  const fiveTotal = fiveValues.length > 0 ? fiveValues.reduce((sum, v) => sum + v, 0) : null;
  const fourTotal = fourValues.length > 0 ? fourValues.reduce((sum, v) => sum + v, 0) : null;

  let converted: number | null = null;
  if (fiveTotal !== null || fourTotal !== null) {
    converted = (fiveTotal ?? 0) + (fourTotal ?? 0) * 2;
  }

  return {
    five_subject_total: fiveTotal,
    four_subject_total: fourTotal,
    converted,
    max_score: 65,
    label: '都立',
  };
}

/**
 * 神奈川の換算内申を計算（単一行版）
 * 9科合計のみ（中2×1 + 中3×2 は将来対応）
 */
export function calcKanagawaNaishin(scores: Record<string, number | null>): NaishinResult {
  const allSubjects = [...FIVE_SUBJECTS, ...FOUR_SUBJECTS] as const;
  const values = allSubjects
    .map((s) => scores[s])
    .filter((v): v is number => v !== null && v !== undefined);

  const fiveValues = FIVE_SUBJECTS.map((s) => scores[s]).filter(
    (v): v is number => v !== null && v !== undefined
  );
  const fourValues = FOUR_SUBJECTS.map((s) => scores[s]).filter(
    (v): v is number => v !== null && v !== undefined
  );

  const fiveTotal = fiveValues.length > 0 ? fiveValues.reduce((sum, v) => sum + v, 0) : null;
  const fourTotal = fourValues.length > 0 ? fourValues.reduce((sum, v) => sum + v, 0) : null;

  let converted: number | null = null;
  if (values.length > 0) {
    converted = values.reduce((sum, v) => sum + v, 0);
  }

  return {
    five_subject_total: fiveTotal,
    four_subject_total: fourTotal,
    converted,
    max_score: 45,
    label: '神奈川',
  };
}

/* ============================================================
 * 神奈川県公立入試の内申（135点満点）
 * ========================================================== */

/** 通知表1回分（report_card の1件）。name_code と9教科の評定 */
export interface ReportCardInput {
  /** assessments.name_code（term1 / term2 / year_end / first / second） */
  nameCode: string;
  scores: Record<string, number | null>;
}

export interface KanagawaNaishin135Result {
  /** 中2学年末×1 ＋ 中3×2 */
  converted: number;
  /** 中2学年末の9教科合計（45点満点） */
  grade8Total: number;
  /** 中3の9教科合計（45点満点・×2する前） */
  grade9Total: number;
  max_score: 135;
  /**
   * ★中3の評定が1学期（前期）しか無く、それで仮に計算した値。
   *   入試に使うのは2学期（2期制は後期）の評定なので、面談では「仮計算」と添えて言う。
   */
  provisional: boolean;
  label: string;
}

/** 中3の評定として入試に使える（確定扱いにできる）name_code */
const KANAGAWA_GRADE9_FINAL_CODES = new Set(['term2', 'second', 'year_end']);
/** 中3の評定として仮計算に使う name_code（1学期・前期） */
const KANAGAWA_GRADE9_PROVISIONAL_CODES = new Set(['term1', 'first']);

/** 9教科すべてに評定が入っているときだけ合計を返す。1つでも欠けたら null（推測で埋めない） */
function sumNineSubjects(scores: Record<string, number | null>): number | null {
  let total = 0;
  for (const s of [...FIVE_SUBJECTS, ...FOUR_SUBJECTS]) {
    const v = scores[s];
    if (v === null || v === undefined || !Number.isFinite(v)) return null;
    total += v;
  }
  return total;
}

/**
 * 神奈川県公立入試の内申（135点満点）＝ 中2学年末の9教科合計×1 ＋ 中3の9教科合計×2。
 *
 * ★既存の calcKanagawaNaishin（1行の9教科合計・45点満点）は成績一覧の列で使っているので
 *   挙動を変えずに残し、2行を受け取るこの関数を別に置く。
 * ★中3は2学期（2期制は後期）の評定が入試に使われる。それより前の1学期（前期）しか無いときは
 *   その値で計算して provisional=true を返す（面談の時期はまだ2学期の評定が出ていないことが多く、
 *   null にすると秋の面談で数字が一度も出ない）。
 * ★中2学年末が無い・9教科のどれかが欠けている・name_code が想定外のときは null。
 *   足りない教科を平均で埋めるような推測はしない（面談で保護者に言う数字なので）。
 */
export function calcKanagawaNaishin135(
  grade8YearEnd: ReportCardInput | null | undefined,
  grade9Latest: ReportCardInput | null | undefined
): KanagawaNaishin135Result | null {
  if (!grade8YearEnd || !grade9Latest) return null;

  const isFinal = KANAGAWA_GRADE9_FINAL_CODES.has(grade9Latest.nameCode);
  const isProvisional = KANAGAWA_GRADE9_PROVISIONAL_CODES.has(grade9Latest.nameCode);
  if (!isFinal && !isProvisional) return null;

  const grade8Total = sumNineSubjects(grade8YearEnd.scores);
  const grade9Total = sumNineSubjects(grade9Latest.scores);
  if (grade8Total == null || grade9Total == null) return null;

  return {
    converted: grade8Total + grade9Total * 2,
    grade8Total,
    grade9Total,
    max_score: 135,
    provisional: !isFinal,
    label: isFinal ? '換算内申' : '換算内申（中3は1学期の評定で仮計算）',
  };
}

/**
 * 換算内申を計算する
 */
export function calcNaishin(
  scores: Record<string, number | null>,
  type: NaishinType
): NaishinResult {
  return type === 'tokyo' ? calcTokyoNaishin(scores) : calcKanagawaNaishin(scores);
}
