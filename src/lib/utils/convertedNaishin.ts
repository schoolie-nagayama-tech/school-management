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
  const values = allSubjects.map((s) => scores[s]).filter(
    (v): v is number => v !== null && v !== undefined
  );

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

/**
 * 換算内申を計算する
 */
export function calcNaishin(
  scores: Record<string, number | null>,
  type: NaishinType
): NaishinResult {
  return type === 'tokyo' ? calcTokyoNaishin(scores) : calcKanagawaNaishin(scores);
}
