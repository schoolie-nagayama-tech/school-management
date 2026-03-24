/**
 * インメモリ IP ベースレート制限
 *
 * Edge Runtime (Next.js middleware) で動作する軽量レート制限。
 * Vercel のサーバーレス環境ではインスタンスが再起動すると
 * カウントはリセットされるが、単一インスタンス内での
 * バースト攻撃を防ぐには十分。
 */

interface RateLimitEntry {
  count: number;
  resetAt: number; // Unix ms
}

const store = new Map<string, RateLimitEntry>();

// 定期的にストアをクリーンアップ（メモリリーク防止）
let lastCleanup = Date.now();
const CLEANUP_INTERVAL = 60_000; // 1分

function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  store.forEach((entry, key) => {
    if (now > entry.resetAt) {
      store.delete(key);
    }
  });
}

interface RateLimitOptions {
  /** ウィンドウ内の最大リクエスト数 */
  limit: number;
  /** ウィンドウの長さ (秒) */
  windowSeconds: number;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

/**
 * IP + パスプレフィックスでレート制限をチェックする。
 *
 * @param ip        クライアントIPアドレス
 * @param path      リクエストパスのプレフィックス（例: "/api/portal"）
 * @param options   制限オプション
 * @returns         allowed: true なら通過、false なら 429 を返す
 */
export function checkRateLimit(
  ip: string,
  path: string,
  options: RateLimitOptions
): RateLimitResult {
  cleanup();

  const key = `${ip}:${path}`;
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    // 新規ウィンドウ
    const resetAt = now + options.windowSeconds * 1000;
    store.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: options.limit - 1, resetAt };
  }

  entry.count++;
  if (entry.count > options.limit) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  return { allowed: true, remaining: options.limit - entry.count, resetAt: entry.resetAt };
}
