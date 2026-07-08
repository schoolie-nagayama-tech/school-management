/**
 * クライアント（ブラウザ）側の Sentry 初期化。
 *
 * NEXT_PUBLIC_SENTRY_DSN が未設定の環境（ローカル開発・DSN未発行のプレビュー等）では
 * SDK は自動的に無効化され何も送信しない（Sentry SDK の標準挙動）ので、
 * 未設定でも安全にビルド・起動できる。
 */
import * as Sentry from '@sentry/nextjs';
import { isAbortError, isNextControlFlowError } from '@/lib/utils/sentryFilters';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,

  // このアプリは生徒・保護者の個人情報を扱うため、IP アドレスや Cookie などを
  // 既定で送信する sendDefaultPii は明示的に無効化する。
  sendDefaultPii: false,

  // パフォーマンス計測(トレース)は行わずエラー捕捉のみに絞る（無料枠の消費を抑える）。
  // 必要になったら 0 より大きい値に上げる。
  tracesSampleRate: 0,

  // よくある「アプリのバグではない」ノイズを除外
  ignoreErrors: [
    'ResizeObserver loop limit exceeded',
    'ResizeObserver loop completed with undelivered notifications',
    // ブラウザ拡張機能由来（広告ブロッカー等）が注入するスクリプトのエラー
    'top.GLOBALS',
    /extension\//i,
    /^chrome-extension:\/\//i,
    /^moz-extension:\/\//i,
  ],

  beforeSend(event, hint) {
    const original = hint.originalException;
    const digest = (original as { digest?: unknown } | undefined)?.digest;
    if (isNextControlFlowError(digest)) return null;
    if (isAbortError(original)) return null;
    return event;
  },
});

// ページ遷移のトレース計測用フック（tracesSampleRate を上げたときのために設定しておく）。
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
