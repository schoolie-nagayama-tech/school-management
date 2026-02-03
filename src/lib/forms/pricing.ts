/**
 * 価格表（GAS移植）
 */

export const GRADE_PRICE: Record<string, number> = {
  中1: 3980,
  中2: 3980,
  中3: 3980,
  高1: 4480,
  高2: 4480,
  高3: 4480,
};

/**
 * 学年ラベルから価格を取得
 */
export function getPriceByGrade(gradeLabel: string): number {
  return GRADE_PRICE[gradeLabel] || 0;
}

/**
 * 学年（1-13）から価格を取得
 */
export function getPriceByGradeNumber(grade: number): number {
  const gradeLabels: Record<number, string> = {
    7: '中1',
    8: '中2',
    9: '中3',
    10: '高1',
    11: '高2',
    12: '高3',
  };
  const label = gradeLabels[grade];
  return label ? GRADE_PRICE[label] : 0;
}
