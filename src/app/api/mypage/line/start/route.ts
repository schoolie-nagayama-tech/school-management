import { NextRequest, NextResponse } from 'next/server';
import {
  buildAuthorizeUrl,
  buildRedirectUri,
  generateRandomToken,
  isLineLoginConfigured,
} from '@/lib/mypage/line';
import { setLineOauthState } from '@/lib/mypage/lineOauthState';
import { captureApiError } from '@/lib/api-error';

export const dynamic = 'force-dynamic';

/**
 * LINEログインの開始（GET）。ユーザーをLINEの認可画面へリダイレクトする。
 *
 * クエリ:
 *   invite  … 招待URL起点のとき、その招待トークン。コールバック後に
 *             /mypage/invite/<token> へ戻して紐づけを完了させる。
 *
 * GET なのは、画面側でただのリンク（<a>）として置けるようにするため。
 * 副作用は state cookie の発行のみで、この時点ではアカウントを作らない。
 */
export async function GET(request: NextRequest) {
  if (!isLineLoginConfigured()) {
    // 未設定環境（ローカルで LINE を使わない場合など）では機能自体を存在させない。
    return NextResponse.json({ error: 'LINEログインは利用できません' }, { status: 404 });
  }

  const invite = request.nextUrl.searchParams.get('invite') ?? undefined;

  // CSRF対策の state と、リプレイ対策の nonce をこの往復専用に発行する。
  const state = generateRandomToken();
  const nonce = generateRandomToken();

  let authorizeUrl: string;
  try {
    authorizeUrl = buildAuthorizeUrl({
      redirectUri: buildRedirectUri(request.url),
      state,
      nonce,
    });
  } catch (e) {
    captureApiError(e, {
      route: 'GET /api/mypage/line/start',
    });
    console.error('[mypage/line/start] 認可URLの組み立てに失敗:', e);
    return NextResponse.json({ error: 'LINEログインの開始に失敗しました' }, { status: 500 });
  }

  const response = NextResponse.redirect(authorizeUrl);
  return setLineOauthState(response, { state, nonce, invite });
}
