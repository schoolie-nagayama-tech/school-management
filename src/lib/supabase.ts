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

  // クッキーストレージを使用するカスタムストレージアダプター
  const cookieStorage = {
    getItem: (key: string): string | null => {
      if (typeof document === 'undefined') return null;
      const cookies = document.cookie.split(';');
      for (const cookie of cookies) {
        const [name, value] = cookie.trim().split('=');
        if (name === key) {
          return decodeURIComponent(value);
        }
      }
      return null;
    },
    setItem: (key: string, value: string): void => {
      if (typeof document === 'undefined') return;
      // セキュアなクッキーとして設定（SameSite=Lax、Secure、HttpOnlyは設定できない）
      document.cookie = `${key}=${encodeURIComponent(value)}; path=/; SameSite=Lax; max-age=31536000`;
    },
    removeItem: (key: string): void => {
      if (typeof document === 'undefined') return;
      document.cookie = `${key}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
    },
  };

  // 新しいインスタンスを作成（クッキーストレージを使用）
  browserClient = createBrowserClient<Database>(supabaseUrl, supabaseAnonKey, {
    auth: {
      storage: cookieStorage,
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
