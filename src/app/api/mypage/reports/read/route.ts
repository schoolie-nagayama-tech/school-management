import { NextRequest, NextResponse } from 'next/server';
import { requirePortalSession } from '@/lib/mypage/portalAuth';
import { getPortalReport, markPortalReportRead } from '@/lib/mypage/reports';
import { captureApiError } from '@/lib/api-error';

export const dynamic = 'force-dynamic';

/**
 * 報告書の既読記録（§7-4）。
 *
 * POST /api/mypage/reports/read  body: { report_id }
 *
 * ★ 書き込みは service role だが、その前に必ず portal クライアントで可視性を確かめる:
 *   service role は RLS/ビューをバイパスするので、可視性チェック無しに既読を書けると
 *   「見えない報告書（承認前・他人の生徒）の ID を総当たりして、既読が作れるかどうかで
 *    存在を推測する」経路になる。getPortalReport は portal クライアントで読むので、
 *   見えない報告書はここで 404 になり、書き込みまで到達しない。
 */
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch (error) {
    captureApiError(error, {
      route: 'POST /api/mypage/reports/read',
    });
    return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
  }

  const reportId = typeof body.report_id === 'string' ? body.report_id : null;
  if (!reportId) {
    return NextResponse.json({ error: 'report_id が必要です' }, { status: 400 });
  }

  const auth = await requirePortalSession();
  if ('error' in auth) return auth.error;

  // 可視性チェック（portal クライアント越し）。見えないものは既読にできない。
  const report = await getPortalReport(auth.client, reportId);
  if (!report) {
    return NextResponse.json({ error: '報告書が見つかりません' }, { status: 404 });
  }

  await markPortalReportRead(auth.accountId, reportId, auth.svc);
  return NextResponse.json({ ok: true });
}
