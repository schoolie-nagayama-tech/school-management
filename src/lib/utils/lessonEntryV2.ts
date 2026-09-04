/**
 * 通塾日程v2（編集モーダル・授業追加・変更履歴・開始日指定）を出すか。
 *
 * 座席表の運用を始めた教室から順に開けていく段階公開。
 * 一斉に切り替えると、まだ座席表を使っていない教室の講師・教室長が
 * 「見たことのないUI」に当たって混乱するため、教室単位で開ける。
 *
 * 公開の手順:
 *  1. その教室で座席表の運用を始める
 *  2. 下の LESSON_ENTRY_V2_SCHOOL_IDS にその教室のIDを足す（1行）
 *  3. 全教室に行き渡ったら、この関数を無条件 true にして定数ごと消す
 *
 * 判定はこの1か所に集約すること（呼び出し側で role を直接見ない）。
 */

import { hasRoleLevel, isSystemAdmin } from '@/lib/utils/roles';

/**
 * 通塾日程v2を有効にする教室のID。
 *
 * 教室ID（本番）:
 *   デモ校（保護者ポータル体験） d0000000-0000-4000-8000-000000000001
 *   デフォルト教室               d0dea5b6-7f4c-4160-9ea6-3b91b4f895a0
 *   永山校                       d187f7a3-633a-46ce-8d32-c56c85d17bac
 *   京王堀之内校                 9f519794-3673-4e90-b1ea-88a79f70174a
 *   清瀬校                       e26b398c-8e30-47bc-b528-ee92fd45be7f
 *   緑園都市校                   9a6b5996-a266-47ed-878f-85e93c2b8b90
 */
const LESSON_ENTRY_V2_SCHOOL_IDS: ReadonlySet<string> = new Set([
  // デモ校（保護者ポータル体験）。本番の教室を触らずに試すための場所。
  'd0000000-0000-4000-8000-000000000001',
]);

/**
 * v2 のUIを出してよいか。
 *
 * @param role  user_profiles.role
 * @param schoolId 対象の教室ID（生徒詳細なら生徒の所属校、座席表なら表示中の教室）
 *
 * - admin … 動作確認のためどの教室でも使える
 * - 講師・教室長 … 有効化した教室にいるときだけ
 * - 保護者・ロール未設定 … 常に false
 *   ★教室で判定する前に必ずロールを見ること。教室だけで判定すると、有効化した教室の
 *     保護者アカウント（/mypage）にまで職員用UIが出る。
 *   教室IDが分からないときも出さない（安全側）。
 */
export function canUseLessonEntryV2(
  role: string | null | undefined,
  schoolId?: string | null
): boolean {
  if (isSystemAdmin(role)) return true;
  // 職員（講師以上）でなければどの教室でも出さない
  if (!hasRoleLevel(role, 'teacher')) return false;
  if (!schoolId) return false;
  return LESSON_ENTRY_V2_SCHOOL_IDS.has(schoolId);
}
