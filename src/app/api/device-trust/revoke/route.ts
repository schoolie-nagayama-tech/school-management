/**
 * POST /api/device-trust/revoke — 教室端末マークを失効させる。
 *
 * 正典: docs/teacher-home-mode-plan.md §2（紛失端末対策）
 *
 * body: { deviceId: string }
 * 教室長以上＋自教室スコープのみ。行は消さず revoked_at をセットする（履歴を残す）。
 *
 * ★ スコープ検証は「対象端末の school_id」で行う:
 *   deviceId だけを信じて更新すると、他教室の端末を失効させられる（IDOR）。
 *   先に台帳を引いて school_id を確かめてから更新する。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getApiAuth, isSchoolInScope, requireManager } from '@/lib/api-auth';
import { getTrustedDeviceServiceClient } from '@/lib/deviceTrust';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const authError = await requireManager(request);
  if (authError) return authError;

  const { auth } = await getApiAuth(request);
  if (!auth) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  let body: { deviceId?: unknown };
  try {
    body = (await request.json()) as { deviceId?: unknown };
  } catch {
    return NextResponse.json({ error: 'リクエストの形式が不正です' }, { status: 400 });
  }

  const deviceId = typeof body.deviceId === 'string' ? body.deviceId : '';
  if (!deviceId) {
    return NextResponse.json({ error: '対象の端末が指定されていません' }, { status: 400 });
  }

  try {
    const db = getTrustedDeviceServiceClient();
    const { data: device, error: lookupError } = await db
      .from('trusted_devices')
      .select('id, school_id')
      .eq('id', deviceId)
      .maybeSingle();

    if (lookupError) throw lookupError;
    if (!device) {
      return NextResponse.json({ error: '端末が見つかりません' }, { status: 404 });
    }
    if (!isSchoolInScope(device.school_id as string, auth.schoolIds)) {
      return NextResponse.json({ error: 'この端末を操作する権限がありません' }, { status: 403 });
    }

    const { error: updateError } = await db
      .from('trusted_devices')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', deviceId);

    if (updateError) throw updateError;

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[device-trust/revoke] 端末の失効に失敗しました:', e);
    return NextResponse.json({ error: '端末の失効に失敗しました' }, { status: 500 });
  }
}
