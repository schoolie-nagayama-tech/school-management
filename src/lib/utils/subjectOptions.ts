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
