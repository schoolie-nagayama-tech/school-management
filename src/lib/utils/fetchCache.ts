/**
 * フェッチ関数の結果をメモリキャッシュする汎用ラッパー。
 * 同一引数での連続呼び出しを TTL 内で抑制し、
 * ページ遷移時の不要な API リクエストを削減する。
 *
 * 使い方:
 *   const getCachedStudents = withFetchCache(getStudents, { ttl: 30_000 });
 *   const data = await getCachedStudents('query', ['schoolId']);
 */

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();
const pending = new Map<string, Promise<unknown>>();

interface WithFetchCacheOptions {
  /** キャッシュ有効期限 (ms)。デフォルト 30秒 */
  ttl?: number;
  /** キャッシュキーのプレフィックス。省略時は関数名を使用 */
  prefix?: string;
}

/**
 * 非同期関数をキャッシュ付きでラップする。
 * 引数を JSON シリアライズしてキャッシュキーとする。
 * 返り値の関数には .invalidate() メソッドを追加。
 */
export function withFetchCache<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  options: WithFetchCacheOptions = {}
): ((...args: TArgs) => Promise<TResult>) & { invalidate: () => void } {
  const { ttl = 30_000, prefix = fn.name || 'anon' } = options;

  function cached(...args: TArgs): Promise<TResult> {
    const key = `${prefix}:${JSON.stringify(args)}`;

    // キャッシュヒット
    const entry = store.get(key) as CacheEntry<TResult> | undefined;
    if (entry && Date.now() < entry.expiresAt) {
      return Promise.resolve(entry.data);
    }

    // 同一キーのリクエストが進行中なら合流
    const inflight = pending.get(key) as Promise<TResult> | undefined;
    if (inflight) return inflight;

    const promise = fn(...args)
      .then((result) => {
        store.set(key, { data: result, expiresAt: Date.now() + ttl });
        pending.delete(key);
        return result;
      })
      .catch((err) => {
        pending.delete(key);
        throw err;
      });

    pending.set(key, promise);
    return promise;
  }

  cached.invalidate = () => {
    Array.from(store.keys()).forEach((k) => {
      if (k.startsWith(`${prefix}:`)) {
        store.delete(k);
      }
    });
  };

  return cached;
}

/** 全キャッシュをクリア（ログアウト時など） */
export function clearAllFetchCache() {
  store.clear();
  pending.clear();
}
