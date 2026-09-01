/**
 * Sentry へ送る前にノイズを除外するための共通フィルタ。
 *
 * Next.js の redirect()/notFound() は内部的に「特別なエラー」を throw して
 * ルーティング制御に使う仕組みで、アプリのバグではない。フィルタしないと
 * redirect() が呼ばれるたびに Sentry に「エラー」として記録され、本物のエラーが
 * ノイズに埋もれる。digest の接頭辞で判定する（Next.js 自身の実装がこの形式で
 * 判定しているのに合わせている）。
 */
export function isNextControlFlowError(digest: unknown): boolean {
  if (typeof digest !== 'string') return false;
  return digest.startsWith('NEXT_REDIRECT') || digest === 'NEXT_NOT_FOUND';
}

/**
 * fetch の AbortError（コンポーネントアンマウント時のリクエスト中断等）かどうか。
 * src/components/AbortErrorSilencer.tsx が同じ関数でブラウザの error/unhandledrejection を
 * 握り潰しているのに合わせ、Sentry 側でもノイズとして除外する。
 */
/**
 * リクエストボディの JSON パース失敗かどうか（＝サーバーのバグではなく、クライアント/攻撃者由来）。
 *
 * `await request.json()` は壊れた body に対して SyntaxError を投げる。これを Sentry に送ると:
 *   - サーバーのバグではないのに「エラー」として記録され、本物のエラーが埋もれる
 *   - `/api/mypage/*` `/api/webhooks/*` など**公開エンドポイント**に集中しているため、
 *     攻撃者が壊れた body を投げ続けるだけで Sentry のイベント枠を無限に消費できてしまう
 *     （＝本物のエラーが枠切れで捨てられる。可観測性を上げるつもりが下げる本末転倒）
 * ルート側は 400 を返しており利用者への応答は成立しているので、送らないのが正しい。
 *
 * トレードオフ: サーバー側で自前のデータを JSON.parse していて壊れていた場合も同様に
 * 握り潰される。ただしこのアプリで JSON.parse するのはリクエストボディが大半で、
 * 実害より攻撃時のクォータ枯渇の方が重いと判断した。
 * 送りたくなったら captureApiError の呼び出し側で明示的に Sentry.captureException すること。
 */
export function isRequestBodyParseError(error: unknown): boolean {
  if (!(error instanceof SyntaxError)) return false;
  const message = error.message;
  // V8 / undici が投げる JSON パース失敗のメッセージ形。実装差があるので広めに見る。
  return (
    message.includes('JSON') ||
    message.includes('Unexpected token') ||
    message.includes('Unexpected end of')
  );
}

export function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { name?: unknown; message?: unknown };
  const message = typeof e.message === 'string' ? e.message : '';
  return (
    e.name === 'AbortError' || message.includes('aborted') || message.includes('signal is aborted')
  );
}
