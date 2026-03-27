import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

/**
 * 全ユーザーのGoogleカレンダー連携状況を取得（admin/owner のみ）
 */
export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) {
    return authError;
  }

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // google_calendar_tokens と user_profiles を結合
  const { data: tokens, error } = await supabaseAdmin
    .from('google_calendar_tokens')
    .select('user_id, calendar_email, created_at, token_expiry');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!tokens || tokens.length === 0) {
    return NextResponse.json({ connections: [] });
  }

  // ユーザープロフィール取得
  const userIds = tokens.map((t) => t.user_id);
  const { data: profiles } = await supabaseAdmin
    .from('user_profiles')
    .select('id, display_name, role')
    .in('id', userIds);

  // user_schools でどの教室に所属しているか取得
  const { data: userSchools } = await supabaseAdmin
    .from('user_schools')
    .select('user_id, school_id, schools(id, name)')
    .in('user_id', userIds);

  const profileMap = new Map(
    (profiles || []).map((p) => [p.id, p])
  );

  const schoolMap = new Map<string, Array<{ id: string; name: string }>>();
  for (const us of userSchools || []) {
    const schools = schoolMap.get(us.user_id) || [];
    const school = us.schools as unknown as { id: string; name: string } | null;
    if (school) {
      schools.push({ id: school.id, name: school.name });
    }
    schoolMap.set(us.user_id, schools);
  }

  const connections = tokens.map((t) => {
    const profile = profileMap.get(t.user_id);
    return {
      userId: t.user_id,
      displayName: profile?.display_name || '不明',
      role: profile?.role || '不明',
      calendarEmail: t.calendar_email,
      connectedAt: t.created_at,
      tokenExpiry: t.token_expiry,
      schools: schoolMap.get(t.user_id) || [],
    };
  });

  return NextResponse.json({ connections });
}
