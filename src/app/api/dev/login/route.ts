import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * デバッグ/プレビュー用の自動ログイン API。
 *
 * - NODE_ENV !== 'development' のときは 404 を返して本番では無効化
 * - .env.local の DEV_LOGIN_EMAIL / DEV_LOGIN_PASSWORD を使って signInWithPassword
 * - 成功したら ?redirect= で指定されたページ (デフォルト /students) にリダイレクト
 *
 * 使い方:
 *   http://localhost:3000/api/dev/login
 *   http://localhost:3000/api/dev/login?redirect=/applications
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const email = process.env.DEV_LOGIN_EMAIL;
  const password = process.env.DEV_LOGIN_PASSWORD;

  if (!email || !password) {
    return NextResponse.json(
      {
        error:
          'DEV_LOGIN_EMAIL と DEV_LOGIN_PASSWORD を .env.local に設定してください',
      },
      { status: 500 }
    );
  }

  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // ブラウザクライアント (src/lib/supabase.ts) が storageKey: 'sb-auth-token' を
      // 使っているので、Cookie 名もそれに合わせないと相互運用できない
      cookieOptions: { name: 'sb-auth-token' },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        },
      },
    }
  );

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.session) {
    return NextResponse.json(
      { error: `デバッグログインに失敗しました: ${error?.message ?? 'no session'}` },
      { status: 401 }
    );
  }

  const redirectParam = request.nextUrl.searchParams.get('redirect');
  const redirectTo = redirectParam && redirectParam.startsWith('/') ? redirectParam : '/students';
  return NextResponse.redirect(new URL(redirectTo, request.url));
}
