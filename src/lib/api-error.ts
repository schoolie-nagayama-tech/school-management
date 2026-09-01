import * as Sentry from '@sentry/nextjs';
import { NextResponse } from 'next/server';
import {
  isAbortError,
  isNextControlFlowError,
  isRequestBodyParseError,
} from '@/lib/utils/sentryFilters';

/**
 * API ルートで捕捉した例外を Sentry に転送するための共通ヘルパー。
 *
 * ★なぜ必要か:
 *   96 ルート・129 個の catch のうち、中身はほぼ `console.error` だけで Sentry へ
 *   転送していなかった。@sentry/nextjs はルートハンドラを自動計装するが、拾えるのは
 *   「捕捉されなかった例外」だけなので、try/catch を書いた瞬間に Sentry から見えなくなる。
 *   結果として「丁寧にエラー処理を書いたルートほど本番で何が起きているか分からない」
 *   という逆転が起きていた。console.error は Vercel の短い保持期間で消える。
 *
 * ★個人情報を送らないこと:
 *   このアプリは生徒・保護者の個人情報を扱う。Sentry 側でも sendDefaultPii:false を
 *   設定しているが、それは SDK が自動収集する分（IP/Cookie 等）を止めるだけで、
 *   こちらが context に詰めた値は素通りする。氏名・メール・電話・住所・回答内容は
 *   絶対に入れない。ID（uuid）や件数・ロール名など、それ自体では個人を特定できない
 *   ものに限ること。
 */

/** Sentry に添えるコンテキスト。個人情報は入れないこと（上のコメント参照）。 */
export interface ApiErrorContext {
  /** どのルートか。例: 'POST /api/tasks' */
  route: string;
  /** ルート内のどの分岐か。例: 'update_task' */
  action?: string;
  /** 操作者の ID・ロール・教室 ID など、個人を特定しない識別子のみ */
  userId?: string | null;
  role?: string | null;
  schoolId?: string | null;
  /** その他、個人情報を含まない補助情報 */
  extra?: Record<string, string | number | boolean | null | undefined>;
}

/**
 * 例外を Sentry に送り、構造化ログを1行残す。
 *
 * レスポンスは呼び出し側が決める（既存の文言・ステータスを変えないため）。
 * 既に catch の中で console.error している箇所は、それを置き換えずにこの関数を
 * 足すだけでよい ＝ 挙動を変えずに可観測性だけ上げられる。
 *
 * @returns Sentry のイベントID。ユーザーに問い合わせ番号として見せてもよい
 */
export function captureApiError(error: unknown, context: ApiErrorContext): string | undefined {
  // アプリのバグではないものは送らない（本物のエラーがノイズに埋もれるのを防ぐ）。
  //   - redirect()/notFound() の制御用エラー、fetch の中断: クライアント側の beforeSend と同じ判定
  //   - リクエストボディの JSON パース失敗: クライアント/攻撃者由来。公開エンドポイントで
  //     壊れた body を投げ続けられるとイベント枠を食い潰されるため、中央で落とす
  const digest = (error as { digest?: unknown } | undefined)?.digest;
  if (isNextControlFlowError(digest) || isAbortError(error) || isRequestBodyParseError(error)) {
    return undefined;
  }

  const eventId = Sentry.captureException(error, {
    tags: {
      api_route: context.route,
      ...(context.action ? { api_action: context.action } : {}),
    },
    contexts: {
      api: {
        route: context.route,
        action: context.action ?? null,
        user_id: context.userId ?? null,
        role: context.role ?? null,
        school_id: context.schoolId ?? null,
        ...(context.extra ?? {}),
      },
    },
  });

  // Vercel のログを機械的に追えるよう構造化して1行で出す。
  // 障害調査でリクエストを串刺しにするときの手がかりになる。
  console.error(
    JSON.stringify({
      type: 'API_ERROR',
      route: context.route,
      action: context.action ?? null,
      userId: context.userId ?? null,
      schoolId: context.schoolId ?? null,
      sentryEventId: eventId ?? null,
      message: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    })
  );

  return eventId;
}

/**
 * 例外を Sentry に送ったうえで、正規化した 500 レスポンスを返す。
 *
 * ★クライアントに内部エラー文言を返さないこと:
 *   `{ error: e.message }` で返すと、DB のカラム名・制約名といった内部構造が
 *   そのまま利用者に見える。文言は固定にして、詳細は Sentry 側で見る。
 *   代わりに eventId を添えるので、問い合わせを受けたらこの番号で引ける。
 *
 * @param userMessage 利用者に見せる文言（日本語）。既定は汎用メッセージ
 */
export function apiErrorResponse(
  error: unknown,
  context: ApiErrorContext,
  userMessage = 'サーバー側で問題が発生しました。時間をおいて再度お試しください。',
  status = 500
): NextResponse {
  const eventId = captureApiError(error, context);
  return NextResponse.json({ error: userMessage, ...(eventId ? { eventId } : {}) }, { status });
}
