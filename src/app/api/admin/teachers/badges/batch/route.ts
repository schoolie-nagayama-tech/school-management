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

// 全講師（または指定された講師群）のバッジ付与情報を一括取得
// GET /api/admin/teachers/badges/batch?teacherIds=id1,id2,...
export async function GET(request: NextRequest) {
  try {
    const authError = await requireManager(request);
    if (authError) return authError;

    const db = getSupabaseAdmin();
    const { searchParams } = new URL(request.url);
    const teacherIdsParam = searchParams.get('teacherIds');

    let query = db
      .from('teacher_badge_assignments')
      .select('*, badge:teacher_badges(*)')
      .order('created_at', { ascending: false });

    if (teacherIdsParam) {
      const teacherIds = teacherIdsParam.split(',').filter(Boolean);
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

    return NextResponse.json({ assignmentsByTeacher }, {
      headers: { 'Cache-Control': 'private, max-age=10, stale-while-revalidate=20' },
    });
  } catch (err) {
    console.error('GET /api/admin/teachers/badges/batch error:', err);
    return NextResponse.json({ error: 'バッジ付与情報の一括取得に失敗しました' }, { status: 500 });
  }
}
