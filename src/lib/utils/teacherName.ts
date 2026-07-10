import type { UserProfile } from '@/types/database';

/**
 * プロファイルから苗字のみ取得する。
 * last_name が設定済みならそれを返す。
 * 未設定なら display_name をスペースで分割して先頭を返す（後方互換）。
 * 講師権限のユーザーには個人情報保護のため苗字のみ表示する。
 */
export function getSurname(
  profile:
    | { last_name?: UserProfile['last_name']; display_name: UserProfile['display_name'] }
    | null
    | undefined
): string {
  if (!profile) return '';
  if (profile.last_name) return profile.last_name;
  return toSurnameOnly(profile.display_name);
}

/**
 * フルネーム文字列から苗字のみ抽出する（フォールバック用）。
 * 全角・半角スペースの両方に対応。スペースなしの場合はそのまま返す。
 */
export function toSurnameOnly(name: string | null | undefined): string {
  if (!name) return '';
  const parts = name.trim().split(/[\s　]+/);
  return parts[0] || name;
}
