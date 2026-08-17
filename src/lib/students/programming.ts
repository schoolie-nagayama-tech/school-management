/**
 * プログラミング(HALLO)専科の生徒か判定。is_programming が ON かつ通常教科（'その他'以外）を
 * 1つも持たない場合のみ true。通常教科併用の生徒は対象外にしない。
 *
 * 成績・宿題等の指標がコース性質上合わないため、アラート等の対象から除外する目的で使う。
 * プログラミングは科目マスタに無く科目「その他」＋自由入力(subject_other)で登録される運用のため、
 * 「その他」以外の科目を1つでも受講していれば専科ではないとみなす。
 *
 * supabase クライアントに依存しない純粋関数として、alerts.ts（重いモジュール）とは
 * 別ファイルに切り出している。UI側から直接importして使う想定。
 */
export function isProgrammingOnlyStudent(student: {
  is_programming?: boolean | null;
  subjects?: Array<{ name: string }>;
}): boolean {
  if (!student.is_programming) return false;
  return !(student.subjects ?? []).some((s) => s.name !== 'その他');
}
