import { NextRequest, NextResponse } from 'next/server';
import { getApiAuth } from '@/lib/api-auth';
import { getCalendarConnectionStatus } from '@/lib/google-calendar';

export const dynamic = 'force-dynamic';

/**
 * Google Calendar 連携状態を取得
 */
export async function GET(request: NextRequest) {
  const { auth } = await getApiAuth(request);
  if (!auth) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const status = await getCalendarConnectionStatus(auth.userId);
  return NextResponse.json({ data: status });
}
