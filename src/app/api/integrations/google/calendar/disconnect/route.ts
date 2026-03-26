import { NextRequest, NextResponse } from 'next/server';
import { getApiAuth } from '@/lib/api-auth';
import { disconnectGoogleCalendar } from '@/lib/google-calendar';

export const dynamic = 'force-dynamic';

/**
 * Google Calendar 連携を解除
 */
export async function POST(request: NextRequest) {
  const { auth } = await getApiAuth(request);
  if (!auth) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  await disconnectGoogleCalendar(auth.userId);
  return NextResponse.json({ data: { success: true } });
}
