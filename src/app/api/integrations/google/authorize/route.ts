import { NextRequest, NextResponse } from 'next/server';
import { getApiAuth } from '@/lib/api-auth';
import { getGoogleAuthUrl } from '@/lib/google-calendar';

export const dynamic = 'force-dynamic';

/**
 * Google Calendar OAuth 認証開始
 * → Googleの認証画面にリダイレクト
 */
export async function GET(request: NextRequest) {
  const { auth } = await getApiAuth(request);
  if (!auth) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  // manager以上のみ
  const roleLower = auth.role.toLowerCase();
  if (!['admin', 'owner', 'manager'].includes(roleLower)) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }

  const authUrl = getGoogleAuthUrl(auth.userId);
  return NextResponse.redirect(authUrl);
}
