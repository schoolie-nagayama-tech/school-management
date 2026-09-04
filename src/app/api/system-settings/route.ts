import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { captureApiError } from '@/lib/api-error';

export const dynamic = 'force-dynamic';

function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase env not set');
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** リクエストから Supabase セッションを取得 */
async function getSessionFromRequest(request: NextRequest) {
  const response = NextResponse.next();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return { session, response };
}

/**
 * GET /api/system-settings?category=security
 * category=security の取得は認証不要（タイムアウト・ロール一覧は機密ではない）
 * 他の category は将来拡張用
 */
export async function GET(request: NextRequest) {
  try {
    const category = request.nextUrl.searchParams.get('category') ?? undefined;
    const { session, response } = await getSessionFromRequest(request);

    // category=security 以外は認証必須（将来の拡張用）
    if (category !== 'security' && !session?.user) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }
    let settings: Array<{ key: string; value: string }> = [];

    try {
      const supabaseAdmin = getSupabaseAdmin();
      let query = supabaseAdmin.from('system_settings').select('key, value');
      if (category) {
        query = query.eq('category', category);
      }
      const { data, error } = await query;

      if (error) {
        console.warn('system-settings: DB error (migration may not be run):', error.message);
        if (category === 'security') {
          settings = [
            {
              key: 'privacy_screen_timeout_by_role',
              value: '{"admin":0,"owner":60,"manager":60,"teacher":0,"parent":0}',
            },
          ];
        } else {
          return NextResponse.json({ error: 'システム設定の取得に失敗しました' }, { status: 500 });
        }
      } else {
        settings = (data || []).map((row: { key: string; value: string }) => ({
          key: row.key,
          value: row.value,
        }));
      }
    } catch (dbErr) {
      captureApiError(dbErr, {
        route: 'GET /api/system-settings',
      });
      console.warn('system-settings: DB access failed:', dbErr);
      if (category === 'security') {
        settings = [
          {
            key: 'privacy_screen_timeout_by_role',
            value: '{"admin":0,"owner":60,"manager":60,"teacher":0,"parent":0}',
          },
        ];
      } else {
        return NextResponse.json({ error: 'システム設定の取得に失敗しました' }, { status: 500 });
      }
    }

    const json = NextResponse.json({ settings });
    json.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');

    try {
      response.cookies.getAll().forEach((c) => {
        json.cookies.set(c.name, c.value);
      });
    } catch (error) {
      captureApiError(error, {
        route: 'GET /api/system-settings',
      });
      // Cookie マージ失敗時は無視
    }

    return json;
  } catch (err) {
    captureApiError(err, {
      route: 'GET /api/system-settings',
    });
    console.error('system-settings GET error:', err);
    const category = request.nextUrl.searchParams.get('category');
    if (category === 'security') {
      return NextResponse.json({
        settings: [
          {
            key: 'privacy_screen_timeout_by_role',
            value: '{"admin":0,"owner":60,"manager":60,"teacher":0,"parent":0}',
          },
        ],
      });
    }
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
}
