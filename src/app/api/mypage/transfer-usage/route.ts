import { NextRequest, NextResponse } from 'next/server';
import { requirePortalStudent } from '@/lib/mypage/portalAuth';
import { getPortalTransferQuota } from '@/lib/mypage/transferQuota';

export const dynamic = 'force-dynamic';

/**
 * 今月の残り振替回数（§7-3）。
 *
 * GET /api/mypage/transfer-usage?studentId=...&targetDate=YYYY-MM-DD
 *
 * ★ なぜ API 越しなのか:
 *   上限判定には schedule_regular_patterns（通塾日程パターン）が要るが、これは
 *   portal ロールに grant しない＝ポータルに素の座席表テーブルを開けない方針（§7-3）。
 *   よって判定は service role でサーバー側だけで行い、クライアントには結果
 *   （残り数・許可中・無制限期間中）だけを返す。
 *
 * ★ targetDate は「対象授業日」。省略時は今日。今日の月ではなく対象授業日の月で数える
 *   （8/1 に 7/31 の欠席を連絡したら 7 月分）— §7-3 の罠。
 */
export async function GET(request: NextRequest) {
  const studentId = request.nextUrl.searchParams.get('studentId');
  const targetDateParam = request.nextUrl.searchParams.get('targetDate');

  if (!studentId) {
    return NextResponse.json({ error: 'studentId が必要です' }, { status: 400 });
  }
  if (targetDateParam && !/^\d{4}-\d{2}-\d{2}$/.test(targetDateParam)) {
    return NextResponse.json({ error: 'targetDate の形式が不正です' }, { status: 400 });
  }

  // セッション＋紐づけ検証（service role を使う前に必ず通す）。
  const auth = await requirePortalStudent(studentId);
  if ('error' in auth) return auth.error;

  const targetDate = targetDateParam ?? todayJst();
  const quota = await getPortalTransferQuota(studentId, targetDate);

  return NextResponse.json({ ok: true, targetDate, quota });
}

/**
 * 今日の JST カレンダー日 'YYYY-MM-DD'。
 * サーバーが UTC でも JST の日付になるよう +9h してから UTC 部分を切り出す。
 */
function todayJst(): string {
  const nowJst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return nowJst.toISOString().slice(0, 10);
}
