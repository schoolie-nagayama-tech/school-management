import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getPortalSessionToken } from './session';
import { verifyPortalJwt, type PortalJwtClaims } from './jwt';

// portal_* テーブルはまだ生成済み Database 型（types/database.ts）に含まれないため、
// このクライアントは型なし（any スキーマ）にする。types 再生成後に Database 型へ
// 差し替えてよい。students 等の既存テーブルの行も any 扱いになる点に注意。

/**
 * 保護者ポータル用の Supabase クライアント（サーバー専用）。
 *
 * ポータルJWTを Authorization: Bearer で載せて PostgREST を叩く。JWTの role='portal'
 * により PostgREST は専用ロール portal に成り代わり（既存 authenticated ポリシー群
 * から隔離）、RLS が portal_uid()（= JWTの sub = portal_account_id）で認可する。
 * このクライアントからは「明示グラント済みテーブルの紐づけ生徒スコープ」だけが
 * 見える。認可の書き忘れによる漏洩を DB 層で防ぐ多層防御。
 *
 * ★ fetch を no-store 強制する理由:
 *   このリポジトリには「Next.js Data Cache が supabase-js の fetch をキャッシュして
 *   読み込みだけ古くする」既知の罠がある（MEMORY: nextjs_data_cache_stale_read_trap）。
 *   ポータルは権限境界をまたぐデータを扱うので、キャッシュ由来の取り違えは特に危険。
 *   よって明示的に no-store にする。
 */
export function createPortalSupabaseClient(jwt: string): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        headers: { Authorization: `Bearer ${jwt}` },
        // Data Cache を必ず無効化する（上記の罠対策）。
        fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }),
      },
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}

/**
 * 現在のセッション cookie からポータルクライアントとアカウント情報を得る。
 * ログインしていない（cookie無し・JWT無効・期限切れ）場合は null。
 *
 * ページ/APIで「セッション必須」を表現する入口として使う。
 */
export async function getPortalContext(): Promise<{
  client: SupabaseClient;
  claims: PortalJwtClaims;
  token: string;
} | null> {
  const token = await getPortalSessionToken();
  if (!token) return null;

  // 署名・期限・issuer を自前で検証してから使う（DBに投げる前の早期リターン）。
  const claims = await verifyPortalJwt(token);
  if (!claims) return null;

  return { client: createPortalSupabaseClient(token), claims, token };
}
