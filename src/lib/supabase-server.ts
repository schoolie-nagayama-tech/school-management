import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import type { Database } from '@/types/database';

/**
 * サーバーコンポーネント用の Supabase クライアント。
 *
 * リクエストの Cookie からログインセッションを読み取るため、認証済みユーザーの
 * 権限（RLS: check_school_access 等）でDBを読める。
 *
 * 用途: anon の `supabase` クライアント（src/lib/supabase.ts）はサーバー側では
 * セッションを持たず、form_periods の anon ポリシーは「公開期間内」の期間しか
 * 見せない。そのため下書き・終了済み・アーカイブ済みの期間プレビューが 404 に
 * なる。認証済みクライアントなら form_periods_school_scope_auth ポリシーにより
 * 自校の期間を公開状態に関係なく読めるので、この問題を回避できる。
 *
 * 注: 保護者ポータル等の公開ページでは引き続き anon クライアントを使うこと。
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        // サーバーコンポーネントからは Cookie を書き込めないため no-op
        // （セッション更新は middleware 側で行う）
        setAll() {},
      },
    }
  );
}
