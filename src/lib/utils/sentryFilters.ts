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
 * src/components/ErrorBoundary.tsx が同じ条件でブラウザの error/unhandledrejection を
 * 握り潰しているのに合わせ、Sentry 側でもノイズとして除外する。
 */
export function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { name?: unknown; message?: unknown };
  const message = typeof e.message === 'string' ? e.message : '';
  return (
    e.name === 'AbortError' || message.includes('aborted') || message.includes('signal is aborted')
  );
}
