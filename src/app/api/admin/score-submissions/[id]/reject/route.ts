import { NextRequest, NextResponse } from 'next/server';
import { requireScoreEditor, getApiAuth } from '@/lib/api-auth';
import { getPortalServiceClient } from '@/lib/mypage/serviceClient';
import { rejectScoreSubmission } from '@/lib/api/scoreSubmissions';
import { captureApiError } from '@/lib/api-error';

export const dynamic = 'force-dynamic';

/**
 * 成績申請の差し戻し（Stage 5・§7-5）。理由は保護者にそのまま表示されるため必須。
 *
 * POST /api/admin/score-submissions/[id]/reject  body: { reason: string }
 *
 * 権限境界は承認と同じ canEditScores。DB の CHECK
 * （portal_score_submissions_rejected_reason_required）も理由の空文字を弾くため、
 * ここでの400チェックとDBのCHECKは多層防御の関係にある。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireScoreEditor(request);
  if (denied) return denied;
  const { auth } = await getApiAuth(request);
  if (!auth) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch (error) {
    captureApiError(error, {
      route: 'POST /api/admin/score-submissions/[id]/reject',
      userId: auth.userId,
      role: auth.role,
    });
    return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
  }

  const reason = body.reason;
  if (typeof reason !== 'string' || !reason.trim()) {
    return NextResponse.json({ error: '差し戻し理由を入力してください' }, { status: 400 });
  }

  const { id } = await params;
  const svc = getPortalServiceClient();

  const result = await rejectScoreSubmission(svc, {
    submissionId: id,
    reviewerId: auth.userId,
    reason: reason.trim(),
    schoolIdScope: auth.schoolIds,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ ok: true, submission: result.submission });
}
