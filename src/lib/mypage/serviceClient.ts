import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * ポータル用 service_role クライアント（サーバー専用・RLSバイパス）。
 *
 * ログイン・招待発行/受諾など「本人JWTがまだ無い」書き込み系はこのクライアントで行う。
 * service_role key は機密。クライアントに渡さない・NEXT_PUBLIC_ 禁止。
 *
 * fetch は no-store 強制（Data Cache による古い読み込みの罠対策。supabase.ts と同趣旨）。
 *
 * 型なし（any スキーマ）にしているのは、portal_* テーブルがまだ生成済み Database 型に
 * 含まれないため。types 再生成後に Database 型へ差し替えてよい。
 */
export function getPortalServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error('Supabase env（URL / SERVICE_ROLE_KEY）が設定されていません');
  }
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: {
      fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }),
    },
  });
}
