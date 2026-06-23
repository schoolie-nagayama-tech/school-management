import { supabase } from '../supabase';

async function getAccessToken(): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    throw new Error('認証が必要です。ログインし直してください。');
  }
  return session.access_token;
}

/**
 * 講習準備サーバーAPI: 書き込み操作（POST）
 *
 * 副作用: 成功時にこの schoolId に対応する batchFetchCoursePrepApi のキャッシュを
 * 自動的に無効化する。書き込み直後の部分再フェッチが古いキャッシュを返さないようにするため。
 */
export async function callCoursePrepApi(
  action: string,
  schoolId: string,
  params: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  const token = await getAccessToken();

  const res = await fetch('/api/courses/prep', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ action, schoolId, ...params }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || '操作に失敗しました');
  }
  // 書き込み成功 → 対象 schoolId のキャッシュを無効化（古いデータの混入を防ぐ）
  invalidateCoursePrepCache(schoolId);
  return data;
}

/**
 * 講習準備サーバーAPI: 読み取り操作（GET）
 */
export async function fetchCoursePrepApi(
  action: string,
  params: Record<string, string>
): Promise<Record<string, unknown>> {
  const token = await getAccessToken();

  const searchParams = new URLSearchParams({ action, ...params });
  const res = await fetch(`/api/courses/prep?${searchParams.toString()}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || '取得に失敗しました');
  }
  return data;
}

/**
 * バッチ取得: 複数データを1リクエストで取得（認証1回、DB並列実行）
 * targets: 'progress_items' | 'student_progress' | 'period' | 'auto_values' | 'schedule_tasks'
 */

const BATCH_CACHE_TTL_MS = 30_000;
const batchCache = new Map<string, { data: Record<string, unknown>; expiresAt: number }>();
const batchInflight = new Map<string, Promise<Record<string, unknown>>>();

// 複数校バッチ（batch_get_multi）専用のキャッシュ。キーが schoolIds 結合のため
// 単一校キャッシュとは別の Map で持ち、無効化時は安全側に倒して全クリアする（後述）。
const batchMultiCache = new Map<
  string,
  { data: Record<string, Record<string, unknown>>; expiresAt: number }
>();
const batchMultiInflight = new Map<string, Promise<Record<string, Record<string, unknown>>>>();

function batchCacheKey(params: Record<string, string | undefined>, targets: string[]): string {
  return `${params.schoolId}:${params.season}:${params.year}:${targets.sort().join(',')}`;
}

// 複数校キャッシュキー: schoolIds をソートして結合し、順序に依存しないようにする。
function batchMultiCacheKey(
  params: { schoolIds: string[]; season: string; year: string },
  targets: string[]
): string {
  return `${params.schoolIds.slice().sort().join('|')}:${params.season}:${params.year}:${targets.slice().sort().join(',')}`;
}

export function invalidateCoursePrepCache(schoolId?: string): void {
  // multi キャッシュは複数校が混在しキーから特定 schoolId を部分削除できないため、
  // 書き込み無効化時は schoolId 指定の有無に関わらず全クリアする（古いデータ混入を防ぐ安全側）。
  batchMultiCache.clear();
  if (!schoolId) {
    batchCache.clear();
    return;
  }
  Array.from(batchCache.keys()).forEach((key) => {
    if (key.startsWith(`${schoolId}:`)) batchCache.delete(key);
  });
}

export async function batchFetchCoursePrepApi(
  params: { schoolId: string; season: string; year: string; includeHidden?: string },
  targets: string[]
): Promise<Record<string, unknown>> {
  const key = batchCacheKey(params, targets);

  const cached = batchCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const existing = batchInflight.get(key);
  if (existing) return existing;

  const promise = (async () => {
    const token = await getAccessToken();
    const searchParams = new URLSearchParams({
      action: 'batch_get',
      ...params,
      targets: targets.join(','),
    });
    const res = await fetch(`/api/courses/prep?${searchParams.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '取得に失敗しました');
    const result = data.data as Record<string, unknown>;
    batchCache.set(key, { data: result, expiresAt: Date.now() + BATCH_CACHE_TTL_MS });
    return result;
  })();

  batchInflight.set(key, promise);
  try {
    return await promise;
  } finally {
    batchInflight.delete(key);
  }
}

/**
 * 複数校バッチ取得: 複数校分を1リクエスト（action=batch_get_multi）で取得する。
 * 教室別に4本の HTTP を投げていた構成を1本に統合し、認証往復・リクエスト本数を削減する。
 * 30秒キャッシュ + inflight dedup は単一校版と同じ仕組みを multi 専用 Map で踏襲する。
 * 返り値は schoolId -> batchResult のマップ。
 */
export async function batchFetchCoursePrepApiMulti(
  params: { schoolIds: string[]; season: string; year: string; includeHidden?: string },
  targets: string[]
): Promise<Record<string, Record<string, unknown>>> {
  const key = batchMultiCacheKey(params, targets);

  const cached = batchMultiCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const existing = batchMultiInflight.get(key);
  if (existing) return existing;

  const promise = (async () => {
    const token = await getAccessToken();
    const searchParams = new URLSearchParams({
      action: 'batch_get_multi',
      schoolIds: params.schoolIds.join(','),
      season: params.season,
      year: params.year,
      ...(params.includeHidden !== undefined ? { includeHidden: params.includeHidden } : {}),
      targets: targets.join(','),
    });
    const res = await fetch(`/api/courses/prep?${searchParams.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '取得に失敗しました');
    const result = data.data as Record<string, Record<string, unknown>>;
    batchMultiCache.set(key, { data: result, expiresAt: Date.now() + BATCH_CACHE_TTL_MS });
    return result;
  })();

  batchMultiInflight.set(key, promise);
  try {
    return await promise;
  } finally {
    batchMultiInflight.delete(key);
  }
}
