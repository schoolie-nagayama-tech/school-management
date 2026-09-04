'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle, RotateCw, Home } from 'lucide-react';
import * as Sentry from '@sentry/nextjs';

/**
 * 管理画面・講師画面の共通エラー境界。
 *
 * ★このアプリにはルートグループが無く layout も3枚（root / mypage / portal）しかないため、
 *   ここ1枚で /mypage と /portal を除く全ページ（約168ページ）を覆える。
 *   これを置くまでは error.tsx が /portal の1枚だけで、生徒管理・スケジュール・講習・請求
 *   といった主要機能でレンダリング中に例外が出ると、Next.js の素の「Application error」が
 *   出るだけで案内もリトライ導線も無く、Sentry にも残らなかった。
 *
 * global-error.tsx との違い: あちらはルートレイアウト自体がクラッシュしたときの最終防衛線で、
 * 通常のページ内例外はこちらが受ける。
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-danger-subtle">
            <AlertTriangle className="h-5 w-5 text-danger" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-bold leading-snug text-text-heading">
              画面の表示中に問題が発生しました
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-text-muted">
              一時的な不具合の可能性があります。まず再読み込みをお試しください。
              繰り返し発生する場合は、下の番号を添えて管理者にお知らせください。
            </p>
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={reset}
            className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3 text-sm font-semibold text-text-on-primary transition-colors hover:bg-primary-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            <RotateCw className="h-4 w-4" aria-hidden="true" />
            再読み込み
          </button>
          <Link
            href="/"
            className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-lg border border-border px-5 py-3 text-sm font-medium text-text-body transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            <Home className="h-4 w-4" aria-hidden="true" />
            ホームへ戻る
          </Link>
        </div>

        {/* digest は Next.js が生成する不透明なハッシュ。内部構造を漏らさずに
            「どのエラーか」を Sentry 側と突き合わせられるので、問い合わせ用に出す。 */}
        {error.digest && (
          <p className="mt-5 text-center text-xs text-text-faint">
            エラー番号: <span className="font-mono">{error.digest}</span>
          </p>
        )}
      </div>
    </div>
  );
}
