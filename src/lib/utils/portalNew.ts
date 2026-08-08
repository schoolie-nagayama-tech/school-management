/**
 * 保護者ポータルの「New」表示ルール。
 *
 * ポータルのメニューは顔ぶれが固定で手動の並び順も変わらないため、保護者からは
 * 「今どれが新しく受付を始めたのか」が分からない。フォーム期間の受付開始日から
 * PORTAL_NEW_DAYS 日間だけ New バッジを付け、リストの先頭に浮上させる。
 */

/** New バッジを出す日数（受付開始日から） */
export const PORTAL_NEW_DAYS = 7;

/**
 * 受付開始日が「直近 PORTAL_NEW_DAYS 日以内」か。
 * 未設定・不正な日付は New 扱いにしない。開始日が未来のものも対象外
 * （受付前のメニューはそもそも受付中にならないため、ここでも保険で弾く）。
 */
export function isRecentlyOpened(
  publishedAt: string | null | undefined,
  now: number = Date.now()
): boolean {
  if (!publishedAt) return false;
  const opened = Date.parse(publishedAt);
  if (Number.isNaN(opened)) return false;
  if (opened > now) return false;
  return now - opened <= PORTAL_NEW_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * New のものを先頭（受付開始が新しい順）に、それ以外は元の並び（手動の sort_order）のまま返す。
 * Array.prototype.sort は安定ソートなので、New でない要素同士の順序は入力順が保たれる。
 */
export function sortNewFirst<T>(
  items: T[],
  getPublishedAt: (item: T) => string | null | undefined,
  now: number = Date.now()
): T[] {
  return [...items].sort((a, b) => {
    const aNew = isRecentlyOpened(getPublishedAt(a), now);
    const bNew = isRecentlyOpened(getPublishedAt(b), now);
    if (aNew !== bNew) return aNew ? -1 : 1;
    if (!aNew) return 0;
    return Date.parse(getPublishedAt(b)!) - Date.parse(getPublishedAt(a)!);
  });
}
