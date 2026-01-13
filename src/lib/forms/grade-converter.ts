/**
 * 学年変換ユーティリティ
 */

import { GRADE_LABELS } from '@/types/database';

/**
 * 学年ラベル（中1, 中2, ...）から数値（7-12）に変換
 */
export function gradeLabelToNumber(label: string): number | null {
  const mapping: Record<string, number> = {
    中1: 7,
    中2: 8,
    中3: 9,
    高1: 10,
    高2: 11,
    高3: 12,
  };
  return mapping[label] || null;
}

/**
 * 学年数値（7-12）からラベル（中1, 中2, ...）に変換
 */
export function gradeNumberToLabel(grade: number): string {
  const mapping: Record<number, string> = {
    7: '中1',
    8: '中2',
    9: '中3',
    10: '高1',
    11: '高2',
    12: '高3',
  };
  return mapping[grade] || '';
}

/**
 * 増コマフォームで選択可能な学年オプション
 */
export const KOMA_GRADE_OPTIONS = [
  { value: 7, label: '中1' },
  { value: 8, label: '中2' },
  { value: 9, label: '中3' },
  { value: 10, label: '高1' },
  { value: 11, label: '高2' },
  { value: 12, label: '高3' },
];
