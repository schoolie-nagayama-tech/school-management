import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';

// ============================================
// Google OAuth2 クライアント
// ============================================

function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/api/integrations/google/callback`
  );
}

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

// ============================================
// 認証URL生成
// ============================================

export function getGoogleAuthUrl(userId: string): string {
  const oauth2Client = getOAuth2Client();
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // 毎回 refresh_token を取得するため
    scope: [
      'openid',
      'email',
      'https://www.googleapis.com/auth/calendar.events',
    ],
    state: userId, // コールバックでユーザーを特定
  });
}

// ============================================
// トークン取得・保存
// ============================================

export async function handleGoogleCallback(code: string, userId: string) {
  const oauth2Client = getOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);

  if (!tokens.refresh_token) {
    throw new Error('refresh_token が取得できませんでした。Google側で連携を解除してから再度お試しください。');
  }

  // id_token からメールアドレスを取得（userinfo APIを呼ばずに済む）
  let email: string | null = null;
  if (tokens.id_token) {
    try {
      const payload = JSON.parse(
        Buffer.from(tokens.id_token.split('.')[1], 'base64').toString()
      );
      email = payload.email || null;
    } catch {
      // id_token のパースに失敗しても続行
    }
  }

  const supabaseAdmin = getSupabaseAdmin();
  const { error } = await supabaseAdmin
    .from('google_calendar_tokens')
    .upsert({
      user_id: userId,
      access_token: tokens.access_token!,
      refresh_token: tokens.refresh_token,
      token_expiry: new Date(tokens.expiry_date!).toISOString(),
      calendar_email: email,
    }, { onConflict: 'user_id' });

  if (error) {
    throw new Error(`トークンの保存に失敗しました: ${error.message}`);
  }

  return { email };
}

// ============================================
// トークン取得・リフレッシュ
// ============================================

async function getAuthenticatedClient(userId: string) {
  const supabaseAdmin = getSupabaseAdmin();
  const { data: tokenData, error } = await supabaseAdmin
    .from('google_calendar_tokens')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !tokenData) {
    return null;
  }

  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    expiry_date: new Date(tokenData.token_expiry).getTime(),
  });

  // トークンの有効期限が切れている場合はリフレッシュ
  const now = Date.now();
  const expiry = new Date(tokenData.token_expiry).getTime();
  if (now >= expiry - 60000) { // 1分前にリフレッシュ
    try {
      const { credentials } = await oauth2Client.refreshAccessToken();
      // 新しいトークンを保存
      await supabaseAdmin
        .from('google_calendar_tokens')
        .update({
          access_token: credentials.access_token!,
          token_expiry: new Date(credentials.expiry_date!).toISOString(),
        })
        .eq('user_id', userId);
      oauth2Client.setCredentials(credentials);
    } catch (refreshError) {
      console.error('[google-calendar] トークンリフレッシュ失敗:', refreshError);
      // リフレッシュ失敗時はトークンを削除（再連携が必要）
      await supabaseAdmin
        .from('google_calendar_tokens')
        .delete()
        .eq('user_id', userId);
      return null;
    }
  }

  return oauth2Client;
}

// ============================================
// カレンダーイベント作成
// ============================================

interface CalendarEventParams {
  summary: string;       // イベントタイトル
  description: string;   // 詳細
  date: string;          // YYYY-MM-DD
  startTime: string;     // HH:mm
  durationMinutes: number;
}

export async function createCalendarEvent(
  userId: string,
  params: CalendarEventParams
): Promise<{ success: boolean; eventId?: string; error?: string }> {
  const oauth2Client = await getAuthenticatedClient(userId);
  if (!oauth2Client) {
    return { success: false, error: 'Google Calendar未連携' };
  }

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  // 開始・終了時間を計算
  const startDate = new Date(`${params.date}T${params.startTime}:00+09:00`);
  const endDate = new Date(startDate.getTime() + params.durationMinutes * 60 * 1000);

  try {
    const { data: event } = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: {
        summary: params.summary,
        description: params.description,
        start: {
          dateTime: startDate.toISOString(),
          timeZone: 'Asia/Tokyo',
        },
        end: {
          dateTime: endDate.toISOString(),
          timeZone: 'Asia/Tokyo',
        },
      },
    });

    return { success: true, eventId: event.id || undefined };
  } catch (error) {
    console.error('[google-calendar] イベント作成失敗:', error);
    return { success: false, error: 'カレンダーイベントの作成に失敗しました' };
  }
}

// ============================================
// 連携状態確認
// ============================================

export async function getCalendarConnectionStatus(userId: string): Promise<{
  connected: boolean;
  email?: string;
}> {
  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from('google_calendar_tokens')
    .select('calendar_email')
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !data) {
    return { connected: false };
  }

  return { connected: true, email: data.calendar_email || undefined };
}

// ============================================
// 連携解除
// ============================================

export async function disconnectGoogleCalendar(userId: string): Promise<void> {
  const supabaseAdmin = getSupabaseAdmin();
  await supabaseAdmin
    .from('google_calendar_tokens')
    .delete()
    .eq('user_id', userId);
}

// ============================================
// 模試振替受験 → カレンダーイベント作成
// ============================================

/**
 * 模試の振替受験回答があった場合、対象教室のmanager全員のカレンダーにイベントを追加
 */
export async function createFurikaeCalendarEvents(params: {
  schoolId: string;
  studentName: string;
  grade: string;
  furikaeDate: string;       // YYYY-MM-DD
  furikaeDateLabel: string;  // "4月20日（月）"
  furikaeTime: string;       // "18:30"
  periodTitle?: string;
}): Promise<void> {
  const supabaseAdmin = getSupabaseAdmin();

  // 教室に所属する manager/admin/owner を取得
  const { data: userSchools, error: usError } = await supabaseAdmin
    .from('user_schools')
    .select('user_id')
    .eq('school_id', params.schoolId);

  if (usError || !userSchools || userSchools.length === 0) {
    console.warn('[google-calendar] 教室のユーザーが見つかりません');
    return;
  }

  const userIds = userSchools.map((us: { user_id: string }) => us.user_id);

  // manager以上のロールを持つユーザーを絞り込み
  const { data: profiles, error: profileError } = await supabaseAdmin
    .from('user_profiles')
    .select('id, role')
    .in('id', userIds)
    .in('role', ['admin', 'owner', 'manager']);

  if (profileError || !profiles || profiles.length === 0) {
    console.warn('[google-calendar] 管理者ユーザーが見つかりません');
    return;
  }

  // Calendar連携済みのユーザーにイベント作成
  const { data: tokens, error: tokenError } = await supabaseAdmin
    .from('google_calendar_tokens')
    .select('user_id')
    .in('user_id', profiles.map((p: { id: string }) => p.id));

  if (tokenError || !tokens || tokens.length === 0) {
    console.log('[google-calendar] Calendar連携済みのユーザーがいません（スキップ）');
    return;
  }

  // 各ユーザーのカレンダーにイベントを作成
  const gradeLabel = params.grade;
  const title = `【模試振替】${params.studentName}（${gradeLabel}）`;
  const description = [
    `生徒名: ${params.studentName}`,
    `学年: ${gradeLabel}`,
    `振替日: ${params.furikaeDateLabel}`,
    `時間: ${params.furikaeTime}`,
    params.periodTitle ? `模試: ${params.periodTitle}` : '',
  ].filter(Boolean).join('\n');

  // 小学生は約2時間、中学生は約3時間（デフォルト）
  const gradeNum = parseInt(params.grade) || 0;
  const durationMinutes = gradeNum <= 6 ? 120 : 180;

  for (const token of tokens) {
    try {
      const result = await createCalendarEvent(token.user_id, {
        summary: title,
        description,
        date: params.furikaeDate,
        startTime: params.furikaeTime,
        durationMinutes,
      });
      if (result.success) {
        console.log(`[google-calendar] イベント作成成功: user=${token.user_id}, event=${result.eventId}`);
      } else {
        console.warn(`[google-calendar] イベント作成失敗: user=${token.user_id}, error=${result.error}`);
      }
    } catch (e) {
      console.warn(`[google-calendar] イベント作成エラー: user=${token.user_id}`, e);
    }
  }
}
