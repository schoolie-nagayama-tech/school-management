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

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ badgeId: string }> }
) {
  try {
    const authError = await requireManager(request);
    if (authError) return authError;

    const { badgeId } = await params;
    const db = getSupabaseAdmin();
    const body = await request.json();

    const updates: Record<string, unknown> = {};
    for (const key of ['name', 'category', 'rank', 'icon', 'description', 'sort_order', 'is_active']) {
      if (body[key] !== undefined) updates[key] = body[key];
    }

    const { data, error } = await db
      .from('teacher_badges')
      .update(updates)
      .eq('id', badgeId)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ badge: data });
  } catch (err) {
    console.error('PATCH /api/admin/teacher-badges/[badgeId] error:', err);
    return NextResponse.json({ error: 'バッジの更新に失敗しました' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ badgeId: string }> }
) {
  try {
    const authError = await requireManager(request);
    if (authError) return authError;

    const { badgeId } = await params;
    const db = getSupabaseAdmin();
    const hard = request.nextUrl.searchParams.get('hard') === '1';

    if (hard) {
      // 完全削除（割り当ても CASCADE で消える）
      const { error } = await db
        .from('teacher_badges')
        .delete()
        .eq('id', badgeId);
      if (error) throw error;
    } else {
      // 論理削除（無効化）
      const { error } = await db
        .from('teacher_badges')
        .update({ is_active: false })
        .eq('id', badgeId);
      if (error) throw error;
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/admin/teacher-badges/[badgeId] error:', err);
    return NextResponse.json({ error: 'バッジの削除に失敗しました' }, { status: 500 });
  }
}
