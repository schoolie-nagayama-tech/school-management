import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';

/**
 * リクエストから認証情報（userId と role）を取得する。
 * 1) Authorization: Bearer <token> ヘッダーがあればそちらを優先（クライアントからの fetch 用）
 * 2) なければ Cookie から getSession()
 * @returns 認証済みなら { userId, role }、失敗時は null
 */
export async function getApiAuth(request: NextRequest): Promise<{
  auth: { userId: string; role: string } | null;
  cookieResponse: NextResponse;
}> {
  const cookieResponse = NextResponse.next();

  // Authorization ヘッダーがあればトークンで検証（Cookie が送られない場合のフォールバック）
  const authHeader = request.headers.get('Authorization');
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (bearerToken) {
    try {
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { global: { headers: { Authorization: `Bearer ${bearerToken}` } } }
      );
      const { data: { user }, error } = await supabase.auth.getUser();
      if (!error && user) {
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('role')
          .eq('id', user.id)
          .maybeSingle();
        const role = (profile?.role as string) ?? '';
        return { auth: { userId: user.id, role }, cookieResponse };
      }
    } catch {
      // フォールバックで Cookie を試す
    }
  }

  try {
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

    // Route Handler では getUser() が失敗する不具合のため getSession() を使用
    const {
      data: { session },
      error: authError,
    } = await supabase.auth.getSession();

    if (authError || !session?.user) {
      return { auth: null, cookieResponse };
    }

    const user = session.user;

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();

    const role = (profile?.role as string) ?? '';
    return { auth: { userId: user.id, role }, cookieResponse };
  } catch {
    return { auth: null, cookieResponse };
  }
}

function mergeCookiesIntoResponse(source: NextResponse, target: NextResponse): void {
  source.cookies.getAll().forEach((c) => target.cookies.set(c.name, c.value, c));
}

/**
 * 管理者（admin または owner）権限を要求する。
 * @returns 権限不足なら NextResponse（401/403）、OKなら null（処理続行）
 */
export async function requireAdmin(request: NextRequest): Promise<NextResponse | null> {
  const { auth, cookieResponse } = await getApiAuth(request);
  if (!auth) {
    const res = NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    mergeCookiesIntoResponse(cookieResponse, res);
    return res;
  }
  const roleLower = auth.role.toLowerCase();
  if (roleLower !== 'admin' && roleLower !== 'owner') {
    const res = NextResponse.json({ error: '管理者権限が必要です' }, { status: 403 });
    mergeCookiesIntoResponse(cookieResponse, res);
    return res;
  }
  return null;
}

/**
 * マネージャー（admin / owner / manager）権限を要求する。
 * @returns 権限不足なら NextResponse（401/403）、OKなら null（処理続行）
 */
export async function requireManager(request: NextRequest): Promise<NextResponse | null> {
  const { auth, cookieResponse } = await getApiAuth(request);
  if (!auth) {
    const res = NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    mergeCookiesIntoResponse(cookieResponse, res);
    return res;
  }
  const roleLower = auth.role.toLowerCase();
  if (roleLower !== 'admin' && roleLower !== 'owner' && roleLower !== 'manager') {
    const res = NextResponse.json({ error: '権限がありません' }, { status: 403 });
    mergeCookiesIntoResponse(cookieResponse, res);
    return res;
  }
  return null;
}
