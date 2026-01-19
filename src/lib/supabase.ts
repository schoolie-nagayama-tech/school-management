import { createClient } from '@supabase/supabase-js';
import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/types/database';
import type { SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// サーバーサイド用（API Routes、Server Componentsなど）
export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey);

// クライアントサイド用（ブラウザでの認証） - シングルトンパターン
let browserClient: SupabaseClient<Database> | null = null;

export const getSupabaseBrowserClient = (): SupabaseClient<Database> => {
  // 既にインスタンスが存在する場合はそれを返す
  if (browserClient) {
    return browserClient;
  }

  // 新しいインスタンスを作成
  browserClient = createBrowserClient<Database>(supabaseUrl, supabaseAnonKey, {
    auth: {
      storageKey: 'sb-auth-token',
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
  });

  return browserClient;
};

// 後方互換性のため、createSupabaseBrowserClientも提供
export const createSupabaseBrowserClient = getSupabaseBrowserClient;
