import { USER_ROLE_LEVELS, type UserRole } from '@/types/database';

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
