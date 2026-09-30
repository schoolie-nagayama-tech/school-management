import type { ChatSenderKind } from '@/types/chat';

/**
 * 生徒ハブ「保護者との連絡」用の、生徒1人分の連絡の要旨。
 *
 * ★スレッドは生徒ごとに1本（chat_threads.student_id が unique）。なので「直近のスレッド」ではなく
 *   「その1本の直近のメッセージ」を行にする。スレッドを行にすると常に1行にしかならない。
 *
 * サーバー（/api/admin/portal-chat/student）とテストの両方から使うので、server-only にしない純関数で持つ。
 */

/** 向き。system（受付の自動返信・振替確定の自動通知）は塾から出た連絡なので to_parent に入れる。 */
export type ChatDirection = 'from_parent' | 'to_parent';

export interface StudentChatDigestItem {
  id: string;
  created_at: string;
  direction: ChatDirection;
  /** 自動送信（sender_kind='system'）か。表示で「自動」と添えるため */
  is_auto: boolean;
  /** 最新メッセージの先頭1行（空行を飛ばした最初の行・最大 PREVIEW_MAX 文字） */
  preview: string;
  /** この保護者メッセージのあとに、スタッフの返信がまだ無い */
  awaiting_reply: boolean;
}

export interface StudentChatDigest {
  /** スレッドがまだ無い（保護者が一度も送っていない・塾からも送っていない）なら null */
  thread_id: string | null;
  /** 新しい順 */
  items: StudentChatDigestItem[];
  /** スレッド全体として返信待ちか（直近の保護者メッセージにスタッフが返していない） */
  awaiting_reply: boolean;
}

export const PREVIEW_MAX = 60;

/** 本文の先頭1行。空行は飛ばす（テンプレ本文は先頭が空行のことがあるため）。 */
export function firstLine(body: string, max = PREVIEW_MAX): string {
  const line =
    body
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? '';
  return line.length > max ? `${line.slice(0, max)}…` : line;
}

interface DigestSourceMessage {
  id: string;
  sender_kind: ChatSenderKind;
  body: string;
  created_at: string;
}

/**
 * 直近のメッセージ（新しい順）から要旨を作る。
 *
 * 返信待ちの定義: 保護者（sender_kind='portal'）のメッセージで、それより後に
 *   スタッフ（sender_kind='staff'）のメッセージが1通も無いもの。
 * ★system の自動返信（「受け付けました」など）は返信に数えない。人が読んで答えたことにはならないため。
 * ★新しい順の直近N件だけで判定して正しい: ある保護者メッセージより後のメッセージは、
 *   それより新しいのだから必ず窓の中にある。窓の外（より古い側）は判定に影響しない。
 */
export function buildStudentChatDigest(
  threadId: string | null,
  messagesNewestFirst: DigestSourceMessage[],
  limit: number
): StudentChatDigest {
  const sorted = [...messagesNewestFirst].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const window = sorted.slice(0, limit);

  let staffSeen = false; // 新しい側から見て、ここまでにスタッフの返信があったか
  const items: StudentChatDigestItem[] = window.map((m) => {
    const fromParent = m.sender_kind === 'portal';
    const awaiting = fromParent && !staffSeen;
    if (m.sender_kind === 'staff') staffSeen = true;
    return {
      id: m.id,
      created_at: m.created_at,
      direction: fromParent ? 'from_parent' : 'to_parent',
      is_auto: m.sender_kind === 'system',
      preview: firstLine(m.body),
      awaiting_reply: awaiting,
    };
  });

  return {
    thread_id: threadId,
    items,
    awaiting_reply: items.some((i) => i.awaiting_reply),
  };
}
