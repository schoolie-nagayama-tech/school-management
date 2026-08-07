import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * LINE Messaging API の webhook 検証とイベント解析。
 *
 * ★ 署名検証がこの機能の安全性そのもの:
 *   webhook のURLは公開エンドポイントで、誰でもPOSTできる。署名を検証しないと
 *   「他人のLINEユーザーIDで unfollow を送りつけて通知を止める」「follow を偽装する」
 *   といった改ざんが成立してしまう。したがって**署名が正しくないリクエストは
 *   一切処理しない**（本文のパースすらしない）。
 *
 * 署名の仕様（LINE公式）:
 *   X-Line-Signature = Base64( HMAC-SHA256( channelSecret, リクエストボディの生バイト列 ) )
 *   → JSON.parse 後の再シリアライズでは一致しないため、**必ず生のテキスト**で検証する。
 */

/** 扱う webhook イベント種別。message 等は現状ハンドルしない。 */
export type LineEventType = 'follow' | 'unfollow' | 'other';

/** 解析済みの webhook イベント（必要な情報だけに絞る）。 */
export interface ParsedLineEvent {
  type: LineEventType;
  /** 送信元のLINEユーザーID（取れない種別もある）。 */
  userId: string | null;
}

/**
 * X-Line-Signature を検証する。
 *
 * @param rawBody    リクエストボディの生テキスト（パース前）
 * @param signature  X-Line-Signature ヘッダの値
 * @returns 正当なら true
 */
export function verifyLineSignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.LINE_MESSAGING_CHANNEL_SECRET;
  if (!secret || !signature) return false;

  const expected = createHmac('sha256', secret).update(rawBody).digest('base64');

  // 長さが違うと timingSafeEqual が投げるので先に比較する。
  // （長さの不一致は署名の形が違う＝明確に不正なので、ここで落ちてよい）
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;

  // 文字列の === だと先頭一致の度合いで処理時間が変わり、総当たりの手がかりになる。
  return timingSafeEqual(a, b);
}

/**
 * webhook ボディからイベントを取り出す。
 *
 * LINE は「接続確認」で events が空の配列のリクエストを送ってくる（コンソールの検証ボタン）。
 * その場合は空配列を返し、呼び出し側は 200 を返すだけでよい。
 */
export function parseLineEvents(rawBody: string): ParsedLineEvent[] {
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return [];
  }

  const events = (json as { events?: unknown })?.events;
  if (!Array.isArray(events)) return [];

  return events.map((e): ParsedLineEvent => {
    const ev = e as { type?: unknown; source?: { userId?: unknown } };
    const rawType = typeof ev.type === 'string' ? ev.type : '';
    const type: LineEventType =
      rawType === 'follow' ? 'follow' : rawType === 'unfollow' ? 'unfollow' : 'other';
    const userId = typeof ev.source?.userId === 'string' ? ev.source.userId : null;
    return { type, userId };
  });
}
