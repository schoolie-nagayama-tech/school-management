import { NextResponse } from 'next/server';
import { clearPortalSession } from '@/lib/mypage/session';

export const dynamic = 'force-dynamic';

/**
 * 保護者ポータル ログアウト。portal_session cookie を削除するだけ。
 */
export async function POST() {
  await clearPortalSession();
  return NextResponse.json({ ok: true });
}
