import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { getGoogleAuthUrl } from '@/lib/google-calendar';

export const dynamic = 'force-dynamic';

const ALLOWED_ROLES = ['admin', 'owner', 'manager'];

/**
 * Google Calendar OAuth 認証開始
 * → Googleの認証画面にリダイレクト
 *
 * 認証方法: Cookie または ?token= クエリパラメータ
 */
export async function GET(request: NextRequest) {
  let userId: string | null = null;

  // 1) ?token= クエリパラメータがあればそちらで認証
  const tokenParam = request.nextUrl.searchParams.get('token');
  if (tokenParam) {
    try {
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { global: { headers: { Authorization: `Bearer ${tokenParam}` } } }
      );
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();
      if (!error && user) {
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('role')
          .eq('id', user.id)
          .maybeSingle();
        const role = (profile?.role as string) ?? '';
        if (!ALLOWED_ROLES.includes(role.toLowerCase())) {
          return NextResponse.json({ error: '権限がありません' }, { status: 403 });
        }
        userId = user.id;
      }
    } catch {
      // fallback to cookie
    }
  }

  // 2) Cookie 認証
  if (!userId) {
    try {
      const cookieResponse = NextResponse.next();
      const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          cookies: {
            getAll() {
              return request.cookies.getAll();
            },
            setAll(cookiesToSet: { name: string; value: string; options?: object }[]) {
              cookiesToSet.forEach(({ name, value, options }) => {
                cookieResponse.cookies.set(name, value, options);
              });
            },
          },
        }
      );
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.user) {
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('role')
          .eq('id', session.user.id)
          .maybeSingle();
        const role = (profile?.role as string) ?? '';
        if (!ALLOWED_ROLES.includes(role.toLowerCase())) {
          return NextResponse.json({ error: '権限がありません' }, { status: 403 });
        }
        userId = session.user.id;
      }
    } catch {
      // ignore
    }
  }

  if (!userId) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const origin = request.nextUrl.origin;
  const authUrl = getGoogleAuthUrl(userId, origin);
  return NextResponse.redirect(authUrl);
}
