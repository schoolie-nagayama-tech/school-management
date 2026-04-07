import { NextRequest, NextResponse } from 'next/server';
import { getApiAuth } from '@/lib/api-auth';
import { listCalendarEvents } from '@/lib/google-calendar';

export const dynamic = 'force-dynamic';

/**
 * Google Calendar イベント一覧を取得
 * GET /api/integrations/google/calendar/events?timeMin=...&timeMax=...
 */
export async function GET(request: NextRequest) {
  const { auth } = await getApiAuth(request);
  if (!auth) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const url = new URL(request.url);
  const timeMin = url.searchParams.get('timeMin');
  const timeMax = url.searchParams.get('timeMax');

  if (!timeMin || !timeMax) {
    return NextResponse.json({ error: 'timeMin, timeMax は必須です' }, { status: 400 });
  }

  const result = await listCalendarEvents(auth.userId, timeMin, timeMax);

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ data: result.events });
}
