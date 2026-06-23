/**
 * 管理 API: 問合せの面談予約トークン発行・取消
 *
 * POST   /api/inquiries/[id]/booking-token — トークン発行（なければ新規、あれば既存を返す）
 * DELETE /api/inquiries/[id]/booking-token — トークン取消＋カレンダーイベント取消
 *
 * 認証: 教室長以上（requireManager）
 * 権限: service role で操作
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireManager } from '@/lib/api-auth';
import {
  generateBookingToken,
  resolveBookingCalendarUserId,
  resolveBookingConfig,
} from '@/lib/server/booking';
import { deleteCalendarEvent } from '@/lib/google-calendar';

export const dynamic = 'force-dynamic';

/** service role クライアントを生成する */
function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase env not set');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

// ============================================================
// POST: トークン発行
// ============================================================

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // 管理者認証
  const authError = await requireManager(request);
  if (authError) return authError;

  const { id: inquiryId } = await params;
  const serviceClient = getServiceClient();

  // inquiry を取得して school_id を確認
  const { data: inquiry, error: inquiryError } = await serviceClient
    .from('inquiries')
    .select('id, school_id')
    .eq('id', inquiryId)
    .maybeSingle();

  if (inquiryError || !inquiry) {
    return NextResponse.json({ error: '問合せが見つかりません' }, { status: 404 });
  }

  // 既存の有効な interview トークン（未使用・未期限切れ）を返す
  const now = new Date().toISOString();
  const { data: existing, error: existingError } = await serviceClient
    .from('inquiry_booking_tokens')
    .select('id, token')
    .eq('inquiry_id', inquiryId)
    .eq('purpose', 'interview')
    .is('used_at', null)
    .gt('expires_at', now)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingError) {
    console.error('[booking-token] 既存トークン確認エラー:', existingError.message);
    return NextResponse.json({ error: 'トークン確認に失敗しました' }, { status: 500 });
  }

  if (existing) {
    // 有効な既存トークンを返す
    const origin = request.nextUrl.origin;
    return NextResponse.json({
      token: existing.token,
      url: `${origin}/booking/${existing.token}`,
    });
  }

  // 新規トークンを発行
  const token = generateBookingToken();
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

  const { error: insertError } = await serviceClient.from('inquiry_booking_tokens').insert({
    token,
    inquiry_id: inquiryId,
    school_id: inquiry.school_id,
    purpose: 'interview',
    expires_at: expiresAt,
  });

  if (insertError) {
    console.error('[booking-token] トークン作成エラー:', insertError.message);
    return NextResponse.json({ error: 'トークンの作成に失敗しました' }, { status: 500 });
  }

  const origin = request.nextUrl.origin;
  return NextResponse.json({
    token,
    url: `${origin}/booking/${token}`,
  });
}

// ============================================================
// DELETE: トークン取消＋カレンダーイベント取消
// ============================================================

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // 管理者認証
  const authError = await requireManager(request);
  if (authError) return authError;

  const { id: inquiryId } = await params;
  const serviceClient = getServiceClient();

  // inquiry を取得（interview_at, interview_event_id, school_id を確認）
  const { data: inquiry, error: inquiryError } = await serviceClient
    .from('inquiries')
    .select('id, school_id, interview_at, interview_event_id')
    .eq('id', inquiryId)
    .maybeSingle();

  if (inquiryError || !inquiry) {
    return NextResponse.json({ error: '問合せが見つかりません' }, { status: 404 });
  }

  // inquiry の interview トークンをすべて削除（used_at に関わらず無効化）
  const { error: deleteTokenError } = await serviceClient
    .from('inquiry_booking_tokens')
    .delete()
    .eq('inquiry_id', inquiryId)
    .eq('purpose', 'interview');

  if (deleteTokenError) {
    console.error('[booking-token] トークン削除エラー:', deleteTokenError.message);
    return NextResponse.json({ error: 'トークン削除に失敗しました' }, { status: 500 });
  }

  // カレンダーイベントを削除する
  if (inquiry.interview_at && inquiry.interview_event_id) {
    try {
      // 設定を取得して calendar user_id を解決
      const { data: settings } = await serviceClient
        .from('inquiry_school_settings')
        .select('booking_config')
        .eq('school_id', inquiry.school_id)
        .maybeSingle();

      const config = resolveBookingConfig(settings?.booking_config ?? null);
      const calUserId = await resolveBookingCalendarUserId(
        serviceClient,
        inquiry.school_id,
        config
      );

      if (calUserId) {
        await deleteCalendarEvent(calUserId, inquiry.interview_event_id);
      }
    } catch (e) {
      // カレンダー操作の失敗はDBの取消を妨げない
      console.warn('[booking-token] カレンダーイベント削除に失敗（無視します）:', e);
    }

    // inquiry の面談情報をクリア
    const { error: updateError } = await serviceClient
      .from('inquiries')
      .update({ interview_at: null, interview_event_id: null })
      .eq('id', inquiryId);

    if (updateError) {
      console.error('[booking-token] inquiry 更新エラー:', updateError.message);
      return NextResponse.json({ error: '予約情報のクリアに失敗しました' }, { status: 500 });
    }
  }

  return NextResponse.json({ success: true });
}
