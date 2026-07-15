import 'server-only';
import { getPortalServiceClient } from './serviceClient';

/**
 * ポータル通知ディスパッチャ（Stage 2）。
 *
 * 正典: docs/portal-v2-requirements.md §7-2「メール通知」/ docs/account-line-design.md §6。
 *   「通知は1箇所のディスパッチャに集約し、チャネル（画面内/メール/将来LINE）を
 *    差し替え可能に」する要件のための単一集約点。
 *
 * 現状のチャネル:
 *   - in-app: メッセージ/お知らせは既に DB に永続化済み（画面内バッジ・未読で表現）。
 *     このチャネルは「追加の副作用なし」なので dispatcher 側では no-op 記録のみ。
 *   - email: 既存 Resend 経路（send-inquiry-mail Edge Function）に相乗り。
 *
 * ★ 宛先メール解決の現状（TODO）:
 *   portal_accounts は PII（メール）を持たない設計。よって「ポータルアカウント→メール」の
 *   確実な解決手段が現状ない。暫定として、生徒に紐づく form_responses.email を最後の受信分
 *   から拾う経路を用意するが、未登録なら空配列（＝メールは no-op＋ログ）。
 *   将来 LINE 連携 or portal_accounts への通知先追加で本実装に差し替える。
 *
 * テスタビリティ:
 *   チャネル群と宛先リゾルバを引数で注入できる（既定は本番実装）。ユニットテストは
 *   fake を渡してファンアウト挙動だけを検証する（実送信・DBアクセスなし）。
 */

/** 通知イベント種別。 */
export type NotifyKind =
  | 'chat_new_message'
  | 'announcement'
  | 'system_message'
  /** 授業報告書の承認（＝公開）時（Stage4・§7-4）。 */
  | 'report_published';

/** ディスパッチする通知イベント。 */
export interface NotifyEvent {
  kind: NotifyKind;
  /** 対象生徒（メール宛先解決の起点）。 */
  studentId?: string;
  /** 明示的な宛先メール（分かっている場合。指定時はリゾルバをスキップ）。 */
  toEmails?: string[];
  /** メール件名（＝画面内通知の見出しにも使う）。 */
  title: string;
  /** 本文（プレーンテキスト・改行入り）。 */
  body: string;
  /** 差出人表示名（教室名など）。省略時は既定。 */
  fromName?: string;
  /** 返信先（教室メール）。 */
  replyTo?: string;
}

/** 1チャネルの送信結果。 */
export interface ChannelResult {
  channel: string;
  delivered: number;
  skipped: boolean;
  error?: string;
}

/** 通知チャネルのインターフェース（差し替え可能）。 */
export interface NotifyChannel {
  name: string;
  send(event: NotifyEvent, recipientEmails: string[]): Promise<ChannelResult>;
}

/** 宛先メール解決関数の型。 */
export type EmailResolver = (event: NotifyEvent) => Promise<string[]>;

/**
 * 既定の宛先メール解決:
 *   event.toEmails があればそれを使う。無ければ studentId から form_responses.email を
 *   最新順に拾う（重複排除）。解決できなければ空配列（メールは no-op になる）。
 */
export const defaultEmailResolver: EmailResolver = async (event) => {
  if (event.toEmails && event.toEmails.length > 0) return dedupeEmails(event.toEmails);
  if (!event.studentId) return [];
  try {
    const supabase = getPortalServiceClient();
    // 生徒に紐づく問合せ/フォーム回答のメールを拾う暫定経路（PIIを持たない設計の穴埋め）。
    // TODO(通知先の恒久解決): portal_accounts への通知先メール追加 or LINE 連携に差し替える。
    const { data } = await supabase
      .from('form_responses')
      .select('email, created_at')
      .eq('student_id', event.studentId)
      .not('email', 'is', null)
      .order('created_at', { ascending: false })
      .limit(5);
    const emails = (data ?? [])
      .map((r: { email: string | null }) => r.email)
      .filter((e): e is string => !!e && e.includes('@'));
    return dedupeEmails(emails);
  } catch (e) {
    console.warn('[mypage/notify] メール宛先の解決に失敗（メールはスキップ）:', e);
    return [];
  }
};

/** in-app チャネル: メッセージは既に永続化済みなので副作用なし（記録のみ）。 */
export const inAppChannel: NotifyChannel = {
  name: 'in-app',
  async send() {
    // 画面内通知はデータ（未読）で表現されるため、ここでの追加送信は不要。
    return { channel: 'in-app', delivered: 0, skipped: false };
  },
};

/**
 * email チャネル: 既存 send-inquiry-mail Edge Function に相乗りして送る。
 * 宛先が空、または RESEND 未設定時は no-op（skipped=true）＋ログ。
 */
export const emailChannel: NotifyChannel = {
  name: 'email',
  async send(event, recipientEmails) {
    if (recipientEmails.length === 0) {
      // 宛先未解決（クローズド期間の大半・PII未登録）は静かにスキップ。
      return { channel: 'email', delivered: 0, skipped: true };
    }
    try {
      const supabase = getPortalServiceClient();
      let delivered = 0;
      for (const to of recipientEmails) {
        const { error } = await supabase.functions.invoke('send-inquiry-mail', {
          body: {
            to,
            subject: event.title,
            body: event.body,
            fromName: event.fromName ?? 'スクールIE',
            replyTo: event.replyTo,
          },
        });
        if (error) {
          console.warn('[mypage/notify] メール送信に失敗:', error.message ?? error);
        } else {
          delivered += 1;
        }
      }
      return { channel: 'email', delivered, skipped: false };
    } catch (e) {
      // 実送信は環境（RESEND_API_KEY / Edge Function デプロイ）に依存。未整備なら no-op 扱い。
      console.warn('[mypage/notify] メールチャネルが利用不可（スキップ）:', e);
      return { channel: 'email', delivered: 0, skipped: true, error: String(e) };
    }
  },
};

/**
 * 通知をディスパッチする。全チャネルへファンアウトし、結果を集約して返す。
 * 失敗は握りつぶさず結果に載せるが、throw はしない（通知は非致命）。
 *
 * @param event    通知イベント
 * @param opts     テスト用のチャネル/リゾルバ差し替え
 */
export async function dispatchNotification(
  event: NotifyEvent,
  opts?: { channels?: NotifyChannel[]; emailResolver?: EmailResolver }
): Promise<ChannelResult[]> {
  const channels = opts?.channels ?? [inAppChannel, emailChannel];
  const resolver = opts?.emailResolver ?? defaultEmailResolver;

  // メール宛先は email 系チャネルがあるときだけ解決する（無駄なDBアクセスを避ける）。
  const needsEmail = channels.some((c) => c.name === 'email');
  const recipientEmails = needsEmail ? await resolver(event) : [];

  const results: ChannelResult[] = [];
  for (const ch of channels) {
    try {
      results.push(await ch.send(event, recipientEmails));
    } catch (e) {
      results.push({ channel: ch.name, delivered: 0, skipped: true, error: String(e) });
    }
  }
  return results;
}

/** メールの重複排除（小文字化して一意に）。 */
function dedupeEmails(emails: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of emails) {
    const k = e.trim().toLowerCase();
    if (k && !seen.has(k)) {
      seen.add(k);
      out.push(e.trim());
    }
  }
  return out;
}
