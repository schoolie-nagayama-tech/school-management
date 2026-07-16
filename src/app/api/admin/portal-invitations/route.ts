import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { requireAdmin, getApiAuth } from '@/lib/api-auth';
import { getPortalServiceClient } from '@/lib/mypage/serviceClient';

export const dynamic = 'force-dynamic';

/** 招待の有効期限（7日）。account-line-design.md §9。 */
const EXPIRES_IN_DAYS = 7;

const INVITE_TYPES = ['guardian', 'student'] as const;
type InviteType = (typeof INVITE_TYPES)[number];

/**
 * ポータル招待の発行・一覧（アドミン限定 = クローズドの担保）。
 *
 * POST { student_id, invite_type } → token/expires_at 発行、受諾URLを返す。
 * GET ?school_id=&student_id= → 発行済み一覧（受諾状況つき）。
 */

export async function POST(request: NextRequest) {
  // クローズド期間はアドミンのみ招待を発行できる。
  const denied = await requireAdmin(request);
  if (denied) return denied;

  // created_by（発行スタッフ）用に userId を取得する。
  const { auth } = await getApiAuth(request);
  if (!auth) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
  }

  const student_id = body.student_id;
  const invite_type = body.invite_type;
  if (typeof student_id !== 'string' || !student_id) {
    return NextResponse.json({ error: '生徒を指定してください' }, { status: 400 });
  }
  if (typeof invite_type !== 'string' || !INVITE_TYPES.includes(invite_type as InviteType)) {
    return NextResponse.json({ error: '招待タイプが不正です' }, { status: 400 });
  }

  const supabase = getPortalServiceClient();

  // 生徒の存在確認と発行教室（school_id）の取得。
  const { data: student, error: stErr } = await supabase
    .from('students')
    .select('id, school_id')
    .eq('id', student_id)
    .maybeSingle();
  if (stErr) {
    console.error('[admin/portal-invitations] 生徒取得に失敗:', stErr.message);
    return NextResponse.json({ error: '招待の発行に失敗しました' }, { status: 500 });
  }
  if (!student) {
    return NextResponse.json({ error: '生徒が見つかりません' }, { status: 404 });
  }

  // 十分な強度のランダムトークン（64桁hex）。受諾URLに載せる。
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + EXPIRES_IN_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: created, error: insErr } = await supabase
    .from('portal_invitations')
    .insert({
      token,
      student_id,
      invite_type,
      expires_at: expiresAt,
      created_by: auth.userId,
      school_id: student.school_id,
    })
    .select('id, token, expires_at, invite_type, student_id')
    .single();

  if (insErr) {
    console.error('[admin/portal-invitations] 招待作成に失敗:', insErr.message);
    return NextResponse.json({ error: '招待の発行に失敗しました' }, { status: 500 });
  }

  const acceptUrl = `${request.nextUrl.origin}/mypage/invite/${token}`;

  return NextResponse.json({
    ok: true,
    invitation: created,
    accept_url: acceptUrl,
  });
}

export async function GET(request: NextRequest) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const supabase = getPortalServiceClient();
  const schoolId = request.nextUrl.searchParams.get('school_id');
  const studentId = request.nextUrl.searchParams.get('student_id');

  // 招待一覧。生徒名も一緒に返す（一覧表示用）。
  let query = supabase
    .from('portal_invitations')
    .select(
      'id, token, student_id, invite_type, expires_at, accepted_at, accepted_by, school_id, created_at, students(last_name, first_name)'
    )
    .order('created_at', { ascending: false });

  if (schoolId) query = query.eq('school_id', schoolId);
  if (studentId) query = query.eq('student_id', studentId);

  const { data, error } = await query;
  if (error) {
    console.error('[admin/portal-invitations] 一覧取得に失敗:', error.message);
    return NextResponse.json({ error: '一覧の取得に失敗しました' }, { status: 500 });
  }

  return NextResponse.json({ invitations: data ?? [] });
}
