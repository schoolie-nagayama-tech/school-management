/**
 * 保護者ポータル チャット（Stage 2）の型。
 * 正典: docs/portal-v2-requirements.md §7-2。
 */

/** メッセージの送信主体。 */
export type ChatSenderKind = 'staff' | 'portal' | 'system';

/** 構造化テンプレの種別。 */
export type ChatTemplateKind = 'absence' | 'transfer_request' | 'meeting_request';

/** 振替希望の第1〜第3希望（date=授業希望日, slot=時限IDまたはラベル）。 */
export interface TransferCandidate {
  /** 'YYYY-MM-DD' */
  date: string;
  /** 時限ID または人が読めるラベル（例: '17:00〜18:30' / '3限'）。 */
  slot: string;
}

/**
 * テンプレ payload。template_kind により使うフィールドが変わる。
 *   - absence:          lessonDate（対象授業日）, lessonSlot?, reason?, wantsTransfer(振替希望ON/OFF), candidates?
 *   - transfer_request: lessonDate, lessonSlot?, reason?, candidates（第1必須〜第3）
 *   - meeting_request:  reason?（相談内容）, preferredNote?（希望時間帯の自由記述）
 * サーバー側で締切を再検証し、超過時は wantsTransfer を false にダウングレードする。
 */
export interface ChatTemplatePayload {
  /** 対象授業日 'YYYY-MM-DD'（absence/transfer_request）。 */
  lessonDate?: string;
  /** 対象授業の時限ラベル（表示用・任意）。 */
  lessonSlot?: string;
  /** 遅刻/欠席/振替の理由・相談内容（任意）。 */
  reason?: string;
  /** absence: 振替も希望するか。締切超過時はサーバーが false に落とす。 */
  wantsTransfer?: boolean;
  /** 振替希望の第1〜第3希望。 */
  candidates?: TransferCandidate[];
  /** 面談希望の希望時間帯メモ（meeting_request・任意）。 */
  preferredNote?: string;
  /** サーバーが振替を欠席にダウングレードしたことを示すフラグ（監査・表示用）。締切超過 or 上限到達。 */
  transferDowngraded?: boolean;
  /**
   * ダウングレードの理由が「今月の振替上限に達していた」ことを示す（§7-3）。
   * transferDowngraded と併せて立つ。締切超過によるダウングレードと文面を分けるために持つ。
   */
  transferBlockedByQuota?: boolean;
  /**
   * system メッセージの冪等キー（振替確定の自動発信で二重投稿を防ぐ）。
   * 例: 'tn:<transfer_notification_id>' / 'entry:<to_entry_id>'。
   */
  transfer_key?: string;
}

/** メッセージ1件（API/表示で使う共通形）。 */
export interface ChatMessage {
  id: string;
  thread_id: string;
  sender_kind: ChatSenderKind;
  sender_id: string | null;
  body: string;
  template_kind: ChatTemplateKind | null;
  payload: ChatTemplatePayload | null;
  created_at: string;
}

/** スレッド1件（生徒ごと）。 */
export interface ChatThread {
  id: string;
  school_id: string;
  student_id: string;
  created_by: string | null;
  created_at: string;
}

/** 保護者側の「生徒ごとのスレッド概要」（一覧表示用）。 */
export interface PortalThreadSummary {
  student_id: string;
  student_name: string;
  grade: number | null;
  thread_id: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  /** 自分（portal）にとっての未読件数。 */
  unread_count: number;
}
