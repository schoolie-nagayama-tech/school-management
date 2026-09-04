import { NextRequest, NextResponse } from 'next/server';
import { getApiAuth, requireManager } from '@/lib/api-auth';
import { getPortalServiceClient } from '@/lib/mypage/serviceClient';
import { monthStartOf } from '@/lib/mypage/transferQuota';
import { captureApiError } from '@/lib/api-error';

export const dynamic = 'force-dynamic';

/**
 * スタッフ側: 生徒×月の「振替追加許可」の付与/取消（§7-3）。
 *
 * これが無い限り保護者は上限でハードストップする。教室の明示許可だけが例外を開ける。
 *
 * GET    ?schoolId=&month=YYYY-MM-DD  一覧（教室スコープ）
 * POST   { studentId, month, extraCount?, note? }  付与（生徒×月で upsert）
 * DELETE ?studentId=&month=            取消
 *
 * 認可: requireManager ＋ 教室スコープ（対象生徒の所属校が自分の schoolIds に含まれること）。
 */

/** 対象生徒の所属校が、操作者のアクセス可能教室に含まれるかを検証する。 */
async function assertStudentInScope(
  studentId: string,
  schoolIds: string[],
  role: string
): Promise<{ schoolId: string } | { error: NextResponse }> {
  const svc = getPortalServiceClient();
  const { data } = await svc.from('students').select('school_id').eq('id', studentId).maybeSingle();
  const schoolId = (data as { school_id: string } | null)?.school_id;
  if (!schoolId) {
    return { error: NextResponse.json({ error: '生徒が見つかりません' }, { status: 404 }) };
  }
  // admin/owner は全教室。それ以外は自分の担当教室のみ。
  const isGlobal = role === 'admin' || role === 'owner';
  if (!isGlobal && !schoolIds.includes(schoolId)) {
    return { error: NextResponse.json({ error: '権限がありません' }, { status: 403 }) };
  }
  return { schoolId };
}

export async function GET(request: NextRequest) {
  const denied = await requireManager(request);
  if (denied) return denied;
  const { auth } = await getApiAuth(request);
  if (!auth) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const sp = request.nextUrl.searchParams;
  const month = sp.get('month');
  const schoolId = sp.get('schoolId');

  const svc = getPortalServiceClient();
  let q = svc
    .from('portal_transfer_permissions')
    .select('id, school_id, student_id, month, extra_count, note, created_at')
    .order('month', { ascending: false });

  const isGlobal = auth.role === 'admin' || auth.role === 'owner';
  if (schoolId) {
    if (!isGlobal && !auth.schoolIds.includes(schoolId)) {
      return NextResponse.json({ error: '権限がありません' }, { status: 403 });
    }
    q = q.eq('school_id', schoolId);
  } else if (!isGlobal) {
    // 教室指定が無いときは自分の担当教室に限定する（越境閲覧の防止）。
    q = q.in('school_id', auth.schoolIds);
  }
  if (month) {
    const ms = monthStartOf(month);
    if (!ms) return NextResponse.json({ error: 'month の形式が不正です' }, { status: 400 });
    q = q.eq('month', ms);
  }

  const { data, error } = await q;
  if (error) {
    console.error('[admin/portal-transfer-permissions] 一覧取得に失敗:', error.message);
    return NextResponse.json({ error: '取得に失敗しました' }, { status: 500 });
  }
  return NextResponse.json({ ok: true, permissions: data ?? [] });
}

export async function POST(request: NextRequest) {
  const denied = await requireManager(request);
  if (denied) return denied;
  const { auth } = await getApiAuth(request);
  if (!auth) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch (error) {
    captureApiError(error, {
      route: 'POST /api/admin/portal-transfer-permissions',
      userId: auth.userId,
      role: auth.role,
    });
    return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
  }

  const studentId = typeof body.studentId === 'string' ? body.studentId : '';
  const monthRaw = typeof body.month === 'string' ? body.month : '';
  const extraCount = typeof body.extraCount === 'number' ? body.extraCount : 1;
  const note = typeof body.note === 'string' ? body.note : null;

  if (!studentId) return NextResponse.json({ error: 'studentId が必要です' }, { status: 400 });
  // month は月初日に正規化する（テーブルの CHECK と対。表記ゆれをここで吸収）。
  const month = monthStartOf(monthRaw);
  if (!month) {
    return NextResponse.json({ error: 'month（YYYY-MM-DD）が必要です' }, { status: 400 });
  }
  if (!Number.isInteger(extraCount) || extraCount < 1) {
    return NextResponse.json({ error: 'extraCount は1以上の整数です' }, { status: 400 });
  }

  const scope = await assertStudentInScope(studentId, auth.schoolIds, auth.role);
  if ('error' in scope) return scope.error;

  const svc = getPortalServiceClient();
  const { data, error } = await svc
    .from('portal_transfer_permissions')
    .upsert(
      {
        school_id: scope.schoolId,
        student_id: studentId,
        month,
        extra_count: extraCount,
        granted_by: auth.userId,
        note,
      },
      { onConflict: 'student_id,month' }
    )
    .select('id')
    .single();

  if (error) {
    console.error('[admin/portal-transfer-permissions] 付与に失敗:', error.message);
    return NextResponse.json({ error: '付与に失敗しました' }, { status: 500 });
  }
  return NextResponse.json({ ok: true, id: (data as { id: string }).id });
}

export async function DELETE(request: NextRequest) {
  const denied = await requireManager(request);
  if (denied) return denied;
  const { auth } = await getApiAuth(request);
  if (!auth) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const sp = request.nextUrl.searchParams;
  const studentId = sp.get('studentId') ?? '';
  const month = monthStartOf(sp.get('month') ?? '');
  if (!studentId || !month) {
    return NextResponse.json({ error: 'studentId と month が必要です' }, { status: 400 });
  }

  const scope = await assertStudentInScope(studentId, auth.schoolIds, auth.role);
  if ('error' in scope) return scope.error;

  const svc = getPortalServiceClient();
  const { error } = await svc
    .from('portal_transfer_permissions')
    .delete()
    .eq('student_id', studentId)
    .eq('month', month);
  if (error) {
    console.error('[admin/portal-transfer-permissions] 取消に失敗:', error.message);
    return NextResponse.json({ error: '取消に失敗しました' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
