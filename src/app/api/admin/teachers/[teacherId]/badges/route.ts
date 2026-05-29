import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getApiAuth, isUserInScope } from '@/lib/api-auth';

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

/**
 * マネージャー以上であること＋対象講師が呼び出し元の教室スコープ内であることを検証する。
 * service role は RLS を無視するため、対象 teacherId の所属チェックが唯一の越権防止策。
 * @returns 権限OKなら null、NGなら NextResponse（401/403）
 */
async function authorizeForTeacher(
  request: NextRequest,
  teacherId: string,
  db: SupabaseClient
): Promise<NextResponse | null> {
  const { auth } = await getApiAuth(request);
  if (!auth) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }
  const role = auth.role.toLowerCase();
  if (role !== 'admin' && role !== 'owner' && role !== 'manager') {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }
  // admin/owner は全教室を持つためバイパス。manager は対象講師との教室共有を必須に。
  const isGlobal = role === 'admin' || role === 'owner';
  if (!isGlobal && !(await isUserInScope(teacherId, auth.schoolIds, db))) {
    return NextResponse.json({ error: 'この講師を操作する権限がありません' }, { status: 403 });
  }
  return null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ teacherId: string }> }
) {
  try {
    const { teacherId } = await params;
    const db = getSupabaseAdmin();

    const authError = await authorizeForTeacher(request, teacherId, db);
    if (authError) return authError;

    const { data, error } = await db
      .from('teacher_badge_assignments')
      .select('*, badge:teacher_badges(*)')
      .eq('teacher_id', teacherId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return NextResponse.json({ assignments: data || [] });
  } catch (err) {
    console.error('GET /api/admin/teachers/[teacherId]/badges error:', err);
    return NextResponse.json({ error: 'バッジ付与情報の取得に失敗しました' }, { status: 500 });
  }
}

// トグル式: 付与済みなら剥奪、未付与なら付与
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ teacherId: string }> }
) {
  try {
    const { teacherId } = await params;
    const db = getSupabaseAdmin();

    const authError = await authorizeForTeacher(request, teacherId, db);
    if (authError) return authError;

    const body = await request.json();
    const { badgeId, completedAt, note } = body;

    if (!badgeId) {
      return NextResponse.json({ error: 'badgeId は必須です' }, { status: 400 });
    }

    // 既存の付与を確認
    const { data: existing } = await db
      .from('teacher_badge_assignments')
      .select('id')
      .eq('teacher_id', teacherId)
      .eq('badge_id', badgeId)
      .maybeSingle();

    if (existing) {
      // 剥奪
      const { error } = await db
        .from('teacher_badge_assignments')
        .delete()
        .eq('id', existing.id);
      if (error) throw error;
      return NextResponse.json({ action: 'revoked' });
    } else {
      // 付与
      const { data, error } = await db
        .from('teacher_badge_assignments')
        .insert({
          teacher_id: teacherId,
          badge_id: badgeId,
          completed_at: completedAt || new Date().toISOString().split('T')[0],
          note: note || null,
        })
        .select('*, badge:teacher_badges(*)')
        .single();
      if (error) throw error;
      return NextResponse.json({ action: 'assigned', assignment: data }, { status: 201 });
    }
  } catch (err) {
    console.error('POST /api/admin/teachers/[teacherId]/badges error:', err);
    return NextResponse.json({ error: 'バッジの付与/剥奪に失敗しました' }, { status: 500 });
  }
}
