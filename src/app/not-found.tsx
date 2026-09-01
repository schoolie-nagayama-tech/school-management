import Link from 'next/link';
import { FileQuestion, Home } from 'lucide-react';

/**
 * 404 ページ。
 *
 * これを置くまでは not-found.tsx が1枚も無く、存在しないURLを開くと Next.js の
 * 素の英語の 404 が出ていた。URL の打ち間違いや、削除された機能へのブックマークで
 * 普通に踏むので、日本語で導線を出す。
 *
 * Server Component のままでよい（状態もイベントも持たない）。
 */
export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-surface-hover">
          <FileQuestion className="h-6 w-6 text-text-muted" aria-hidden="true" />
        </div>
        <h1 className="mt-4 text-lg font-bold text-text-heading">ページが見つかりません</h1>
        <p className="mt-2 text-sm leading-relaxed text-text-muted">
          URLが変更されたか、削除された可能性があります。
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-text-on-primary transition-colors hover:bg-primary-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          <Home className="h-4 w-4" aria-hidden="true" />
          ホームへ戻る
        </Link>
      </div>
    </div>
  );
}
