/**
 * 公開 API: 面談予約確定
 *
 * POST /api/booking/[token]/confirm
 * body: { slotStart: string }  — ISO 8601 (JSTオフセット+09:00付き)
 *
 * 認証: 不要（service role で操作）
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createCalendarEvent } from '@/lib/google-calendar';
import {
  getInterviewAvailability,
  resolveBookingCalendarUserId,
  resolveBookingConfig,
} from '@/lib/server/booking';

export const dynamic = 'force-dynamic';

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase env not set');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

/**
 * ISO 文字列から JST 日付 'YYYY-MM-DD' を抽出する（UTC+9 固定）。
 */
function extractJstDate(iso: string): string {
  const d = new Date(iso);
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, '0');
  const day = String(jst.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * ISO 文字列から JST 時刻 'HH:mm' を抽出する（UTC+9 固定）。
 */
function extractJstTime(iso: string): string {
  const d = new Date(iso);
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const h = String(jst.getUTCHours()).padStart(2, '0');
  const m = String(jst.getUTCMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const serviceClient = getServiceClient();

  // リクエストボディ検証
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
  }

  const { slotStart } = body;
  if (typeof slotStart !== 'string' || !slotStart) {
    return NextResponse.json({ error: 'slotStart が必要です' }, { status: 400 });
  }

  // slotStart が正当な日付か確認
  const slotMs = new Date(slotStart).getTime();
  if (isNaN(slotMs)) {
    return NextResponse.json({ error: 'slotStart の形式が不正です' }, { status: 400 });
  }

  // ---- トークン再検証 ----
  const now = new Date().toISOString();
  const { data: tokenRow, error: tokenError } = await serviceClient
    .from('inquiry_booking_tokens')
    .select('id, inquiry_id, school_id, purpose, expires_at, used_at')
    .eq('token', token)
    .maybeSingle();

  if (tokenError || !tokenRow) {
    return NextResponse.json({ error: 'このリンクは無効です' }, { status: 410 });
  }
  if (tokenRow.used_at || tokenRow.expires_at < now) {
    return NextResponse.json({ error: 'このリンクは期限切れまたは使用済みです' }, { status: 410 });
  }

  // ---- inquiry 取得 ----
  const { data: inquiry, error: inquiryError } = await serviceClient
    .from('inquiries')
    .select('id, school_id, guardian_name, student_name, interview_at, interview_event_id')
    .eq('id', tokenRow.inquiry_id)
    .maybeSingle();

  if (inquiryError || !inquiry) {
    return NextResponse.json({ error: '問合せが見つかりません' }, { status: 400 });
  }

  // ---- 教室設定を取得 ----
  const { data: settingsRow } = await serviceClient
    .from('inquiry_school_settings')
    .select('booking_config')
    .eq('school_id', inquiry.school_id)
    .maybeSingle();

  const config = resolveBookingConfig(settingsRow?.booking_config ?? null);

  // ---- 空き再チェック ----
  const { slots } = await getInterviewAvailability(serviceClient, inquiry, settingsRow ?? null);
  const isAvailable = slots.some((s) => {
    // startIso を ms で比較（文字列表現の違い吸収）
    return new Date(s.startIso).getTime() === slotMs;
  });

  if (!isAvailable) {
    return NextResponse.json(
      { error: 'この枠は埋まりました。別の日時を選択してください。' },
      { status: 409 }
    );
  }

  // ---- inquiry.interview_at を更新 ----
  const { error: updateInquiryError } = await serviceClient
    .from('inquiries')
    .update({ interview_at: slotStart })
    .eq('id', inquiry.id);

  if (updateInquiryError) {
    console.error('[booking/confirm] inquiry 更新エラー:', updateInquiryError.message);
    return NextResponse.json({ error: '予約の保存に失敗しました' }, { status: 500 });
  }

  // ---- Google カレンダーにイベント作成 ----
  let eventId: string | null = null;
  const calUserId = await resolveBookingCalendarUserId(serviceClient, inquiry.school_id, config);

  if (calUserId) {
    const guardianName =
      (inquiry.guardian_name as string | null) ||
      (inquiry.student_name as string | null) ||
      'お客様';

    // 教室名取得
    const { data: school } = await serviceClient
      .from('schools')
      .select('name')
      .eq('id', inquiry.school_id)
      .maybeSingle();
    const schoolName = school?.name ?? '教室';

    const jstDate = extractJstDate(slotStart);
    const jstTime = extractJstTime(slotStart);

    const calResult = await createCalendarEvent(calUserId, {
      summary: `【面談】${guardianName}様（${schoolName}）`,
      description: `問合せ面談予約\n${guardianName}様`,
      date: jstDate,
      startTime: jstTime,
      durationMinutes: config.interview_duration_min,
      reminders: [{ method: 'popup', minutes: 60 }],
    });

    if (calResult.success && calResult.eventId) {
      eventId = calResult.eventId;
      // interview_event_id を保存
      await serviceClient
        .from('inquiries')
        .update({ interview_event_id: eventId })
        .eq('id', inquiry.id);
    } else {
      console.warn('[booking/confirm] カレンダーイベント作成失敗（無視します）:', calResult.error);
    }
  }

  // ---- token.used_at を記録 ----
  const { error: tokenUpdateError } = await serviceClient
    .from('inquiry_booking_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('id', tokenRow.id);

  if (tokenUpdateError) {
    // トークン更新失敗は致命的ではないがログに残す
    console.error('[booking/confirm] トークン used_at 更新エラー:', tokenUpdateError.message);
  }

  // ---- inquiry_contacts にコンタクト記録 ----
  const { error: contactError } = await serviceClient.from('inquiry_contacts').insert({
    school_id: inquiry.school_id,
    inquiry_id: inquiry.id,
    method: 'visit',
    direction: 'inbound',
    result: '面談予約',
    note: `セルフ予約: ${slotStart}`,
  });

  if (contactError) {
    // コンタクト記録失敗は予約自体を失敗扱いにしない
    console.warn('[booking/confirm] コンタクト記録エラー（無視します）:', contactError.message);
  }

  return NextResponse.json({ success: true, interview_at: slotStart });
}
