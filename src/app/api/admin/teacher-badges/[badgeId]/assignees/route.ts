import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getApiAuth } from '@/lib/api-auth';
import { captureApiError } from '@/lib/api-error';

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
    const { auth } = await getApiAuth(request);
    if (!auth) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }
    const role = auth.role.toLowerCase();
    if (role !== 'admin' && role !== 'owner' && role !== 'manager') {
      return NextResponse.json({ error: '権限がありません' }, { status: 403 });
    }
    const isGlobal = role === 'admin' || role === 'owner';

    const { badgeId } = await params;
    const db = getSupabaseAdmin();

    const { data, error } = await db
      .from('teacher_badge_assignments')
      .select('teacher_id')
      .eq('badge_id', badgeId);

    if (error) throw error;

    let assignedTeacherIds = (data || []).map((a: { teacher_id: string }) => a.teacher_id);

    // manager は自分の教室に所属する講師の付与のみ見えるように絞る
    if (!isGlobal) {
      const { data: scopeRows } = await db
        .from('user_schools')
        .select('user_id')
        .in('school_id', auth.schoolIds);
      const allowed = new Set((scopeRows || []).map((r) => String(r.user_id)));
      assignedTeacherIds = assignedTeacherIds.filter((id) => allowed.has(String(id)));
    }

    return NextResponse.json({ assignedTeacherIds });
  } catch (err) {
    captureApiError(err, {
      route: 'GET /api/admin/teacher-badges/[badgeId]/assignees',
    });
    console.error('GET /api/admin/teacher-badges/[badgeId]/assignees error:', err);
    return NextResponse.json({ error: '付与情報の取得に失敗しました' }, { status: 500 });
  }
}
