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

// UUID は 1 件あたり約 37 文字（36 + 区切り）。`.in()` の id リストは GET の
// クエリ文字列に載るため、件数が多いと URL が長くなりすぎて Supabase ゲートウェイの
// URL 長制限に当たる恐れがある。300 件なら約 11KB に収まり安全マージンを確保できる。
const DEFAULT_ID_CHUNK = 300;

/**
 * `.in('col', ids)` を ids が多くても安全に実行する（**1 id につき結果が高々数行**の場合）。
 *
 * ids を chunkSize ずつに分割して複数回クエリし、結果を結合する。URL 長対策が主目的。
 *
 * 重要: このヘルパーは **各チャンク内ではページングしない**。`.in()` の結果行数が
 * id 数より大きくなりうる場合（1 対多の join / 集約で 1 id あたり複数行返る場合）、
 * 1 チャンクの結果が 1000 行を超えて切り捨てられる。その場合は {@link fetchAllInChunks}
 * を使うこと。1 id につき高々 1 行（PK 等値や 1 対 1）なら本関数で十分。
 *
 * fetchChunk は chunk を受け取り、その chunk で `.in()` 済みのクエリを返すこと。
 *
 * @throws error.message を持つ Error（いずれかのクエリがエラーを返した場合）
 */
export async function fetchInChunks<T>(
  ids: string[],
  fetchChunk: (chunk: string[]) => PromiseLike<PageResult>,
  chunkSize = DEFAULT_ID_CHUNK
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

/**
 * id チャンク分割（URL 長対策）と、各チャンク内の `.range()` ページング（1000 行上限対策）を
 * 両立する。`.in()` の結果が 1 id あたり複数行になりうる（1 対多 join / 集約）場合に使う。
 *
 * buildQuery は (chunk, from, to) を受け取り、chunk で `.in()` 済みかつ
 * `.order(...).range(from, to)` を付与済みのクエリを返すこと。安定ページングのため
 * 必ず一意な列（id など）を含むソート順で order すること。
 *
 * @throws error.message を持つ Error（いずれかのクエリがエラーを返した場合）
 */
export async function fetchAllInChunks<T>(
  ids: string[],
  buildQuery: (chunk: string[], from: number, to: number) => PromiseLike<PageResult>,
  chunkSize = DEFAULT_ID_CHUNK
): Promise<T[]> {
  const all: T[] = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const rows = await fetchAllPaged<T>((from, to) => buildQuery(chunk, from, to));
    all.push(...rows);
  }
  return all;
}
