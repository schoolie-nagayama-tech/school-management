import { USER_ROLE_LEVELS, ROLE_PERMISSIONS, type UserRole } from '@/types/database';

/**
 * ロール階層に基づく権限判定ヘルパー。
 *
 * アプリ各所に `profile.role === 'manager' || 'owner' || 'admin'` のような
 * ロール直書きが散在していたため、ここに一本化する。
 * 判定はすべて USER_ROLE_LEVELS（数値が大きいほど上位）を基準にする。
 */

/** role を正規化して階層値を返す（未知/未設定は 0） */
function roleLevel(role: string | null | undefined): number {
  if (!role) return 0;
  return USER_ROLE_LEVELS[role.toLowerCase() as UserRole] ?? 0;
}

/** role が minRole 以上の階層かを判定する */
export function hasRoleLevel(role: string | null | undefined, minRole: UserRole): boolean {
  return roleLevel(role) >= USER_ROLE_LEVELS[minRole];
}

/** 教室長（manager）以上か。manager / owner / admin が true。 */
export function isManagerOrAbove(role: string | null | undefined): boolean {
  return hasRoleLevel(role, 'manager');
}

/** エリアマネージャー（owner）以上か。owner / admin が true。 */
export function isOwnerOrAbove(role: string | null | undefined): boolean {
  return hasRoleLevel(role, 'owner');
}

/** システム管理者（admin）か。 */
export function isSystemAdmin(role: string | null | undefined): boolean {
  return (role ?? '').toLowerCase() === 'admin';
}

/** 講師（teacher）か。 */
export function isTeacher(role: string | null | undefined): boolean {
  return (role ?? '').toLowerCase() === 'teacher';
}

/**
 * 成績編集権限があるか（講師も含む・保護者は不可）。
 *
 * ★ ROLE_PERMISSIONS.canEditScores をそのまま参照する理由:
 *   成績編集の境界は元々 src/types/database.ts の ROLE_PERMISSIONS で
 *   admin/owner/manager/teacher=true, parent=false と定義済み（StudentScores 等の画面が使用）。
 *   保護者ポータルv2 Stage5 の成績承認（§7-5）は「承認＝成績を書く行為」なので同じ境界に置く、
 *   という設計判断（正典 §7-5）。ここで別の判定を新設せず、既存の定義元を参照するだけにする
 *   （2箇所に書くと片方だけ更新されてズレる）。
 */
export function canEditScores(role: string | null | undefined): boolean {
  if (!role) return false;
  const key = role.toLowerCase() as UserRole;
  return ROLE_PERMISSIONS[key]?.canEditScores === true;
}

/**
 * actorRole の人が、誰かに newRole を付けてよいか（ユーザー作成・編集・招待で共通）。
 *
 * ★ 規則は「自分より下のロールだけ付けられる」。同じレベルも不可（管理者が管理者を増やすのは
 *   DB で直接行う運用）。src/app/api/admin/users/create/route.ts の既存の判定と同じ。
 * ★ 未知のロール名は false。以前は未知の値がレベル0扱いで検査を素通りし、
 *   DB の CHECK 制約だけが頼りになっていた。
 *
 * 2026-09-30 のセキュリティ総点検で、編集APIが「相手のいまのロール」しか見ておらず
 * 「新しく付けるロール」を見ていなかった（教室長が講師を admin に昇格できた）ため共通化した。
 */
export function canAssignRole(
  actorRole: string | null | undefined,
  newRole: string | null | undefined
): boolean {
  if (typeof newRole !== 'string') return false;
  const key = newRole.toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(USER_ROLE_LEVELS, key)) return false;
  return roleLevel(key) < roleLevel(actorRole);
}

/** actorRole の人が、targetRole の人を編集・削除してよいか（相手が自分より下のときだけ）。 */
export function canManageUserWithRole(
  actorRole: string | null | undefined,
  targetRole: string | null | undefined
): boolean {
  return roleLevel(targetRole) < roleLevel(actorRole);
}
