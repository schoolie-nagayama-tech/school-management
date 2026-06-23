// 科目バッジの配色を一元管理する。提案書・講座一覧など複数画面で同じ色味を使うため、
// 各画面で個別定義していたものをここに集約する（色がズレると科目の識別がしづらくなる）。
export const SUBJECT_BADGE_COLORS: Record<string, { bg: string; text: string }> = {
  英語: { bg: 'bg-blue-50', text: 'text-blue-700' },
  数学: { bg: 'bg-red-50', text: 'text-red-700' },
  算数: { bg: 'bg-red-50', text: 'text-red-700' },
  国語: { bg: 'bg-green-50', text: 'text-green-700' },
  理科: { bg: 'bg-amber-50', text: 'text-amber-700' },
  社会: { bg: 'bg-purple-50', text: 'text-purple-700' },
};

export const DEFAULT_SUBJECT_BADGE_COLOR = { bg: 'bg-gray-100', text: 'text-gray-600' };

// 未知の科目名でも必ず配色を返すヘルパー。呼び出し側の `?? DEFAULT` を省ける。
export function getSubjectBadgeColor(subject: string | null | undefined): {
  bg: string;
  text: string;
} {
  if (!subject) return DEFAULT_SUBJECT_BADGE_COLOR;
  return SUBJECT_BADGE_COLORS[subject] ?? DEFAULT_SUBJECT_BADGE_COLOR;
}
