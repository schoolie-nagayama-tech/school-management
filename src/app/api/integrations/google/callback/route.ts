import { NextRequest, NextResponse } from 'next/server';
import { handleGoogleCallback } from '@/lib/google-calendar';

export const dynamic = 'force-dynamic';

/**
 * Google OAuth コールバック
 * Googleから認証コードを受け取り、トークンを保存してリダイレクト
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state'); // userId
  const error = searchParams.get('error');

  // リクエスト元のoriginを使用（複数ドメイン対応）
  const origin = request.nextUrl.origin;
  const baseUrl = origin || process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

  if (error) {
    console.error('[google-callback] OAuth error:', error);
    return NextResponse.redirect(
      `${baseUrl}/settings/account?calendar_error=${encodeURIComponent('Google認証がキャンセルされました')}`
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(
      `${baseUrl}/settings/account?calendar_error=${encodeURIComponent('無効なリクエストです')}`
    );
  }

  try {
    const result = await handleGoogleCallback(code, state, origin);
    return NextResponse.redirect(
      `${baseUrl}/settings/account?calendar_connected=true&calendar_email=${encodeURIComponent(result.email || '')}`
    );
  } catch (e) {
    console.error('[google-callback] Token exchange failed:', e);
    const message = e instanceof Error ? e.message : 'トークンの取得に失敗しました';
    return NextResponse.redirect(
      `${baseUrl}/settings/account?calendar_error=${encodeURIComponent(message)}`
    );
  }
}
