import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/types/database';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AUTH_COOKIE_NAME } from '@/lib/authCookie';

// ビルド時（CI等）で環境変数が未設定の場合にプレースホルダーを使用（ビルドを通すため）
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key';

let browserClient: SupabaseClient<Database> | null = null;

export const getSupabaseBrowserClient = (): SupabaseClient<Database> => {
  if (browserClient) {
    return browserClient;
  }

  browserClient = createBrowserClient<Database>(supabaseUrl, supabaseAnonKey, {
    auth: {
      // サーバー側の createServerClient は cookieOptions.name でこの名前を指定する必要がある。
      // 揃っていないとログイン済みでも認証なし扱いになる（lib/authCookie.ts）。
      storageKey: AUTH_COOKIE_NAME,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
    },
  });

  return browserClient;
};

export const createSupabaseBrowserClient = getSupabaseBrowserClient;

export const supabase = (() => getSupabaseBrowserClient())();
