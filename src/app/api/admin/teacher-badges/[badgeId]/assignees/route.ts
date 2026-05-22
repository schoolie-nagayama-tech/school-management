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

// 特定バッジが付与されている講師IDを取得
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ badgeId: string }> }
) {
  try {
    const authError = await requireManager(request);
    if (authError) return authError;

    const { badgeId } = await params;
    const db = getSupabaseAdmin();

    const { data, error } = await db
      .from('teacher_badge_assignments')
      .select('teacher_id')
      .eq('badge_id', badgeId);

    if (error) throw error;

    const assignedTeacherIds = (data || []).map((a: { teacher_id: string }) => a.teacher_id);
    return NextResponse.json({ assignedTeacherIds });
  } catch (err) {
    console.error('GET /api/admin/teacher-badges/[badgeId]/assignees error:', err);
    return NextResponse.json({ error: '付与情報の取得に失敗しました' }, { status: 500 });
  }
}
