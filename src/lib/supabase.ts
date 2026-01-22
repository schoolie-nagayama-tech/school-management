import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/types/database';
import type { SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// クライアントサイド用（ブラウザでの認証）
// @supabase/ssrのデフォルト動作を使用（クッキーとlocalStorageのハイブリッド）
let browserClient: SupabaseClient<Database> | null = null;

export const getSupabaseBrowserClient = (): SupabaseClient<Database> => {
  // 既にインスタンスが存在する場合はそれを返す
  if (browserClient) {
    return browserClient;
  }

  // @supabase/ssrのデフォルト動作を使用
  // デフォルトでクッキーとlocalStorageのハイブリッドストレージを使用
  browserClient = createBrowserClient<Database>(supabaseUrl, supabaseAnonKey, {
    auth: {
      storageKey: 'sb-auth-token',
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
      flowType: 'pkce', // PKCEフローを明示的に指定
    },
  });

  return browserClient;
};

// 後方互換性のため、createSupabaseBrowserClientも提供
export const createSupabaseBrowserClient = getSupabaseBrowserClient;

// 後方互換性のため（クライアントサイドから呼び出されるAPI関数用）
// 注意: このエクスポートは非推奨。新しいコードではcreateSupabaseBrowserClientを使用してください
// getter関数として実装して、実行時に評価されるようにする
export const supabase = (() => getSupabaseBrowserClient())();
