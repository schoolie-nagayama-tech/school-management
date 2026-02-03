import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/types/database';
import type { SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

let browserClient: SupabaseClient<Database> | null = null;

export const getSupabaseBrowserClient = (): SupabaseClient<Database> => {
  if (browserClient) {
    return browserClient;
  }

  browserClient = createBrowserClient<Database>(supabaseUrl, supabaseAnonKey, {
    auth: {
      storageKey: 'sb-auth-token',
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
