import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getApiAuth } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}` } },
    }
  );
}

export async function GET(request: NextRequest) {
  try {
    const { auth } = await getApiAuth(request);
    if (!auth) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }

    const db = getSupabaseAdmin();

    // 全テンプレート（トロフィーケース用）
    const { data: badges, error: badgesError } = await db
      .from('teacher_badges')
      .select('*')
      .eq('is_active', true)
      .order('sort_order')
      .order('created_at');

    if (badgesError) throw badgesError;

    // 自分の付与済みバッジ
    const { data: assignments, error: assignError } = await db
      .from('teacher_badge_assignments')
      .select('*, badge:teacher_badges(*)')
      .eq('teacher_id', auth.userId)
      .order('created_at', { ascending: false });

    if (assignError) throw assignError;

    // アクティブテンプレートに紐づく付与のみに絞り込み（管理者画面と一致させる）
    const activeBadgeIds = new Set((badges || []).map((b: { id: string }) => b.id));
    const filteredAssignments = (assignments || []).filter(
      (a: { badge_id: string }) => activeBadgeIds.has(a.badge_id)
    );

    return NextResponse.json({
      badges: badges || [],
      assignments: filteredAssignments,
    }, {
      headers: { 'Cache-Control': 'private, max-age=15, stale-while-revalidate=30' },
    });
  } catch (err) {
    console.error('GET /api/my/badges error:', err);
    return NextResponse.json({ error: 'バッジ情報の取得に失敗しました' }, { status: 500 });
  }
}
