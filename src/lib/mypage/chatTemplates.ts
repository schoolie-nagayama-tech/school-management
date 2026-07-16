/**
 * チャット構造化メッセージの本文生成（純関数・サーバー/表示で共用）。
 *
 * 正典: docs/portal-v2-requirements.md §7-2「テンプレ」「自動生成メッセージ」。
 *
 * ここで生成するのは chat_messages.body（プレーンテキスト・改行入り）。構造化データは
 * payload に持つが、body にも人が読める要約を入れておく（メール/一覧/フォールバック表示用）。
 *
 * ★ 日付整形は JST 前提。'YYYY-MM-DD' 文字列を素直に日本語表記へ変換する
 *   （Date のローカルTZに依存させない）。
 */
import type { ChatTemplateKind, ChatTemplatePayload, TransferCandidate } from '@/types/chat';

/** 'YYYY-MM-DD' → 'M月D日'。不正はそのまま返す。 */
export function formatJpDate(dateStr: string | undefined | null): string {
  if (!dateStr) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return dateStr;
  return `${Number(m[2])}月${Number(m[3])}日`;
}

/** 振替希望候補を「第1希望: 7月20日 17:00〜」形式の行に整形する。 */
export function formatCandidates(candidates: TransferCandidate[] | undefined): string[] {
  if (!candidates || candidates.length === 0) return [];
  const rank = ['第1希望', '第2希望', '第3希望'];
  return candidates
    .filter((c) => c && c.date)
    .slice(0, 3)
    .map((c, i) => {
      const slot = c.slot ? ` ${c.slot}` : '';
      return `${rank[i] ?? `第${i + 1}希望`}: ${formatJpDate(c.date)}${slot}`;
    });
}

/**
 * 保護者が送るテンプレメッセージの本文（body）を生成する。
 * payload の内容を人が読める要約テキストにする（構造化カードとは別に本文にも残す）。
 */
export function buildTemplateBody(kind: ChatTemplateKind, payload: ChatTemplatePayload): string {
  const lines: string[] = [];
  switch (kind) {
    case 'absence': {
      lines.push('【欠席・遅刻のご連絡】');
      if (payload.lessonDate) {
        lines.push(
          `対象授業: ${formatJpDate(payload.lessonDate)}${payload.lessonSlot ? ` ${payload.lessonSlot}` : ''}`
        );
      }
      if (payload.reason) lines.push(`理由: ${payload.reason}`);
      if (payload.wantsTransfer) {
        lines.push('振替希望: あり');
        lines.push(...formatCandidates(payload.candidates));
      } else {
        lines.push('振替希望: なし');
      }
      break;
    }
    case 'transfer_request': {
      lines.push('【振替のご希望】');
      if (payload.lessonDate) {
        lines.push(
          `対象授業: ${formatJpDate(payload.lessonDate)}${payload.lessonSlot ? ` ${payload.lessonSlot}` : ''}`
        );
      }
      if (payload.reason) lines.push(`理由: ${payload.reason}`);
      lines.push(...formatCandidates(payload.candidates));
      break;
    }
    case 'meeting_request': {
      lines.push('【面談のご希望】');
      if (payload.preferredNote) lines.push(`希望時間帯: ${payload.preferredNote}`);
      if (payload.reason) lines.push(`ご相談内容: ${payload.reason}`);
      break;
    }
  }
  return lines.join('\n');
}

