/**
 * 振替確定の保護者通知（座席表・振替通知一覧の共通処理）
 *
 * 送信の実体は `/api/mypage/chat/system/transfer`（service role・冪等）。
 * マイページのチャットに system メッセージを積み、その通知として LINE / メールを飛ばす。
 *
 * ★ ここを共通化する理由:
 *   座席表のコマからと通知一覧からで「送れたのか / なぜ送れなかったのか」の判定と
 *   文言がずれると、室長が同じ状況で違う説明を受けることになる。判定も文言も
 *   この1ファイルに閉じ込め、呼び出し側は結果を表示するだけにする。
 *
 * ★ 「送れなかった」を成功として握りつぶさないこと:
 *   API は非致命の失敗を全部 200 + skipped で返す（振替登録自体は成立しているため）。
 *   そのまま「送信しました」と出すと、保護者に届いていないのに届いた顔をしてしまう。
 *   skipped の理由を必ず画面に出す。
 */

/** 通知の宛先指定。通知レコードIDか、振替先コマのIDのどちらかで指定する。 */
export type TransferNotifyTarget = { transferNotificationId: string } | { toEntryId: string };

export type TransferNotifyResult =
  /** 送信した（チャット投稿＋LINE/メールの発火） */
  | { kind: 'sent' }
  /** 同じ振替で既に通知済み（冪等でスキップ） */
  | { kind: 'already' }
  /** 保護者がマイページ未登録。LINEもメールも宛先が無い */
  | { kind: 'no-portal' }
  /** それ以外の理由で送れなかった */
  | { kind: 'failed'; reason: string };

export async function notifyTransfer(target: TransferNotifyTarget): Promise<TransferNotifyResult> {
  let res: Response;
  try {
    res = await fetch('/api/mypage/chat/system/transfer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(target),
    });
  } catch {
    return { kind: 'failed', reason: 'network' };
  }
  if (!res.ok) return { kind: 'failed', reason: `http-${res.status}` };

  let body: { ok?: boolean; skipped?: boolean; reason?: string };
  try {
    body = (await res.json()) as typeof body;
  } catch {
    return { kind: 'failed', reason: 'bad-response' };
  }

  if (!body.ok) return { kind: 'failed', reason: body.reason ?? 'unknown' };
  if (!body.skipped) return { kind: 'sent' };

  switch (body.reason) {
    case 'already-sent':
      return { kind: 'already' };
    case 'no-portal-account':
    case 'no-thread':
      return { kind: 'no-portal' };
    default:
      return { kind: 'failed', reason: body.reason ?? 'unknown' };
  }
}

/** 結果に対応する画面メッセージ。座席表と通知一覧で同じ言い回しにする。 */
export function transferNotifyMessage(result: TransferNotifyResult): string {
  switch (result.kind) {
    case 'sent':
      return '保護者に通知しました';
    case 'already':
      return 'この振替はすでに通知済みです';
    case 'no-portal':
      return '保護者がまだマイページに登録されていないため通知できません。電話などで連絡してください';
    case 'failed':
      return `通知の送信に失敗しました（${result.reason}）`;
  }
}

/** 成功（送信した / 既に送信済み）かどうか。トーストの色分けと送信済みマークの判定に使う。 */
export function isTransferNotifyDelivered(result: TransferNotifyResult): boolean {
  return result.kind === 'sent' || result.kind === 'already';
}
