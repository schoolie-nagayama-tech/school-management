/**
 * フルネームから苗字のみ抽出する。
 * 講師権限のユーザーには個人情報保護のため苗字のみ表示する。
 * 全角・半角スペースの両方に対応。スペースなしの場合はそのまま返す。
 */
export function toSurnameOnly(name: string | null | undefined): string {
  if (!name) return '';
  const parts = name.trim().split(/[\s　]+/);
  return parts[0] || name;
}
