import { NextRequest, NextResponse } from 'next/server';
import { requireScoreEditor, getApiAuth } from '@/lib/api-auth';
import { getPortalServiceClient } from '@/lib/mypage/serviceClient';
import { approveScoreSubmission } from '@/lib/api/scoreSubmissions';

export const dynamic = 'force-dynamic';

/**
 * 成績申請の承認 = 転記（Stage 5・§7-5）。
 *
 * POST /api/admin/score-submissions/[id]/approve
 *
 * 権限境界: canEditScores（講師も可）。承認＝成績を書く行為なので既存の成績編集と同じ境界に
 * 置く設計判断（§7-5）。教室スコープの検証は approveScoreSubmission 内部でも行う（多層防御）。
 *
 * 転記のアトミック性: assessments確保→scores upsert→申請更新の順で行い、途中で失敗したら
 * 申請を 'submitted' のまま残す（＝このエンドポイントを再実行すれば続きから再試行できる）。
 * 詳細は lib/api/scoreSubmissions.ts のコメントを参照。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireScoreEditor(request);
  if (denied) return denied;
  const { auth } = await getApiAuth(request);
  if (!auth) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const { id } = await params;
  const svc = getPortalServiceClient();

  const result = await approveScoreSubmission(svc, {
    submissionId: id,
    reviewerId: auth.userId,
    schoolIdScope: auth.schoolIds,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    submission: result.submission,
    assessmentId: result.assessmentId,
  });
}
