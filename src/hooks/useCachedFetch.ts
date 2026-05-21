/**
 * クライアント側のデータフェッチキャッシュ。
 * 同一キーへのフェッチ結果を TTL 付きでメモリに保持し、
 * ページ遷移時の不要な再リクエストを抑制する。
 *
 * SWR/React Query を導入せず、最小限の依存で同等の効果を得るための実装。
 */
import { useState, useEffect, useCallback, useRef } from 'react';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

// グローバルキャッシュ（ページ遷移で失われない）
const cache = new Map<string, CacheEntry<unknown>>();

// 同一キーへの並行リクエストを抑制するための進行中Promise
const inflight = new Map<string, Promise<unknown>>();

const DEFAULT_TTL_MS = 60_000; // 1分

interface UseCachedFetchOptions {
  /** キャッシュの有効期限 (ms)。デフォルト 60秒 */
  ttl?: number;
  /** true でキャッシュをスキップして再フェッチ */
  forceRefresh?: boolean;
  /** false を渡すとフェッチを実行しない（条件付きフェッチ用） */
  enabled?: boolean;
}

interface UseCachedFetchResult<T> {
  data: T | null;
  isLoading: boolean;
  error: string | null;
  /** キャッシュを無効化して再フェッチ */
  refresh: () => Promise<void>;
}

export function useCachedFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  options: UseCachedFetchOptions = {}
): UseCachedFetchResult<T> {
  const { ttl = DEFAULT_TTL_MS, forceRefresh = false, enabled = true } = options;
  const [data, setData] = useState<T | null>(() => {
    if (!enabled) return null;
    const entry = cache.get(key) as CacheEntry<T> | undefined;
    if (entry && Date.now() - entry.timestamp < ttl) {
      return entry.data;
    }
    return null;
  });
  const [isLoading, setIsLoading] = useState(() => {
    if (!enabled) return false;
    const entry = cache.get(key) as CacheEntry<T> | undefined;
    return !entry || Date.now() - entry.timestamp >= ttl;
  });
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const doFetch = useCallback(async (skipCache = false) => {
    if (!enabled) return;

    // キャッシュヒット判定
    if (!skipCache) {
      const entry = cache.get(key) as CacheEntry<T> | undefined;
      if (entry && Date.now() - entry.timestamp < ttl) {
        setData(entry.data);
        setIsLoading(false);
        return;
      }
    }

    setIsLoading(true);
    setError(null);

    try {
      // 同一キーへの並行リクエストを合流させる
      let promise = inflight.get(key) as Promise<T> | undefined;
      if (!promise) {
        promise = fetcher();
        inflight.set(key, promise);
      }

      const result = await promise;
      cache.set(key, { data: result, timestamp: Date.now() });

      if (mountedRef.current) {
        setData(result);
        setIsLoading(false);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : String(err));
        setIsLoading(false);
      }
    } finally {
      inflight.delete(key);
    }
  }, [key, fetcher, ttl, enabled]);

  useEffect(() => {
    mountedRef.current = true;
    doFetch(forceRefresh);
    return () => { mountedRef.current = false; };
  }, [doFetch, forceRefresh]);

  const refresh = useCallback(async () => {
    cache.delete(key);
    await doFetch(true);
  }, [key, doFetch]);

  return { data, isLoading, error, refresh };
}

/** 指定キーのキャッシュを手動で無効化 */
export function invalidateCache(key: string) {
  cache.delete(key);
}

/** キーのプレフィックスに一致するキャッシュをすべて無効化 */
export function invalidateCacheByPrefix(prefix: string) {
  Array.from(cache.keys()).forEach((k) => {
    if (k.startsWith(prefix)) {
      cache.delete(k);
    }
  });
}
