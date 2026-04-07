import { NextRequest, NextResponse } from 'next/server';
import { getApiAuth } from '@/lib/api-auth';
import { listCalendarEvents, createCalendarEvent, getCalendarConnectionStatus } from '@/lib/google-calendar';

export const dynamic = 'force-dynamic';

/**
 * Google Calendar イベント一覧を取得
 * GET /api/integrations/google/calendar/events?timeMin=...&timeMax=...
 *   → includeStatus=true を付けると status 情報も返す（API統合用）
 */
export async function GET(request: NextRequest) {
  const { auth } = await getApiAuth(request);
  if (!auth) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const url = new URL(request.url);
  const timeMin = url.searchParams.get('timeMin');
  const timeMax = url.searchParams.get('timeMax');
  const includeStatus = url.searchParams.get('includeStatus') === 'true';

  // includeStatus の場合は status + events を一度に返す
  if (includeStatus) {
    const status = await getCalendarConnectionStatus(auth.userId);
    if (!status.connected) {
      return NextResponse.json({ data: null, status: { connected: false } });
    }
    if (!timeMin || !timeMax) {
      return NextResponse.json({ data: null, status: { connected: true, email: status.email } });
    }
    const result = await listCalendarEvents(auth.userId, timeMin, timeMax);
    return NextResponse.json({
      data: result.success ? result.events : [],
      status: { connected: true, email: status.email },
      ...(result.error ? { error: result.error } : {}),
    });
  }

  // 従来互換: events のみ
  if (!timeMin || !timeMax) {
    return NextResponse.json({ error: 'timeMin, timeMax は必須です' }, { status: 400 });
  }

  const result = await listCalendarEvents(auth.userId, timeMin, timeMax);

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ data: result.events });
}

/**
 * Google Calendar イベント作成
 * POST /api/integrations/google/calendar/events
 * Body: { summary, description?, date, startTime?, durationMinutes?, allDay? }
 */
export async function POST(request: NextRequest) {
  const { auth } = await getApiAuth(request);
  if (!auth) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const body = await request.json();
  const { summary, description, date, startTime, durationMinutes, allDay } = body;

  if (!summary || !date) {
    return NextResponse.json({ error: 'summary と date は必須です' }, { status: 400 });
  }

  const result = await createCalendarEvent(auth.userId, {
    summary,
    description: description || '',
    date,
    startTime: startTime || '09:00',
    durationMinutes: durationMinutes || 60,
    allDay: !!allDay,
  });

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ data: { eventId: result.eventId } });
}
