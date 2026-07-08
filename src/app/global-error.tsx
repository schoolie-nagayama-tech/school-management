'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';
import './globals.css';

/**
 * ルートレイアウト自体がクラッシュした場合の最終防衛ライン。
 *
 * 通常の error.tsx はルートレイアウトの外側（下位のツリー）のエラーしか
 * 捕捉できないため、layout.tsx 自体の描画エラーはここでしか拾えない。
 * このファイルが呼ばれるのは相当まれ（発生時はレイアウト自体を疑うべき）。
 */
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="ja">
      <body>
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
          <h1 className="text-lg font-semibold text-gray-900">予期しないエラーが発生しました</h1>
          <p className="text-sm text-gray-600">
            お手数ですが、ページを再読み込みしてください。改善しない場合は管理者にお問い合わせください。
          </p>
        </div>
      </body>
    </html>
  );
}
