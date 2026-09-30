import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getApiAuth, isSchoolInScope } from '@/lib/api-auth';
import { hasRoleLevel } from '@/lib/utils/roles';
import { captureApiError } from '@/lib/api-error';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/**
 * 講師の出勤簿ページ（/attendance/[schoolCode]/[teacherId]）の見出しに出す講師名を返す。
 *
 * ★なぜサーバーAPIにしたか:
 *   以前はページがブラウザから user_profiles を直接読んでおり、それを通すために
 *   RLS "Anyone can view active teachers for attendance portal"（role='teacher' かつ在籍なら誰でも可）
 *   があった。このポリシーは anon にも効くため、公開キーだけで在籍講師全員の行
 *   （メール・氏名・性別・入社日…）を誰でも読めた。ポリシーを消すため、必要な1件・必要な列だけを
 *   service role で返すこのAPIに移した。
 *
 * ★返すのは id と表示名だけ。email は display_name が空のときの表示用の代わり（旧実装の
 *   `display_name || email` と同じ見え方を保つため）に限って返す。
 *
 * 認可:
 *   - ログイン必須（出勤簿ページ自体が AuthContext でログイン必須）。保護者ロールは不可。
 *   - 本人の分はいつでも可。
 *   - 他人の分は、その教室が呼び出し元の担当範囲（getApiAuth の schoolIds。admin/owner は全教室、
 *     それ以外は所属教室）に入っているときだけ。
 *   - 講師は「その教室に所属している」か「その教室の出勤簿を持っている」こと。
 *     後者を認めるのは getOrCreateAttendanceSheet と同じ理由で、異動などで所属が外れても
 *     過去の出勤簿の閲覧・提出まで塞がないため。
 *   条件に合わない場合は、講師が存在するかどうかを区別させないよう一律 404 を返す。
 */
export async function GET(request: NextRequest) {
  try {
    const { auth } = await getApiAuth(request);
    if (!auth) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }
    if (!hasRoleLevel(auth.role, 'teacher')) {
      return NextResponse.json({ error: '権限がありません' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const schoolCode = searchParams.get('schoolCode')?.trim() ?? '';
    const teacherId = searchParams.get('teacherId')?.trim() ?? '';
    if (!schoolCode || !UUID_RE.test(teacherId)) {
      return NextResponse.json({ error: 'schoolCode と teacherId が必要です' }, { status: 400 });
    }

    const notFound = () =>
      NextResponse.json({ error: '講師情報が見つかりません' }, { status: 404 });

    const supabaseAdmin = getSupabaseAdmin();

    const { data: school, error: schoolError } = await supabaseAdmin
      .from('schools')
      .select('id')
      .eq('code', schoolCode)
      .maybeSingle();
    if (schoolError) throw schoolError;
    if (!school) return notFound();

    const isSelf = auth.userId === teacherId;
    if (!isSelf && !isSchoolInScope(school.id, auth.schoolIds)) {
      return notFound();
    }

    // role='teacher' の絞り込みは旧実装（ページの直読み）と同じ。
    const { data: teacher, error: teacherError } = await supabaseAdmin
      .from('user_profiles')
      .select('id, display_name, email, is_active')
      .eq('id', teacherId)
      .eq('role', 'teacher')
      .maybeSingle();
    if (teacherError) throw teacherError;
    if (!teacher || teacher.is_active === false) return notFound();

    const { data: membership, error: membershipError } = await supabaseAdmin
      .from('user_schools')
      .select('school_id')
      .eq('user_id', teacherId)
      .eq('school_id', school.id)
      .limit(1);
    if (membershipError) throw membershipError;

    if (!membership || membership.length === 0) {
      const { data: sheets, error: sheetError } = await supabaseAdmin
        .from('attendance_sheets')
        .select('id')
        .eq('teacher_id', teacherId)
        .eq('school_id', school.id)
        .limit(1);
      if (sheetError) throw sheetError;
      if (!sheets || sheets.length === 0) return notFound();
    }

    const displayName = (teacher.display_name as string | null) || null;
    return NextResponse.json({
      teacher: {
        id: teacher.id as string,
        display_name: displayName,
        email: displayName ? null : ((teacher.email as string | null) ?? null),
      },
    });
  } catch (e) {
    captureApiError(e, { route: 'GET /api/attendance/teacher-profile' });
    console.error('GET /api/attendance/teacher-profile error:', e);
    return NextResponse.json({ error: '講師情報の取得に失敗しました' }, { status: 500 });
  }
}
