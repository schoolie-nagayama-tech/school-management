'use client';

import { useEffect } from 'react';

/**
 * グローバルエラーハンドラー
 * AbortErrorなどの予期しないエラーをキャッチして無視
 */
export function ErrorBoundary({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // 未処理のPromise拒否をキャッチ
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const error = event.reason;

      // AbortErrorは無視
      if (
        error?.name === 'AbortError' ||
        error?.message?.includes('aborted') ||
        error?.message?.includes('signal is aborted')
      ) {
        event.preventDefault();
        return;
      }
    };

    // 未処理のエラーをキャッチ
    const handleError = (event: ErrorEvent) => {
      const error = event.error;

      // AbortErrorは無視
      if (
        error?.name === 'AbortError' ||
        error?.message?.includes('aborted') ||
        error?.message?.includes('signal is aborted')
      ) {
        event.preventDefault();
        return;
      }
    };

    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    window.addEventListener('error', handleError);

    return () => {
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
      window.removeEventListener('error', handleError);
    };
  }, []);

  return <>{children}</>;
}
