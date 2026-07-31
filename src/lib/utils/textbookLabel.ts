/**
 * テキスト（教材）の対象学年表示。
 *
 * textbooks.school_type（'小学'/'中学'/'高校'）と textbooks.grade（'5年'/'共通' 等）は
 * どちらも表示用の文字列で、連結してはじめて「小学5年」と読める。片方だけ出すと
 * 「5年」が小5なのか中1相当なのか分からなくなるため、必ずこの関数で組み立てる。
 *
 * ★ 生徒の学年（students.grade: 1〜13 の数値）とは別物。
 *   そちらは GRADE_LABELS を引く formatGradeLabel / 進行表用の gradeLabel を使う。
 *
 * @returns 連結した学年表示。どちらも未設定なら空文字（呼び出し側で出し分ける）
 */
export function formatTextbookGrade(schoolType?: string | null, grade?: string | null): string {
  return [schoolType ?? '', grade ?? ''].join('').trim();
}

/**
 * テキストの属性表示（対象学年・科目）。進行表ヘッダーでテキスト名に添える。
 *
 * ★ 欠けている項目は詰める: 本番に学年・学校種別が未設定のテキストが実在するため、
 *   素直に連結すると「・算数」のように中黒だけが残る。
 *
 * @returns 例 '小学6年・算数'。どちらも無ければ空文字（呼び出し側で非表示にする）
 */
export function formatTextbookMeta(
  schoolType?: string | null,
  grade?: string | null,
  subject?: string | null
): string {
  return [formatTextbookGrade(schoolType, grade), subject ?? ''].filter(Boolean).join('・');
}
