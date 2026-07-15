import { NextRequest, NextResponse } from 'next/server';
import { requirePortalSession } from '@/lib/mypage/portalAuth';
import { getPortalReport } from '@/lib/mypage/reports';

export const dynamic = 'force-dynamic';

/**
 * 授業報告書の詳細（§7-4）。
 *
 * GET /api/mypage/reports/[reportId]
 *
 * ★ requirePortalStudent ではなく requirePortalSession を使う理由:
 *   このルートは studentId を受け取らない（reportId から生徒が決まる）。紐づけ検証は
 *   限定公開ビュー portal_class_reports の述語がそのまま担う（承認済み・自分の紐づけ生徒・
 *   在籍中・教室スコープ）。見えなければ 404。
 *   ＝「生徒IDを引数で受けて検証する」より、「見えるものだけが返る」方が強い。
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ reportId: string }> }
) {
  const { reportId } = await params;

  const auth = await requirePortalSession();
  if ('error' in auth) return auth.error;

  const report = await getPortalReport(auth.client, reportId);
  if (!report) {
    // 承認前・他人の生徒・退塾超過・他教室はすべて 404（存在有無を漏らさない）。
    return NextResponse.json({ error: '報告書が見つかりません' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, report });
}
