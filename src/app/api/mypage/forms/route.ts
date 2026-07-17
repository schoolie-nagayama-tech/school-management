import { NextRequest, NextResponse } from 'next/server';
import { requirePortalSession, listLinkedActiveStudentIds } from '@/lib/mypage/portalAuth';
import { getFormGuidance } from '@/lib/mypage/formGuidance';

export const dynamic = 'force-dynamic';

/**
 * 手続きハブのデータ（§7-3「申し込みプッシュ」）。
 *
 * GET /api/mypage/forms            → 紐づけ生徒（在籍中）全員ぶん
 * GET /api/mypage/forms?studentId= → その生徒のみ（紐づけを検証）
 *
 * ★ 認可の組み立て:
 *   getFormGuidance は service role（RLSバイパス）なので、渡す studentIds は必ず
 *   「ポータルJWTのクライアントで見えた在籍中の紐づけ生徒」から作る。
 *   studentId 指定時も、その集合に含まれるかで検証する（＝失効生徒は弾かれる）。
 */
export async function GET(request: NextRequest) {
  const studentId = request.nextUrl.searchParams.get('studentId');

  const auth = await requirePortalSession();
  if ('error' in auth) return auth.error;

  // RLS 越しに見える＝紐づけ済みかつ在籍中の生徒だけ。ここが認可の基点。
  const linkedIds = await listLinkedActiveStudentIds(auth.client);

  let targetIds = linkedIds;
  if (studentId) {
    if (!linkedIds.includes(studentId)) {
      return NextResponse.json({ error: '権限がありません' }, { status: 403 });
    }
    targetIds = [studentId];
  }

  if (targetIds.length === 0) {
    return NextResponse.json({ ok: true, guidance: { pushes: [], items: [] } });
  }

  const guidance = await getFormGuidance(targetIds);
  return NextResponse.json({ ok: true, guidance });
}
