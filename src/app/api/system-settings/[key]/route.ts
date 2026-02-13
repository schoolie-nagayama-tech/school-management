import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';

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

/** Authorization ヘッダーからトークンを取得してユーザーを検証（API Route の Cookie 問題を回避） */
async function getUserFromAuthHeader(request: NextRequest): Promise<{ userId: string } | null> {
  const authHeader = request.headers.get('Authorization');
  const token = authHeader?.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    }
  );
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  return { userId: user.id };
}

/** リクエストから Supabase セッションを取得（Cookie または Authorization ヘッダー） */
async function getSessionFromRequest(request: NextRequest) {
  // 1. Authorization ヘッダーを優先（API Route の Cookie 問題を回避）
  const fromHeader = await getUserFromAuthHeader(request);
  if (fromHeader) return { userId: fromHeader.userId };

  // 2. Cookie から取得を試行
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
  if (session?.user) return { userId: session.user.id };
  return null;
}

/**
 * PUT /api/system-settings/[key]
 * 認証必須かつ admin ロールのみ。{ value: "..." } で更新
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { key: string } }
) {
  try {
    const key = params?.key;
    if (!key || typeof key !== 'string') {
      return NextResponse.json({ error: 'key が必要です' }, { status: 400 });
    }

    const auth = await getSessionFromRequest(request);
    if (!auth?.userId) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }

    const supabaseAdmin = getSupabaseAdmin();

    // ユーザーのロールを確認（admin のみ許可）
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .select('role')
      .eq('id', auth.userId)
      .single();

    if (profileError || !profile) {
      return NextResponse.json(
        { error: 'プロファイルを取得できませんでした' },
        { status: 403 }
      );
    }

    if (String(profile.role).toLowerCase() !== 'admin') {
      return NextResponse.json(
        { error: 'この操作はシステム管理者のみ実行できます' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const value = body?.value;
    if (value === undefined || value === null) {
      return NextResponse.json(
        { error: 'value が必要です' },
        { status: 400 }
      );
    }

    const valueStr = typeof value === 'string' ? value : JSON.stringify(value);
    const now = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from('system_settings')
      .upsert(
        {
          key,
          value: valueStr,
          category: 'security',
          updated_at: now,
        },
        {
          onConflict: 'key',
          ignoreDuplicates: false,
        }
      )
      .select('key, value')
      .single();

    if (error) {
      console.error('Error upserting system setting:', error);
      return NextResponse.json(
        { error: 'システム設定の保存に失敗しました' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      key: data?.key ?? key,
      value: data?.value ?? valueStr,
    });
  } catch (err) {
    console.error('system-settings PUT error:', err);
    return NextResponse.json(
      { error: 'サーバーエラーが発生しました' },
      { status: 500 }
    );
  }
}
