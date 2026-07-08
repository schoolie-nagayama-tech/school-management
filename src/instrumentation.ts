/**
 * サーバー/エッジランタイムの Sentry 初期化（Next.js instrumentation hook）。
 *
 * next.config.mjs の experimental.instrumentationHook を有効にしないと
 * このファイルは読み込まれない（Next 14.2 時点の要件。Next 15 で標準化）。
 *
 * DSN 未設定時は SDK が自動的に無効化されるため、未設定でも安全にビルド・起動できる
 * （src/instrumentation-client.ts と同じ挙動）。
 */
import * as Sentry from '@sentry/nextjs';
import { isNextControlFlowError } from '@/lib/utils/sentryFilters';

export async function register() {
  const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;
  const environment = process.env.VERCEL_ENV ?? process.env.NODE_ENV;
  // Vercel が自動設定するコミットSHA。デプロイごとにエラーを紐付けられる（ローカルでは undefined）。
  const release = process.env.VERCEL_GIT_COMMIT_SHA;

  const beforeSend: NonNullable<Parameters<typeof Sentry.init>[0]>['beforeSend'] = (
    event,
    hint
  ) => {
    const digest = (hint.originalException as { digest?: unknown } | undefined)?.digest;
    if (isNextControlFlowError(digest)) return null;
    return event;
  };

  if (process.env.NEXT_RUNTIME === 'nodejs') {
    Sentry.init({
      dsn,
      environment,
      release,
      sendDefaultPii: false,
      tracesSampleRate: 0,
      beforeSend,
    });
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    Sentry.init({
      dsn,
      environment,
      release,
      sendDefaultPii: false,
      tracesSampleRate: 0,
      beforeSend,
    });
  }
}

// Next.js 15 以降でネストした Server Component のエラーも捕捉するためのフック。
// Next 14.2 では呼ばれないが、将来のアップグレードに備えて先んじて設定しておく。
export const onRequestError = Sentry.captureRequestError;
