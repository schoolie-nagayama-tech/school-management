'use client';

import { useEffect } from 'react';
import { isAbortError } from '@/lib/utils/sentryFilters';

/**
 * fetch の AbortError をブラウザのグローバルエラーから握り潰すだけのラッパー。
 *
 * ★これは React のエラーバウンダリではない。
 *   以前は `ErrorBoundary` という名前だったが、中身は window の error /
 *   unhandledrejection を拾うだけで、`componentDidCatch` も
 *   `getDerivedStateFromError` も実装していない＝レンダリング中の例外は一切捕捉しない。
 *   名前のせいで「エラー境界は既にある」と誤解され、実際 170 ページに対して
 *   error.tsx が1枚しか無い状態が続いていた。実態に合わせて改名した。
 *
 *   レンダリング例外を受けるのは app ディレクトリの error.tsx 群:
 *     src/app/error.tsx          … 管理・講師画面の全ページ
 *     src/app/mypage/error.tsx   … 保護者ポータル
 *     src/app/portal/error.tsx   … 公開フォーム
 *     src/app/global-error.tsx   … ルートレイアウト自体のクラッシュ
 *
 * 何をしているか: コンポーネントのアンマウント時などに中断された fetch は
 * AbortError を投げるが、これはアプリのバグではない。放置するとブラウザのコンソールと
 * Sentry がノイズで埋まるので、ここで preventDefault して黙らせる。
 * 判定は Sentry 側の beforeSend と同じ `isAbortError` を使う（条件が二重管理にならないように）。
 */
export function AbortErrorSilencer({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      if (isAbortError(event.reason)) event.preventDefault();
    };

    const handleError = (event: ErrorEvent) => {
      if (isAbortError(event.error)) event.preventDefault();
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