/**
 * 受付の自動返信（sender_kind='system'）本文を生成する。
 *
 * 正典 §7-2:
 *   - absence / transfer_request を送ると即時にシステムが受付返信を投稿。
 *   - 締切判定を文面に反映（締切内=希望日時を確認して振替日を案内 / 当日=欠席として承る）。
 *   - サーバーが振替を欠席にダウングロードした場合はその旨を含める。
 *
 * @param kind             送信されたテンプレ種別
 * @param payload          （ダウングレード反映後の）payload
 * @param deadlinePassed   対象授業が振替締切を過ぎているか（サーバーで算出した結果）
 * @param meetingBookingUrl 面談予約ページ（Googleカレンダー）のURL。
 *   ★ 呼び出し側から渡す理由: この関数を純関数のまま保つため（DBを引かない）。
 *     生徒の所属校の schools.meeting_booking_url を引くのは API 側の責務。
 *     未設定（null/空）なら何も足さない＝従来どおりの文面（後方互換）。
 */
export function buildAckBody(
  kind: ChatTemplateKind,
  payload: ChatTemplatePayload,
  deadlinePassed: boolean,
  meetingBookingUrl?: string | null
): string {
  const dateLabel = payload.lessonDate ? `${formatJpDate(payload.lessonDate)}の授業について、` : '';

  if (kind === 'meeting_request') {
    const base = 'ご希望を受け付けました。担当より日程を調整のうえ、あらためてご連絡します。';
    // 予約ページがある教室は、その場で保護者に枠を押さえてもらう（往復が1回減る）。
    if (meetingBookingUrl) {
      return `${base}\nご都合の良い日時を下記からご予約ください：\n${meetingBookingUrl}`;
    }
    return base;
  }

  // 上限到達によるダウングレード（§7-3）。締切超過より先に判定する。
  // ★ 順序の意図: 締切内なのに上限で落ちた場合、「前日21時を過ぎているため」と案内すると
  //   事実と違う（保護者は締切を守っている）。理由を取り違えない。
  if (payload.transferBlockedByQuota) {
    return (
      `${dateLabel}ご連絡ありがとうございます。\n` +
      '今月の振替上限に達しているため欠席として承りました。' +
      '振替をご希望の場合は教室にご相談ください。'
    );
  }

  // absence / transfer_request
  if (deadlinePassed) {
    // 締切超過（前日21時以降・当日）: 振替対象外。欠席として承る。
    if (payload.transferDowngraded) {
      return (
        `${dateLabel}ご連絡ありがとうございます。\n` +
        '前日21時を過ぎているため振替はできません。欠席として承りました（振替対象外）。'
      );
    }
    return (
      `${dateLabel}ご連絡ありがとうございます。\n` +
      '当日のご連絡のため、欠席として承りました（振替対象外）。'
    );
  }

  // 締切内
  if (kind === 'transfer_request' || payload.wantsTransfer) {
    return (
      `${dateLabel}振替のご希望を受け付けました。\n` +
      'いただいた希望日時を確認し、振替日が決まり次第あらためてご案内します。'
    );
  }
  // 欠席のみ（振替希望なし）
  return `${dateLabel}欠席のご連絡を受け付けました。`;
}

/**
 * 振替確定（座席表からの自動発信・sender_kind='system'）本文を生成する。
 *
 * 正典 §7-2「振替確定の座席表からの自動発信」:
 *   実際の振替日・時限・科目を当てはめたシステムメッセージ。
 *
 * @param params.toDate       振替先の日付 'YYYY-MM-DD'
 * @param params.toSlotLabel  振替先の時限ラベル（例 '17:00〜18:30'）。無ければ省略。
 * @param params.subjectNames 科目名の配列（無ければ省略）。
 */
export function buildTransferConfirmedBody(params: {
  toDate: string;
  toSlotLabel?: string | null;
  subjectNames?: string[];
}): string {
  const lines: string[] = ['【振替日が決まりました】'];
  const slot = params.toSlotLabel ? ` ${params.toSlotLabel}` : '';
  lines.push(`振替日: ${formatJpDate(params.toDate)}${slot}`);
  if (params.subjectNames && params.subjectNames.length > 0) {
    lines.push(`科目: ${params.subjectNames.join('・')}`);
  }
  lines.push('ご都合が合わない場合は、このチャットからご連絡ください。');
  return lines.join('\n');
}
