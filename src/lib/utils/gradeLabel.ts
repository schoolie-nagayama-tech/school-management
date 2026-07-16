import { GRADE_LABELS } from '@/types/database';

/**
 * 学年の数値を表示ラベルにする（8 → '中2'）。
 *
 * ★ なぜ進行表の gradeLabel（app/students/[studentId]/progress/newProgress.shared.ts）を
 *   使わないか: あちらは講師向け進行表の表記（'中学2年生'）で、主体も文脈も違う。
 *   ポータル（保護者向け）から進行表のモジュールに依存させると、進行表の表記を変えた
 *   だけで保護者の画面が巻き添えで変わる。表記の正典 GRADE_LABELS を直接引く。
 *
 * ★ 範囲外（GRADE_LABELS に無い値）は `${grade}年` にフォールバックする:
 *   学年は将来増えうるし、データ不整合で 0 や 99 が入ることもある。
 *   ラベルが引けないだけで画面を壊さない（表示は崩れるが読める）。
 */
export function formatGradeLabel(grade: number): string {
  return GRADE_LABELS[grade] ?? `${grade}年`;
}
