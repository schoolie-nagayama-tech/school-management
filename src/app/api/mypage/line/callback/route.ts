import { NextRequest, NextResponse } from 'next/server';
import { getPortalServiceClient } from '@/lib/mypage/serviceClient';
import { getPortalContext } from '@/lib/mypage/supabase';
import { signPortalJwt } from '@/lib/mypage/jwt';
import { setPortalSessionOnResponse } from '@/lib/mypage/session';
import { buildRedirectUri, exchangeCodeForIdToken, verifyIdToken } from '@/lib/mypage/line';
import { clearLineOauthState, readLineOauthState } from '@/lib/mypage/lineOauthState';
import { captureApiError } from '@/lib/api-error';

export const dynamic = 'force-dynamic';

/**
 * LINEログインのコールバック（GET）。
 *
 * 流れ:
 *   state検証 → code をトークンに交換 → id_token 検証 → アカウント解決 → セッション発行
 *
 * アカウント解決の4分岐:
 *   (1) ログイン済み＋そのLINEが未使用      → 既存アカウントに line_user_id を後付け紐づけ
 *   (2) ログイン済み＋そのLINEが他人のもの  → 競合エラー（乗っ取り防止）
 *   (3) 未ログイン＋既知のLINE              → そのアカウントでログイン
 *   (4) 未ログイン＋未知のLINE              → 招待が有効なときだけアカウント新規作成
 *
 * ★ (4) で招待を必須にする理由:
 *   招待なしでアカウントを作れると、誰でもログインだけはできる「紐づけゼロの孤児
 *   アカウント」が無限に増える。招待＝教室が発行した本人確認の代替なので、
 *   ここを入口の関門にする。生徒の紐づけ自体は、このあと戻る招待ページで
 *   続柄を選んで既存の /api/mypage/invite/accept（ログイン済みモード）が行う。
 */

/** ログイン画面に返すエラーコード。画面側で日本語メッセージに変換する。 */
type LineErrorCode =
  | 'state_mismatch'
  | 'exchange_failed'
  | 'no_invite'
  | 'invite_invalid'
  | 'already_linked'
  | 'server_error';

