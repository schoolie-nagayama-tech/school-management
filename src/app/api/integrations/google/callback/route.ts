import { NextRequest, NextResponse } from 'next/server';
import { handleGoogleCallback } from '@/lib/google-calendar';
import {
  clearGoogleOauthState,
  readGoogleOauthState,
  verifyGoogleOauthState,
} from '@/lib/googleOauthState';

export const dynamic = 'force-dynamic';

/**
 * Google OAuth コールバック
 * Googleから認証コードを受け取り、トークンを保存してリダイレクト
 *
 * ★ このルートには通常のログイン認証が無い（Googleからのトップレベル遷移のため）。
 *   代わりに authorize 時に発行した state cookie が唯一の身元証明になる。
 *   state を検証せずクエリの userId を信じていた頃は、攻撃者が自分の認可コードと
 *   被害者の userId を並べて叩くだけで、被害者のカレンダー連携先を自分に
 *   すり替えられた（＝生徒名・日程が攻撃者のカレンダーに流れ続ける）。
 *   詳細と設計意図は lib/googleOauthState.ts。
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const stateParam = searchParams.get('state');
  const error = searchParams.get('error');

  // リクエスト元のoriginを使用（複数ドメイン対応）
  const origin = request.nextUrl.origin;
  const baseUrl = origin || process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

  // ユーザーが同意画面でキャンセルした場合など。state cookie は用済みなので破棄する。
  if (error) {
    console.error('[google-callback] OAuth error:', error);
    return clearGoogleOauthState(
      NextResponse.redirect(
        `${baseUrl}/settings/account?calendar_error=${encodeURIComponent('Google認証がキャンセルされました')}`
      )
    );
  }

  // ── state 検証（CSRF対策）──
  // cookie が無い / 壊れている / 値が一致しない / 期限切れは、すべて拒否する。
  // ここは画面に戻さず 403 で落とす（正常な往復では起きえない＝攻撃かタイムアウト）。
  const saved = readGoogleOauthState(request);
  if (!saved || !verifyGoogleOauthState(saved, stateParam)) {
    console.error(
      JSON.stringify({
        type: 'OAUTH_STATE_MISMATCH',
        path: request.nextUrl.pathname,
        ip: request.headers.get('x-forwarded-for'),
        timestamp: new Date().toISOString(),
      })
    );
    return clearGoogleOauthState(
      NextResponse.json(
        {
          error:
            '不正なリクエストです。時間が経ちすぎた可能性があります。設定画面からもう一度連携してください。',
        },
        { status: 403 }
      )
    );
  }

  if (!code) {
    return clearGoogleOauthState(
      NextResponse.redirect(
        `${baseUrl}/settings/account?calendar_error=${encodeURIComponent('無効なリクエストです')}`
      )
    );
  }

  try {
    // 紐づけ先はクエリではなく cookie 側の userId（authorize でサーバーが認証した値）。
    const result = await handleGoogleCallback(code, saved.userId, origin);
    return clearGoogleOauthState(
      NextResponse.redirect(
        `${baseUrl}/settings/account?calendar_connected=true&calendar_email=${encodeURIComponent(result.email || '')}`
      )
    );
  } catch (e) {
    console.error('[google-callback] Token exchange failed:', e);
    const message = e instanceof Error ? e.message : 'トークンの取得に失敗しました';
    return clearGoogleOauthState(
      NextResponse.redirect(
        `${baseUrl}/settings/account?calendar_error=${encodeURIComponent(message)}`
      )
    );
  }
}
