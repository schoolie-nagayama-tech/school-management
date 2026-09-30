/**
 * DB（Supabase）で数える回数制限。
 *
 * ★なぜ要るか（2026-09-30 セキュリティ総点検）:
 *   rateLimit.ts のメモリ内カウンタは Vercel のインスタンスごとに別々で、再起動でも消えるため、
 *   実質ほとんど効いていなかった。回数は DB の rate_limit_counters に記録する
 *   （マイグレーション 20260930120300_security_durable_rate_limit.sql）。
 *
 * ★Edge（middleware）でも Node（API ルート）でも動くよう、supabase-js ではなく fetch と
 *   Web Crypto だけで書いてある。
 *
 * ★DB に届かないとき（障害・タイムアウト・環境変数なし）は「通す」。
 *   ここで止めると Supabase の不調ひとつで保護者のログインや公開フォームが全部止まるため。
 *   その間もメモリ内の制限（rateLimit.ts）は効いている。
 */

/** DB への問い合わせを待つ上限。これを超えたら通す（公開フォームを遅くしない） */
const TIMEOUT_MS = 1500;

/** IP やログインIDをそのまま DB に残さないため、SHA-256 の16進にしてから渡す */
export async function hashRateLimitKey(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function checkDurableRateLimit(params: {
  /** 何の制限か（例: '/api/mypage/login'）。同じバケットの中で回数を数える */
  bucket: string;
  /** 誰の回数か（IP・ログインIDなど。ハッシュ化はこの関数が行う） */
  key: string;
  limit: number;
  windowSeconds: number;
}): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return true;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${url}/rest/v1/rpc/rate_limit_hit`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_bucket: params.bucket,
        p_key_hash: await hashRateLimitKey(params.key),
        p_limit: params.limit,
        p_window_seconds: params.windowSeconds,
      }),
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!res.ok) {
      console.warn('[durableRateLimit] RPC failed', params.bucket, res.status);
      return true;
    }
    return (await res.json()) !== false;
  } catch (error) {
    console.warn('[durableRateLimit] RPC error', params.bucket, (error as Error)?.name);
    return true;
  } finally {
    clearTimeout(timer);
  }
}