/** エラー時の共通リダイレクト（state cookie も必ず破棄する）。 */
function fail(request: NextRequest, code: LineErrorCode): NextResponse {
  const url = new URL('/mypage/login', request.url);
  url.searchParams.set('line_error', code);
  return clearLineOauthState(NextResponse.redirect(url));
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  // ユーザーが同意画面でキャンセルした場合など。素直にログイン画面へ戻す。
  if (params.get('error')) {
    return clearLineOauthState(NextResponse.redirect(new URL('/mypage/login', request.url)));
  }

  const code = params.get('code');
  const stateParam = params.get('state');
  const saved = readLineOauthState(request);

  // ── state 検証（CSRF対策）──
  // cookie が無い/壊れている、または値が一致しないものはすべて拒否する。
  if (!code || !stateParam || !saved || saved.state !== stateParam) {
    return fail(request, 'state_mismatch');
  }

  // ── code → id_token → プロフィール ──
  let profile;
  try {
    const idToken = await exchangeCodeForIdToken({
      code,
      redirectUri: buildRedirectUri(request.url),
    });
    profile = await verifyIdToken({ idToken, nonce: saved.nonce });
  } catch (e) {
    captureApiError(e, {
      route: 'GET /api/mypage/line/callback',
    });
    console.error('[mypage/line/callback] LINE認証に失敗:', e);
    return fail(request, 'exchange_failed');
  }

  const supabase = getPortalServiceClient();

  try {
    // 同じ LINE ユーザーの既存アカウントを引く（line_user_id は unique）。
    const { data: linked, error: findErr } = await supabase
      .from('portal_accounts')
      .select('id, display_name')
      .eq('line_user_id', profile.userId)
      .maybeSingle();

    if (findErr) {
      console.error('[mypage/line/callback] アカウント検索に失敗:', findErr.message);
      return fail(request, 'server_error');
    }

    // 既存のポータルセッション（ID/PWでログイン中など）があるか。
    const ctx = await getPortalContext();

    // ── (1)(2) ログイン済み: 後付け紐づけ ──
    if (ctx) {
      const currentAccountId = ctx.claims.sub;

      if (linked && linked.id !== currentAccountId) {
        // このLINEアカウントは別のポータルアカウントのもの。奪わない。
        return fail(request, 'already_linked');
      }

      if (!linked) {
        const { error: linkErr } = await supabase
          .from('portal_accounts')
          .update({ line_user_id: profile.userId, avatar_url: profile.pictureUrl ?? null })
          .eq('id', currentAccountId);
        if (linkErr) {
          // unique 制約違反（23505）は同時実行で他アカウントに取られたケース。
          if (linkErr.code === '23505') return fail(request, 'already_linked');
          console.error('[mypage/line/callback] LINE連携の保存に失敗:', linkErr.message);
          return fail(request, 'server_error');
        }
      }

      // 既にログイン済みなのでセッションはそのまま。招待があればその続きへ。
      return clearLineOauthState(NextResponse.redirect(destinationUrl(request, saved.invite)));
    }

    // ── (3) 未ログイン＋既知のLINE: ログイン ──
    if (linked) {
      // 表示名は上書きしない（教室が入力した名前を LINE 名で潰さないため）。
      // アバターは LINE 由来の装飾情報なので最新に追従させる。
      await supabase
        .from('portal_accounts')
        .update({
          last_login_at: new Date().toISOString(),
          avatar_url: profile.pictureUrl ?? null,
        })
        .eq('id', linked.id);

      return await grantSession(request, linked.id, saved.invite);
    }

    // ── (4) 未ログイン＋未知のLINE: 招待が有効なときだけ新規作成 ──
    if (!saved.invite) {
      return fail(request, 'no_invite');
    }

    // 孤児アカウントを作らないよう、作成前に招待の有効性を確かめる。
    const { data: invitation, error: invErr } = await supabase
      .from('portal_invitations')
      .select('id, expires_at, accepted_at')
      .eq('token', saved.invite)
      .maybeSingle();

    if (invErr) {
      console.error('[mypage/line/callback] 招待の確認に失敗:', invErr.message);
      return fail(request, 'server_error');
    }
    if (!invitation || invitation.accepted_at || new Date(invitation.expires_at) < new Date()) {
      return fail(request, 'invite_invalid');
    }

    const { data: created, error: createErr } = await supabase
      .from('portal_accounts')
      .insert({
        line_user_id: profile.userId,
        display_name: profile.displayName,
        avatar_url: profile.pictureUrl ?? null,
        last_login_at: new Date().toISOString(),
        // login_id / password_hash は持たない（LINEのみのアカウント）。
      })
      .select('id')
      .single();

    if (createErr) {
      // 同時実行で先に作られた場合（23505）は競合として扱う。
      if (createErr.code === '23505') return fail(request, 'already_linked');
      console.error('[mypage/line/callback] アカウント作成に失敗:', createErr.message);
      return fail(request, 'server_error');
    }

    return await grantSession(request, created.id, saved.invite);
  } catch (e) {
    captureApiError(e, {
      route: 'GET /api/mypage/line/callback',
    });
    console.error('[mypage/line/callback] 予期しないエラー:', e);
    return fail(request, 'server_error');
  }
}

/**
 * ログイン後の遷移先。
 * 招待経由なら招待ページへ戻す（ログイン済みモードで続柄を選んで紐づけを完了させる）。
 */
function destinationUrl(request: NextRequest, invite?: string): URL {
  return new URL(invite ? `/mypage/invite/${encodeURIComponent(invite)}` : '/mypage', request.url);
}

/** JWTを署名してセッション cookie に載せ、遷移先へリダイレクトする。 */
async function grantSession(
  request: NextRequest,
  accountId: string,
  invite?: string
): Promise<NextResponse> {
  const jwt = await signPortalJwt(accountId);
  const response = NextResponse.redirect(destinationUrl(request, invite));
  return clearLineOauthState(setPortalSessionOnResponse(response, jwt));
}
