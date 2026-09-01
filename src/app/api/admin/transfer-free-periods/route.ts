import { NextRequest, NextResponse } from 'next/server';
import { getApiAuth, requireManager } from '@/lib/api-auth';
import { getPortalServiceClient } from '@/lib/mypage/serviceClient';
import { captureApiError } from '@/lib/api-error';

export const dynamic = 'force-dynamic';

/**
 * スタッフ側: 振替無制限期間（講習前フリー期間）の設定（§7-3）。
 *
 * 対象授業日がこの期間内なら、保護者側の振替上限判定はスキップされる。
 *
 * GET    ?schoolId=  一覧（教室スコープ）
 * POST   { schoolId, startDate, endDate, label? }  追加
 * DELETE ?id=        削除
 *
 * 認可: requireManager ＋ 教室スコープ（schoolId が自分の schoolIds に含まれること）。
 */

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** 操作対象の教室が、操作者のアクセス可能範囲かを判定する。 */
function schoolAllowed(schoolId: string, schoolIds: string[], role: string): boolean {
  // admin/owner は全教室。それ以外は自分の担当教室のみ。
  if (role === 'admin' || role === 'owner') return true;
  return schoolIds.includes(schoolId);
}

export async function GET(request: NextRequest) {
  const denied = await requireManager(request);
  if (denied) return denied;
  const { auth } = await getApiAuth(request);
  if (!auth) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const schoolId = request.nextUrl.searchParams.get('schoolId');
  const svc = getPortalServiceClient();
  let q = svc
    .from('transfer_free_periods')
    .select('id, school_id, start_date, end_date, label, created_at')
    .order('start_date', { ascending: false });

  const isGlobal = auth.role === 'admin' || auth.role === 'owner';
  if (schoolId) {
    if (!schoolAllowed(schoolId, auth.schoolIds, auth.role)) {
      return NextResponse.json({ error: '権限がありません' }, { status: 403 });
    }
    q = q.eq('school_id', schoolId);
  } else if (!isGlobal) {
    // 教室指定が無いときは自分の担当教室に限定する（越境閲覧の防止）。
    q = q.in('school_id', auth.schoolIds);
  }

  const { data, error } = await q;
  if (error) {
    console.error('[admin/transfer-free-periods] 一覧取得に失敗:', error.message);
    return NextResponse.json({ error: '取得に失敗しました' }, { status: 500 });
  }
  return NextResponse.json({ ok: true, periods: data ?? [] });
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
      route: 'POST /api/admin/transfer-free-periods',
      userId: auth.userId,
      role: auth.role,
    });
    return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
  }

  const schoolId = typeof body.schoolId === 'string' ? body.schoolId : '';
  const startDate = typeof body.startDate === 'string' ? body.startDate : '';
  const endDate = typeof body.endDate === 'string' ? body.endDate : '';
  const label = typeof body.label === 'string' && body.label ? body.label : null;

  if (!schoolId) return NextResponse.json({ error: 'schoolId が必要です' }, { status: 400 });
  if (!YMD.test(startDate) || !YMD.test(endDate)) {
    return NextResponse.json({ error: '開始日・終了日（YYYY-MM-DD）が必要です' }, { status: 400 });
  }
  // 'YYYY-MM-DD' は辞書順＝日付順なので、そのまま前後関係を判定できる（DB の CHECK と対）。
  if (startDate > endDate) {
    return NextResponse.json({ error: '終了日は開始日以降にしてください' }, { status: 400 });
  }
  if (!schoolAllowed(schoolId, auth.schoolIds, auth.role)) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }

  const svc = getPortalServiceClient();
  const { data, error } = await svc
    .from('transfer_free_periods')
    .insert({
      school_id: schoolId,
      start_date: startDate,
      end_date: endDate,
      label,
      created_by: auth.userId,
    })
    .select('id')
    .single();

  if (error) {
    console.error('[admin/transfer-free-periods] 追加に失敗:', error.message);
    return NextResponse.json({ error: '追加に失敗しました' }, { status: 500 });
  }
  return NextResponse.json({ ok: true, id: (data as { id: string }).id });
}

export async function DELETE(request: NextRequest) {
  const denied = await requireManager(request);
  if (denied) return denied;
  const { auth } = await getApiAuth(request);
  if (!auth) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const id = request.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id が必要です' }, { status: 400 });

  const svc = getPortalServiceClient();
  // 削除前に対象の教室を確認する（他教室の期間を id 直打ちで消させない）。
  const { data: row } = await svc
    .from('transfer_free_periods')
    .select('school_id')
    .eq('id', id)
    .maybeSingle();
  const schoolId = (row as { school_id: string } | null)?.school_id;
  if (!schoolId) return NextResponse.json({ error: '対象が見つかりません' }, { status: 404 });
  if (!schoolAllowed(schoolId, auth.schoolIds, auth.role)) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }

  const { error } = await svc.from('transfer_free_periods').delete().eq('id', id);
  if (error) {
    console.error('[admin/transfer-free-periods] 削除に失敗:', error.message);
    return NextResponse.json({ error: '削除に失敗しました' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
