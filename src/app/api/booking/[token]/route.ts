/**
 * 公開 API: 予約トークン検証 + 面談空き枠取得
 *
 * GET /api/booking/[token]
 *
 * 認証: 不要（service role で操作）
 * PII: 氏名・教室名のみ返す（電話・メールは返さない）
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getInterviewAvailability } from '@/lib/server/booking';

export const dynamic = 'force-dynamic';

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase env not set');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const serviceClient = getServiceClient();

  // トークン検証（無効・期限切れ・使用済みは valid:false で返す）
  const now = new Date().toISOString();
  const { data: tokenRow, error: tokenError } = await serviceClient
    .from('inquiry_booking_tokens')
    .select('id, inquiry_id, school_id, purpose, expires_at, used_at')
    .eq('token', token)
    .maybeSingle();

  if (tokenError) {
    console.error('[booking/GET] トークン取得エラー:', tokenError.message);
    return NextResponse.json({ valid: false, reason: 'server_error' }, { status: 200 });
  }

  if (!tokenRow) {
    return NextResponse.json({ valid: false, reason: 'not_found' }, { status: 200 });
  }

  if (tokenRow.used_at) {
    return NextResponse.json({ valid: false, reason: 'used' }, { status: 200 });
  }

  if (tokenRow.expires_at < now) {
    return NextResponse.json({ valid: false, reason: 'expired' }, { status: 200 });
  }

  // inquiry を取得
  const { data: inquiry, error: inquiryError } = await serviceClient
    .from('inquiries')
    .select('id, school_id, guardian_name, student_name, interview_at, interview_event_id')
    .eq('id', tokenRow.inquiry_id)
    .maybeSingle();

  if (inquiryError || !inquiry) {
    return NextResponse.json({ valid: false, reason: 'not_found' }, { status: 200 });
  }

  // 教室設定を取得
  const { data: settings } = await serviceClient
    .from('inquiry_school_settings')
    .select('booking_config')
    .eq('school_id', inquiry.school_id)
    .maybeSingle();

  // 教室名を取得（PII 最小限: 氏名と教室名のみ）
  const { data: school } = await serviceClient
    .from('schools')
    .select('name')
    .eq('id', inquiry.school_id)
    .maybeSingle();

  const schoolName = school?.name ?? '';
  const guardianName =
    (inquiry.guardian_name as string | null) || (inquiry.student_name as string | null) || 'お客様';

  // 空き枠を算出
  const { slots, calendarConnected } = await getInterviewAvailability(
    serviceClient,
    inquiry,
    settings ?? null
  );

  return NextResponse.json({
    valid: true,
    schoolName,
    guardianName,
    purpose: tokenRow.purpose,
    slots,
    calendarConnected,
  });
}
