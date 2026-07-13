import type { Subject } from '@/types/database';

/**
 * 科目セレクトの表示用ヘルパー。
 *
 * 科目マスタは学年区分（小/中/高）×時間（45分/90分）ごとに同名の行を持つ
 * （例: name='算数' が elementary×45分 と elementary×90分 で2行）。
 * セレクトに name だけを出すと同名が複数並んで区別できないため、
 * 学年区分の optgroup ＋ 45分表記でラベルを一意にする。
 */

const GRADE_CATEGORY_LABELS: Record<string, string> = {
  elementary: '小学生',
  middle: '中学生',
  high: '高校生',
};

const GRADE_CATEGORY_ORDER = ['elementary', 'middle', 'high'];

/** 45分科目は「算数（45分）」のように時間を明示する。90分（既定）は無印。 */
export function subjectOptionLabel(s: Pick<Subject, 'name' | 'duration_minutes'>): string {
  return s.duration_minutes === 45 ? `${s.name}（45分）` : s.name;
}

export interface SubjectOptionGroup {
  /** optgroup ラベル（小学生/中学生/高校生/その他） */
  label: string;
  subjects: Subject[];
}

/** 学年区分（科目の grade_category と対応）。 */
export type SubjectGradeCategory = 'elementary' | 'middle' | 'high';

/** 生徒の数値学年 → 学年区分（1-6=小 / 7-9=中 / 10+=高）。 */
export function gradeCategoryFromStudentGrade(
  grade: number | null | undefined
): SubjectGradeCategory {
  const g = grade ?? 0;
  if (g <= 6) return 'elementary';
  if (g <= 9) return 'middle';
  return 'high';
}

/**
 * 見込み客（inquiries.grade は「中2」「小5」「高1」等のテキスト）から学年区分を推定。
 * 先頭文字（小/中/高）で判定し、推定不能なら null（＝絞り込まず全区分表示）を返す。
 */
export function gradeCategoryFromInquiryGrade(
  gradeText: string | null | undefined
): SubjectGradeCategory | null {
  const t = (gradeText ?? '').trim();
  if (!t) return null;
  const head = t[0];
  if (head === '小') return 'elementary';
  if (head === '中') return 'middle';
  if (head === '高') return 'high';
  return null;
}

/**
 * 科目を対象者の学年区分で絞り込む（P2改訂・2026-07-13）。
 * gradeCategory が null（未選択・推定不能）のときは絞らず全件返す。
 * 該当区分の科目がゼロの場合は空配列を返す（呼び出し側でフォールバック＝全表示＋注意文を出す）。
 */
export function filterSubjectsForGrade(
  subjects: Subject[],
  gradeCategory: SubjectGradeCategory | null
): Subject[] {
  if (!gradeCategory) return subjects;
  return subjects.filter((s) => (s.grade_category ?? null) === gradeCategory);
}

/** 学年区分ごとにグルーピング（小→中→高→その他の順、区分内は入力順を維持）。 */
export function groupSubjectsForSelect(subjects: Subject[]): SubjectOptionGroup[] {
  const byCategory = new Map<string, Subject[]>();
  for (const s of subjects) {
    const key = s.grade_category ?? 'other';
    const list = byCategory.get(key) ?? [];
    list.push(s);
    byCategory.set(key, list);
  }
  const groups: SubjectOptionGroup[] = [];
  for (const key of GRADE_CATEGORY_ORDER) {
    const list = byCategory.get(key);
    if (list && list.length > 0) groups.push({ label: GRADE_CATEGORY_LABELS[key], subjects: list });
    byCategory.delete(key);
  }
  // 未知の区分・区分なしは末尾に「その他」としてまとめる
  const rest = Array.from(byCategory.values()).flat();
  if (rest.length > 0) groups.push({ label: 'その他', subjects: rest });
  return groups;
}
