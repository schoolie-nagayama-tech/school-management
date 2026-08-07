import 'server-only';
import { getPortalServiceClient } from './serviceClient';

/**
 * LINE Messaging API のプッシュ送信クライアント（通数ログ付き）。
 *
 * 正典: docs/account-line-design.md §6（コストモデル・通知マトリクス）。
 *
 * ★ 課金の考え方:
 *   料金は「送信人数 × 配信回数」。300人に1回配信すれば300通。
 *   1回のAPI呼び出しで何人に送ったかが課金単位なので、送信のたびに
 *   line_message_logs へ人数を残し、月次でプラン妥当性を判断できるようにする。
 *
 * ★ 既定は送信しない（dry-run）:
 *   LINE_PUSH_ENABLED='true' を明示的に立てるまで、実送信せずログだけ残す。
 *   保護者ポータルはまだクローズド（portal_v2_enabled=false）であり、
 *   この段階で実在の保護者にLINEが飛ぶ事故は取り返しがつかないため、
 *   「配線は通すが弾は撃たない」を既定にする。
 */

/** multicast の宛先上限（LINE仕様）。これを超える分は分割して送る。 */
const MULTICAST_CHUNK_SIZE = 500;

const MULTICAST_URL = 'https://api.line.me/v2/bot/message/multicast';

/** 送信結果（通数ログにも同じ内容を残す）。 */
export interface LinePushResult {
  status: 'sent' | 'dry_run' | 'skipped' | 'error';
  /** 宛先人数。 */
  recipientCount: number;
  /** 課金対象の通数（人数×メッセージ数。今は1メッセージ固定なので人数と同じ）。 */
  messageCount: number;
  detail?: string;
}

/** LINEプッシュが設定済みか（アクセストークンがあるか）。 */
export function isLinePushConfigured(): boolean {
  return !!process.env.LINE_MESSAGING_ACCESS_TOKEN;
}

/**
 * 実送信するかどうか。既定は false（dry-run）。
 * 本番で実際に配信を始めるときに LINE_PUSH_ENABLED='true' を立てる。
 */
export function isLinePushEnabled(): boolean {
  return process.env.LINE_PUSH_ENABLED === 'true';
}

/**
 * 通知の本文を組み立てる。
 *
 * ★ 冒頭の【〇〇校】は仕様（2026-08-05 決定）:
 *   公式アカウントは複数教室で1本しか持たないため、アカウント名では
 *   どの教室からの連絡か分からない。本文の先頭で必ず明示する。
 */
export function buildPushText(params: {
  title: string;
  body: string;
  schoolName?: string;
  url?: string;
}): string {
  // 呼び出し側が既にタイトルへ【教室名】を入れている経路がある
  // （報告書公開など。メール件名として先に作られたもの）。二重に付けない。
  const alreadyPrefixed = params.title.trimStart().startsWith('【');
  const head =
    params.schoolName && !alreadyPrefixed
      ? `【${params.schoolName}】${params.title}`
      : params.title;
  const parts = [head, params.body.trim()];
  if (params.url) parts.push(params.url);
  return parts.filter(Boolean).join('\n\n');
}

/**
 * LINEへプッシュ送信する（宛先が複数なら multicast で分割送信）。
 *
 * 例外は投げない。通知は非致命なので、失敗しても結果として返して呼び出し側の
 * 処理（チャット送信・報告書公開など本体の処理）は止めない。
 *
 * @param lineUserIds 宛先のLINEユーザーID
 * @param text        本文（buildPushText で組み立てたもの）
 */
export async function sendLinePush(lineUserIds: string[], text: string): Promise<LinePushResult> {
  const recipients = Array.from(new Set(lineUserIds.filter(Boolean)));
  if (recipients.length === 0) {
    return { status: 'skipped', recipientCount: 0, messageCount: 0, detail: '宛先なし' };
  }

  if (!isLinePushConfigured()) {
    return {
      status: 'skipped',
      recipientCount: recipients.length,
      messageCount: 0,
      detail: 'LINE_MESSAGING_ACCESS_TOKEN 未設定',
    };
  }

  // ★ 既定はここで止まる。配線の確認はログでできる。
  if (!isLinePushEnabled()) {
    console.info(
      `[mypage/linePush] dry-run: ${recipients.length}人への送信をスキップしました（LINE_PUSH_ENABLED 未設定）`
    );
    return {
      status: 'dry_run',
      recipientCount: recipients.length,
      messageCount: recipients.length,
      detail: 'LINE_PUSH_ENABLED が true でないため送信しない',
    };
  }

  const token = process.env.LINE_MESSAGING_ACCESS_TOKEN as string;
  const errors: string[] = [];

  for (let i = 0; i < recipients.length; i += MULTICAST_CHUNK_SIZE) {
    const chunk = recipients.slice(i, i + MULTICAST_CHUNK_SIZE);
    try {
      const res = await fetch(MULTICAST_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          to: chunk,
          messages: [{ type: 'text', text }],
        }),
        cache: 'no-store',
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        errors.push(`${res.status} ${detail.slice(0, 200)}`);
      }
    } catch (e) {
      errors.push(String(e));
    }
  }

  if (errors.length > 0) {
    console.warn('[mypage/linePush] 送信に失敗:', errors.join(' / '));
    return {
      status: 'error',
      recipientCount: recipients.length,
      messageCount: 0,
      detail: errors.join(' / ').slice(0, 500),
    };
  }

  return {
    status: 'sent',
    recipientCount: recipients.length,
    messageCount: recipients.length,
  };
}

/**
 * 通数ログを1行残す。
 * ログの失敗で通知本体を巻き込まない（記録は握りつぶして warn だけ出す）。
 */
export async function logLineMessage(params: {
  kind: string;
  studentId?: string;
  result: LinePushResult;
}): Promise<void> {
  try {
    const supabase = getPortalServiceClient();
    const { error } = await supabase.from('line_message_logs').insert({
      kind: params.kind,
      student_id: params.studentId ?? null,
      recipient_count: params.result.recipientCount,
      // 課金されるのは実送信のみ。dry_run/skipped/error は 0 で記録し、
      // 月次集計（sum(message_count) where status='sent'）がそのまま請求見込みになる。
      message_count: params.result.status === 'sent' ? params.result.messageCount : 0,
      status: params.result.status,
      detail: params.result.detail ?? null,
    });
    if (error) {
      console.warn('[mypage/linePush] 通数ログの記録に失敗:', error.message);
    }
  } catch (e) {
    console.warn('[mypage/linePush] 通数ログの記録に失敗:', e);
  }
}
