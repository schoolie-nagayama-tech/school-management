import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';
import { syncCalendarBookingsToProgress } from '@/lib/api/courseProgressSync';

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/api/integrations/google/callback`
  );
}

/**
 * POST /api/courses/progress/sync-calendar
 *
 * Googleカレンダーから面談予約イベントを取得し、
 * 該当生徒の進捗「面談申込・面談日決定」を自動で完了にする
 *
 * body: { schoolId: string }
 */
export async function POST(request: Request) {
  try {
    const supabaseAdmin = getSupabaseAdmin();

    // 認証チェック
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }

    const body = await request.json();
    const { schoolId } = body;
    if (!schoolId) {
      return NextResponse.json({ error: 'schoolIdが必要です' }, { status: 400 });
    }

    // 教室のメールアドレスを取得
    const { data: school } = await supabaseAdmin
      .from('schools')
      .select('notification_email, notification_emails')
      .eq('id', schoolId)
      .maybeSingle();

    if (!school) {
      return NextResponse.json({ error: '教室が見つかりません' }, { status: 404 });
    }

    const schoolEmails: string[] = [];
    if (school.notification_email) {
      schoolEmails.push(school.notification_email.toLowerCase());
    }
    if (school.notification_emails && Array.isArray(school.notification_emails)) {
      for (const e of school.notification_emails) {
        const lower = (e as string).toLowerCase();
        if (!schoolEmails.includes(lower)) {
          schoolEmails.push(lower);
        }
      }
    }

    // calendar_emailが教室メールと一致するトークンを検索
    const { data: allTokens } = await supabaseAdmin
      .from('google_calendar_tokens')
      .select('user_id, access_token, refresh_token, token_expiry, calendar_email');

    if (!allTokens || allTokens.length === 0) {
      return NextResponse.json({
        error: 'Googleカレンダー連携済みのユーザーがいません',
      }, { status: 400 });
    }

    const matchedToken = allTokens.find(
      (t: { calendar_email: string | null }) =>
        t.calendar_email && schoolEmails.includes(t.calendar_email.toLowerCase())
    );

    if (!matchedToken) {
      return NextResponse.json({
        error: `教室メール(${schoolEmails.join(', ')})と一致するカレンダー連携がありません`,
      }, { status: 400 });
    }

    // OAuth2クライアントを構築
    const oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials({
      access_token: matchedToken.access_token,
      refresh_token: matchedToken.refresh_token,
      expiry_date: new Date(matchedToken.token_expiry).getTime(),
    });

    // トークンリフレッシュ
    const now = Date.now();
    const expiry = new Date(matchedToken.token_expiry).getTime();
    if (now >= expiry - 60000) {
      try {
        const { credentials } = await oauth2Client.refreshAccessToken();
        await supabaseAdmin
          .from('google_calendar_tokens')
          .update({
            access_token: credentials.access_token!,
            token_expiry: new Date(credentials.expiry_date!).toISOString(),
          })
          .eq('user_id', matchedToken.user_id);
        oauth2Client.setCredentials(credentials);
      } catch {
        return NextResponse.json({
          error: 'Googleカレンダーのトークンリフレッシュに失敗しました。再連携が必要です。',
        }, { status: 401 });
      }
    }

    // カレンダーから面談系のイベントを取得（過去1ヶ月〜未来2ヶ月）
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    const timeMin = new Date();
    timeMin.setMonth(timeMin.getMonth() - 1);
    const timeMax = new Date();
    timeMax.setMonth(timeMax.getMonth() + 2);

    const { data: eventsResponse } = await calendar.events.list({
      calendarId: 'primary',
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      maxResults: 500,
      singleEvents: true,
      orderBy: 'startTime',
      q: '面談', // 面談を含むイベントのみ
    });

    const events = (eventsResponse.items || []).map((e) => ({
      summary: e.summary || '',
      description: e.description || '',
      start: e.start?.dateTime || e.start?.date || '',
    }));

    if (events.length === 0) {
      return NextResponse.json({
        message: 'カレンダーに面談関連のイベントが見つかりませんでした',
        synced: 0,
        skipped: 0,
        notFound: [],
      });
    }

    // 進捗を同期
    const result = await syncCalendarBookingsToProgress(schoolId, events);

    return NextResponse.json({
      message: `${result.synced}件の面談申込を同期しました`,
      ...result,
      totalEvents: events.length,
    });
  } catch (error) {
    console.error('[sync-calendar] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '同期に失敗しました' },
      { status: 500 }
    );
  }
}
