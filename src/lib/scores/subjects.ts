/**
 * 成績（assessments）の科目コード定義。
 *
 * ★ なぜ切り出すか（2026-07-17 保護者ポータルv2 Stage5 で追加）:
 *   COMMON_9_SUBJECTS は元々 src/lib/api/assessments.ts（スタッフ用ブラウザクライアント）に
 *   プライベート定義されていたが、保護者の成績申請バリデーション（scoreValidation.ts）と
 *   スタッフの承認時の転記処理（score-submissions/[id]/approve）の両方が同じ「9科目の集合」を
 *   知る必要がある。3箇所に同じ配列を書き写すと、将来1箇所だけ更新されてズレる事故が起きるため、
 *   ここに一本化して両方から import する（assessments.ts の挙動は変えないリファクタのみ）。
 */

/** 共通9科の科目コード（定期テスト・内申で使う）。 */
export const COMMON_9_SUBJECTS = [
  'english',
  'math',
  'japanese',
  'social',
  'science',
  'music',
  'art',
  'tech_home',
  'pe',
] as const;

export type CommonSubjectCode = (typeof COMMON_9_SUBJECTS)[number];

/** 値が COMMON_9_SUBJECTS のいずれかに一致するかを判定する（unknown 入力向け）。 */
export function isCommonSubjectCode(value: unknown): value is CommonSubjectCode {
  return typeof value === 'string' && (COMMON_9_SUBJECTS as readonly string[]).includes(value);
}
