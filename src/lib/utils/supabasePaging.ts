/**
 * PostgREST のデフォルト 1000 行上限対策のための共通ヘルパー。
 *
 * Supabase(PostgREST) の `.select()` は `.range()` を付けないと結果が **1000 行で
 * 静かに切り捨てられる**（エラーにならない）。生徒数 × 項目数などでスケールする
 * テーブルでは、行数が 1000 を超えた途端に一部データが「消える」症状になり、
 * 原因特定が難しいバグになる。スケールするテーブルへの複数行取得は必ず
 * これらのヘルパーで全件取得すること。
 */

// Supabase のクエリビルダーは join select 等で data の型が一定しないため、
// data は unknown[] で受け、呼び出し側の総称型 T へキャストして返す。
type PageResult = { data: unknown[] | null; error: { message: string; code?: string } | null };

/**
 * `.range()` で 1 ページ 1000 件ずつページングし、全件を取得する。
 *
 * buildQuery は from/to を受け取り、`.order(...)` と `.range(from, to)` を付与済みの
 * クエリ（PromiseLike）を返すこと。安定ページングのため、必ず一意な列（id など）を
 * 含むソート順で order すること。並び順が一意でないと、ページ境界で行が重複・欠落しうる。
 *
 * @throws error.message を持つ Error（クエリがエラーを返した場合）
 */
export async function fetchAllPaged<T>(
  buildQuery: (from: number, to: number) => PromiseLike<PageResult>
): Promise<T[]> {
  const PAGE_SIZE = 1000;
  const all: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await buildQuery(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const rows = (data || []) as T[];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return all;
}

/**
 * `.in('col', ids)` を ids が 1000 を超えても安全に実行する。
 *
 * `.in()` に 1000 を超える ids を渡すと、ヒット件数自体が 1000 行で切り捨てられる。
 * ids を chunkSize ずつに分割して複数回クエリし、結果を結合する。
 *
 * fetchChunk は ids の一部（chunk）を受け取り、その chunk で `.in()` 済みの
 * クエリ（PromiseLike）を返すこと。
 *
 * @throws error.message を持つ Error（いずれかのクエリがエラーを返した場合）
 */
export async function fetchInChunks<T>(
  ids: string[],
  fetchChunk: (chunk: string[]) => PromiseLike<PageResult>,
  chunkSize = 1000
): Promise<T[]> {
  const all: T[] = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const { data, error } = await fetchChunk(chunk);
    if (error) throw new Error(error.message);
    all.push(...((data || []) as T[]));
  }
  return all;
}
