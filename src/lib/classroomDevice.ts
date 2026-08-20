import { isTeacher } from '@/lib/utils/roles';

/**
 * 講師の「教室外モード」判定（クライアント/サーバー共用の純関数）。
 *
 * 正典: docs/classroom-device-plan.md §1・§2
 *
 * 判定式は1つだけ:
 *   role=teacher かつ 信頼済み端末（教室端末マーク）でない → 教室外モード。
 *   manager 以上は管理責任側なので教室外でもフル機能（教室外モードにならない）。
 *
 * ★ この境界を各所に散らさないこと:
 *   ページゲート（ClassroomDeviceGate）・ナビの出し分け（navConfig / MobileBottomNav）が
 *   同じ関数と同じパスリストを見ることで、「メニューには出ないのに開ける」
 *   「ブロックされるのにリンクは生きている」というズレを防ぐ。
 */

/**
 * 教室の端末でのみ開ける機能のパス（前方一致）。
 *
 * 正典 §1-5「教室限定セット」= 生徒管理・進行表・報告書・成績・座席表・回答一覧・
 * テスト対策・申込状況・面談。
 *
 * ★ ここに入れていない＝教室外OK（§1-4）:
 *   /today（本日の授業）・/my-schedule（自分の予定）・/attendance（自分の出勤簿）・
 *   /my/badges（研修バッジ）・シフト提出/確認・連絡掲示板・/settings/account・/help。
 *   「教室外から自分の予定と勤怠だけ見る」を成立させるための最小セットなので、
 *   ここへ安易に追加しない（追加＝講師が家で何もできなくなる方向）。
 */
export const CLASSROOM_ONLY_PREFIXES: readonly string[] = [
  '/students',
  '/progress-feed',
  '/lesson-reports',
  '/schedule',
  '/responses',
  '/forms',
  '/test-prep-proposals',
  '/test-prep',
  '/applications',
  '/interview',
];

/**
 * 教室外モード（教室限定機能を制限すべき状態）か。
 * @param role ログインユーザーのロール
 * @param isTrustedDevice この端末が教室端末として登録済みか
 */
export function isOutsideClassroom(
  role: string | null | undefined,
  isTrustedDevice: boolean
): boolean {
  return isTeacher(role) && !isTrustedDevice;
}

/**
 * そのパスが教室限定かを前方一致で判定する。
 *
 * 一致の粒度は「完全一致 or 配下（prefix + '/'）」。単純な startsWith にすると
 * '/interview' が検討用モックの '/interview-mock' まで巻き込むため使わない
 * （navConfig の exact 判定と同じ事故を避ける）。
 */
export function isClassroomOnlyPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return CLASSROOM_ONLY_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + '/')
  );
}
