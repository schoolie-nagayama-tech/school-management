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

// 全講師（または指定された講師群）のバッジ付与情報を一括取得
// GET /api/admin/teachers/badges/batch?teacherIds=id1,id2,...
export async function GET(request: NextRequest) {
  try {
    const { auth } = await getApiAuth(request);
    if (!auth) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }
    const role = auth.role.toLowerCase();
    if (role !== 'admin' && role !== 'owner' && role !== 'manager') {
      return NextResponse.json({ error: '権限がありません' }, { status: 403 });
    }
    const isGlobal = role === 'admin' || role === 'owner';

    const db = getSupabaseAdmin();
    const { searchParams } = new URL(request.url);
    const teacherIdsParam = searchParams.get('teacherIds');

    // manager は自分の教室に所属する講師の付与情報のみ取得可能にする。
    // （service role は RLS を無視するため、ここで対象 teacher_id をスコープに絞る）
    let allowedTeacherIds: Set<string> | null = null;
    if (!isGlobal) {
      const { data: scopeRows } = await db
        .from('user_schools')
        .select('user_id')
        .in('school_id', auth.schoolIds);
      allowedTeacherIds = new Set((scopeRows || []).map((r) => String(r.user_id)));
    }

    let query = db
      .from('teacher_badge_assignments')
      .select('*, badge:teacher_badges(*)')
      .order('created_at', { ascending: false });

    let teacherIds: string[] | null = null;
    if (teacherIdsParam) {
      teacherIds = teacherIdsParam.split(',').filter(Boolean);
    }
    // manager の場合はスコープ内の講師に限定（指定があればその積集合）
    if (allowedTeacherIds) {
      teacherIds = (teacherIds ?? Array.from(allowedTeacherIds)).filter((id) =>
        allowedTeacherIds!.has(id)
      );
    }
    if (teacherIds) {
      if (teacherIds.length === 0) {
        return NextResponse.json({ assignmentsByTeacher: {} });
      }
      query = query.in('teacher_id', teacherIds);
    }

    const { data, error } = await query;
    if (error) throw error;

    // teacher_id でグルーピング
    const assignmentsByTeacher: Record<string, typeof data> = {};
    for (const row of data || []) {
      const tid = (row as { teacher_id: string }).teacher_id;
      if (!assignmentsByTeacher[tid]) assignmentsByTeacher[tid] = [];
      assignmentsByTeacher[tid].push(row);
    }

    return NextResponse.json(
      { assignmentsByTeacher },
      {
        headers: { 'Cache-Control': 'private, max-age=10, stale-while-revalidate=20' },
      }
    );
  } catch (err) {
    console.error('GET /api/admin/teachers/badges/batch error:', err);
    return NextResponse.json({ error: 'バッジ付与情報の一括取得に失敗しました' }, { status: 500 });
  }
}
