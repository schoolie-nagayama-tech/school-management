/**
 * GET /api/device-trust/status — この端末が教室端末として登録済みかを返す。
 *
 * 正典: docs/teacher-home-mode-plan.md §2
 *
 * 認証必須（ログイン済みなら誰でも呼べる）。返すのは boolean だけで、
 * どの教室のどのラベルの端末かは伏せる（クッキーの中身も端末の素性も漏らさない）。
 *
 * ★ なりすまし（代理ログイン）中の扱い:
 *   照合に使うのは「今このブラウザが持っているクッキー」なので、なりすまし対象の
 *   講師ではなく実端末が判定される。管理者が自宅から講師になりすませば家モードの
 *   見え方を再現でき、教室PCからなりすませば教室モードになる（意図どおり）。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getApiAuth } from '@/lib/api-auth';
import { lookupTrustedDevice, touchTrustedDeviceLastSeen } from '@/lib/deviceTrust';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { auth } = await getApiAuth(request);
  if (!auth) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const device = await lookupTrustedDevice(request);
  if (device) {
    // 棚卸し用の最終利用時刻。1日1回程度に間引く（関数側で判定）
    await touchTrustedDeviceLastSeen(device);
  }

  return NextResponse.json({ trusted: device !== null });
}
