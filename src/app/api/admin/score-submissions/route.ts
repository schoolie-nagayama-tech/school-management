import { NextRequest, NextResponse } from 'next/server';
import { requireScoreEditor, getApiAuth } from '@/lib/api-auth';
import { getPortalServiceClient } from '@/lib/mypage/serviceClient';
import { listScoreSubmissionsForReview } from '@/lib/api/scoreSubmissions';
import type { ScoreSubmissionStatus } from '@/types/portal-scores';

export const dynamic = 'force-dynamic';

const VALID_STATUSES: ScoreSubmissionStatus[] = ['submitted', 'approved', 'rejected'];

/**
 * スタッフの成績申請キュー（Stage 5・§7-5）。
 *
 * portal_score_submissions は authenticated に SELECT のみ許可されているが、教室スコープの
 * 絞り込み・生徒名の解決・既存assessmentsとの差分添付をまとめて行うため、他の管理系一覧
 * （/api/admin/portal-chat/threads）と同じく service role 経由のこの API で提供する。
 *
 * 権限境界: 承認/差し戻し（canEditScores＝講師も可）と同じにする。キューが見えるのに
 * 承認ボタンだけ権限不足で弾かれる、という画面側のズレを作らないため。
 *
 * GET ?status=submitted（省略時は 'submitted'）→ auth.schoolIds に絞った一覧。
 */
export async function GET(request: NextRequest) {
  const denied = await requireScoreEditor(request);
  if (denied) return denied;
  const { auth } = await getApiAuth(request);
  if (!auth) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

  const statusParam = request.nextUrl.searchParams.get('status') ?? 'submitted';
  if (!VALID_STATUSES.includes(statusParam as ScoreSubmissionStatus)) {
    return NextResponse.json({ error: 'status が不正です' }, { status: 400 });
  }

  if (auth.schoolIds.length === 0) {
    return NextResponse.json({ ok: true, submissions: [] });
  }

  const svc = getPortalServiceClient();
  const submissions = await listScoreSubmissionsForReview(
    svc,
    auth.schoolIds,
    statusParam as ScoreSubmissionStatus
  );

  return NextResponse.json({ ok: true, submissions });
}
