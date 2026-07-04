/**
 * ブラウザ完全終了検知（「タブを閉じる」ではなく「ブラウザ自体を閉じる」でログアウトさせるための仕組み）。
 *
 * 背景: Supabase の認証情報（sb-auth-token）は @supabase/ssr が永続 cookie として保存するため、
 * タブやウィンドウを閉じてもセッションは残り続ける（自動リフレッシュも効くため実質無期限に近い）。
 * 共有端末でブラウザを閉じた後も次回開いたときにログイン状態が残るのは望ましくないため、
 * 「ブラウザセッション限定cookie（Session Cookie）」をマーカーとして併用し、これが消えていたら
 * （＝前回ブラウザを完全に閉じた）認証 cookie が残っていても明示的にサインアウトする。
 *
 * 仕組み:
 * - マーカー cookie `app_browser_session` を Max-Age/Expires 無しで発行する。
 *   Session Cookie はブラウザプロセスが完全終了すると消える（タブ間では共有されるので
 *   1タブだけ閉じても消えない）。
 * - アプリ起動時（AuthContext 初期化時）に「マーカーが無い」かつ「Supabaseセッションがある」
 *   状態を検知したら、ブラウザを閉じて再度開いた＝前回セッションの残骸とみなしサインアウトする。
 * - 判定後（signOutの要否に関わらず）マーカーを必ず立て直す。
 *
 * 注意: SSR（サーバー描画）側はこの判定をしない。初回描画が一瞬ログイン済みに見えても、
 * クライアントの本判定で即 signOut → /login 遷移するため実害は無い（既存の許容方針と同じ）。
 */

const MARKER_COOKIE_NAME = 'app_browser_session';

// document.cookie から指定名の値を読む素朴なパーサー。
function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const target = `${name}=`;
  const cookies = document.cookie ? document.cookie.split('; ') : [];
  for (const cookie of cookies) {
    if (cookie.startsWith(target)) {
      return decodeURIComponent(cookie.slice(target.length));
    }
  }
  return null;
}

/** マーカー cookie が存在するかどうか。 */
export function hasBrowserSessionMarker(): boolean {
  return readCookie(MARKER_COOKIE_NAME) !== null;
}

/**
 * マーカー cookie を発行する。Max-Age/Expires を指定しない = セッション cookie。
 * ブラウザプロセスを完全に終了すると消える。
 */
export function setBrowserSessionMarker(): void {
  if (typeof document === 'undefined') return;
  // path=/ で全ページから見える範囲に。SameSite=Lax で通常のナビゲーションには送信される。
  document.cookie = `${MARKER_COOKIE_NAME}=1; path=/; SameSite=Lax`;
}

/**
 * 「ブラウザを完全に閉じた後の再訪問」かどうかを判定する。
 * マーカーが無い（＝前回ブラウザ終了時に消えた）のに Supabase セッションだけが残っている状態がこれ。
 */
export function isStaleSessionAfterBrowserClose(): boolean {
  return !hasBrowserSessionMarker();
}
