import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireManager } from '@/lib/api-auth';

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
    const authError = await requireManager(request);
    if (authError) return authError;

    const db = getSupabaseAdmin();
    const category = request.nextUrl.searchParams.get('category');
    const includeInactive = request.nextUrl.searchParams.get('includeInactive') === '1';

    let query = db
      .from('teacher_badges')
      .select('*')
      .order('sort_order')
      .order('created_at');

    if (!includeInactive) {
      query = query.eq('is_active', true);
    }
    if (category) {
      query = query.eq('category', category);
    }

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ badges: data || [] });
  } catch (err) {
    console.error('GET /api/admin/teacher-badges error:', err);
    return NextResponse.json({ error: 'バッジ一覧の取得に失敗しました' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const authError = await requireManager(request);
    if (authError) return authError;

    const db = getSupabaseAdmin();
    const body = await request.json();
    const { name, category, rank, icon, description, sort_order } = body;

    if (!name || !category || !rank || !icon) {
      return NextResponse.json({ error: '必須項目が不足しています' }, { status: 400 });
    }

    const { data, error } = await db
      .from('teacher_badges')
      .insert({
        name,
        category,
        rank,
        icon,
        description: description || null,
        sort_order: sort_order ?? 0,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ badge: data }, { status: 201 });
  } catch (err) {
    console.error('POST /api/admin/teacher-badges error:', err);
    return NextResponse.json({ error: 'バッジの作成に失敗しました' }, { status: 500 });
  }
}
