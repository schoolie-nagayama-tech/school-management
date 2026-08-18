import 'server-only';
import { getPortalServiceClient } from './serviceClient';
import { buildPushText, logLineMessage, sendLinePush } from './linePush';

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
 *   - line: Messaging API のプッシュ（linePush.ts）。**既定は dry-run**で、
 *     LINE_PUSH_ENABLED='true' を立てるまで実送信しない。通数は毎回ログに残す。
 *
 * ★ 宛先はチャネルごとに解決する:
 *   email は「メールアドレス」、line は「LINEユーザーID」と宛先の型が違う。
 *   dispatcher は チャネル名（'email' / 'line'）を見て、そのチャネル用の
 *   リゾルバだけを走らせる。チャネルが無ければ解決処理自体を走らせない
 *   （無駄なDBアクセスを避ける）。
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

/**
 * 通知の宛先区分。
 *
 * ★ 既定が 'staff'（＝LINEを送らない）なのは意図的:
 *   dispatchNotification は保護者宛にもスタッフ宛にも使われている
 *   （例: 保護者がチャットを送った通知は「スタッフ宛」）。ここを取り違えると
 *   **保護者が自分の送信について自分にLINE通知を受け取る**という誤配信になり、
 *   通数も無駄に消費する。指定を忘れたときは送らない側（fail-closed）に倒す。
 */
export type NotifyAudience = 'guardian' | 'staff';

/** ディスパッチする通知イベント。 */
export interface NotifyEvent {
  kind: NotifyKind;
  /** 宛先区分。'guardian' のときだけ LINE プッシュの対象になる（既定 'staff'）。 */
  audience?: NotifyAudience;
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
  /** 詳細を見にいくURL（LINE本文の末尾に付ける）。 */
  url?: string;
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

/** 宛先LINEユーザーID解決関数の型。 */
export type LineResolver = (event: NotifyEvent) => Promise<string[]>;

/**
 * 既定の宛先メール解決:
 *   event.toEmails があればそれを使う。無ければ studentId から form_responses.email を
 *   最新順に拾う（重複排除）。解決できなければ空配列（メールは no-op になる）。
 */
export const defaultEmailResolver: EmailResolver = async (event) => {
  if (event.toEmails && event.toEmails.length > 0) return dedupeEmails(event.toEmails);
  if (!event.studentId) return [];

  // ★ ダミーデータからの実送信を止める最終ガード
  //   デモ体験（研修用テスト生徒・デモ教室）で操作した結果、実在の保護者に
  //   メールが飛ぶ事故を防ぐ。呼び出し側それぞれに「デモなら送るな」を書かせると
  //   必ず書き忘れが出るので、宛先解決が必ず通るこの1箇所で塞ぐ。
  //   将来デモ経路や通知種別が増えても、ここを通る限り自動的に守られる。
  //
  //   例外＝デモ通知の試用（NOTIFY_DEMO_EMAIL_ALLOWLIST）:
  //   デモ教室で通知の一周（操作→実際に届く）を試すため、許可リストに載った宛先
  //   **だけ**は送信を許す。リストには自社スタッフのメールだけを載せる運用。
  //   env 未設定なら従来どおり全ブロックなので、消せば元の安全状態に戻る。
  //   実在生徒（非ダミー）の経路はこの分岐を通らず、一切変わらない。
  const dummy = await isDummyStudent(event.studentId);
  const demoEmailAllowlist = parseAllowlist(process.env.NOTIFY_DEMO_EMAIL_ALLOWLIST, true);
  if (dummy && demoEmailAllowlist.size === 0) {
    console.info(
      '[mypage/notify] ダミーデータ（テスト生徒/デモ教室）のためメール送信をスキップ:',
      event.studentId
    );
    return [];
  }

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
    const resolved = dedupeEmails(emails);
    // ダミー生徒は許可リスト掲載の宛先だけに絞る（リスト外の実在アドレスは落とす）。
    if (dummy) {
      return resolved.filter((e) => demoEmailAllowlist.has(e.toLowerCase()));
    }
    return resolved;
  } catch (e) {
    console.warn('[mypage/notify] メール宛先の解決に失敗（メールはスキップ）:', e);
    return [];
  }
};

/**
 * カンマ区切りの許可リスト env をパースする（デモ通知試用用）。
 * lowercase=true はメール用（大文字小文字を無視して比較するため正規化する）。
 * 未設定・空文字は空 Set＝「例外なし（全ブロック）」を意味する。
 */
function parseAllowlist(raw: string | undefined, lowercase: boolean): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(',')
      .map((s) => (lowercase ? s.trim().toLowerCase() : s.trim()))
      .filter((s) => s.length > 0)
  );
}

/**
 * 生徒がダミーデータ（研修用テスト生徒 or デモ教室所属）かを判定する。
 *
 * 判定不能（DBエラー等）のときは true を返して安全側に倒す:
 *   「送れないダミー」を送らないより、「送ってはいけない相手」に送る方が害が大きい。
 *   メールは非致命な通知なので、疑わしいときは送らない側に倒してよい。
 */
async function isDummyStudent(studentId: string): Promise<boolean> {
  try {
    const supabase = getPortalServiceClient();
    const { data, error } = await supabase
      .from('students')
      .select('is_test, schools(is_demo)')
      .eq('id', studentId)
      .maybeSingle();

    if (error) {
      console.warn('[mypage/notify] ダミー判定に失敗（安全側でメールをスキップ）:', error.message);
      return true;
    }
    // 生徒が見つからない場合も宛先を解決すべき相手がいないのでスキップ扱い。
    if (!data) return true;

    const row = data as { is_test?: boolean; schools?: { is_demo?: boolean } | null };
    return row.is_test === true || row.schools?.is_demo === true;
  } catch (e) {
    console.warn('[mypage/notify] ダミー判定に失敗（安全側でメールをスキップ）:', e);
    return true;
  }
}

/**
 * 既定の宛先LINE解決:
 *   studentId に紐づくポータルアカウントのうち、LINE連携済みのユーザーIDを集める。
 *
 * ★ メールと同じダミーデータガードを必ず通す:
 *   デモ体験（研修用テスト生徒・デモ教室）の操作で実在の保護者にLINEが飛ぶ事故は
 *   メール以上に取り返しがつかない（既読が付き、削除もできない）。
 *   呼び出し側に「デモなら送るな」を書かせると必ず書き忘れるので、
 *   宛先解決が必ず通るこの1箇所で塞ぐ。
 */
export const defaultLineResolver: LineResolver = async (event) => {
  // スタッフ宛の通知を保護者のLINEに流さない（既定は staff＝送らない）。
  if (event.audience !== 'guardian') return [];
  if (!event.studentId) return [];

  // デモ通知の試用例外（NOTIFY_DEMO_LINE_ALLOWLIST）はメール側と同じ設計:
  //   ダミー生徒でも、許可リストに載った LINE userId だけは宛先に残す。
  //   リストには自社スタッフの userId だけを載せる運用。env 未設定なら従来どおり
  //   全ブロック。なお実送信の最終ゲートは従来どおり linePush.ts の
  //   LINE_PUSH_ENABLED であり、この許可リストは宛先解決の絞り込みでしかない。
  const dummy = await isDummyStudent(event.studentId);
  const demoLineAllowlist = parseAllowlist(process.env.NOTIFY_DEMO_LINE_ALLOWLIST, false);
  if (dummy && demoLineAllowlist.size === 0) {
    console.info(
      '[mypage/notify] ダミーデータ（テスト生徒/デモ教室）のためLINE送信をスキップ:',
      event.studentId
    );
    return [];
  }

  try {
    const supabase = getPortalServiceClient();
    const { data, error } = await supabase
      .from('portal_account_students')
      .select('portal_accounts(line_user_id, line_followed)')
      .eq('student_id', event.studentId);

    if (error) {
      console.warn('[mypage/notify] LINE宛先の解決に失敗（LINEはスキップ）:', error.message);
      return [];
    }

    const rows = (data ?? []) as unknown as {
      portal_accounts: { line_user_id: string | null; line_followed?: boolean | null } | null;
    }[];
    const ids = rows
      // ブロック/友だち解除された相手には届かないので宛先から外す（webhook P3-C9 が更新）。
      // カラム未取得（undefined）は「不明」として送る側に倒す＝従来どおりの挙動。
      .filter((r) => r.portal_accounts?.line_followed !== false)
      .map((r) => r.portal_accounts?.line_user_id)
      .filter((id): id is string => !!id);
    const resolved = Array.from(new Set(ids));
    // ダミー生徒は許可リスト掲載の userId だけに絞る（リスト外は落とす）。
    if (dummy) {
      return resolved.filter((id) => demoLineAllowlist.has(id));
    }
    return resolved;
  } catch (e) {
    console.warn('[mypage/notify] LINE宛先の解決に失敗（LINEはスキップ）:', e);
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
 * line チャネル: Messaging API のプッシュ。
 *
 * 送信の可否（dry-run か実送信か）は linePush 側の LINE_PUSH_ENABLED が決める。
 * ここでは「宛先が無ければ何もしない」と「結果を必ず通数ログに残す」だけを担う。
 * ログは status に関わらず残す（dry-run の記録が、本番投入前の配線確認の証跡になる）。
 */
export const lineChannel: NotifyChannel = {
  name: 'line',
  async send(event, recipients) {
    // 宛先区分の二重確認（リゾルバを差し替えられても誤配信しないための多層防御）。
    if (event.audience !== 'guardian' || recipients.length === 0) {
      return { channel: 'line', delivered: 0, skipped: true };
    }

    const text = buildPushText({
      title: event.title,
      body: event.body,
      url: event.url,
    });

    const result = await sendLinePush(recipients, text);
    await logLineMessage({ kind: event.kind, studentId: event.studentId, result });

    return {
      channel: 'line',
      delivered: result.status === 'sent' ? result.recipientCount : 0,
      skipped: result.status !== 'sent',
      error: result.status === 'error' ? result.detail : undefined,
    };
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
  opts?: {
    channels?: NotifyChannel[];
    emailResolver?: EmailResolver;
    lineResolver?: LineResolver;
  }
): Promise<ChannelResult[]> {
  const channels = opts?.channels ?? [inAppChannel, emailChannel, lineChannel];
  const emailResolver = opts?.emailResolver ?? defaultEmailResolver;
  const lineResolver = opts?.lineResolver ?? defaultLineResolver;

  // 宛先は該当チャネルがあるときだけ解決する（無駄なDBアクセスを避ける）。
  const needsEmail = channels.some((c) => c.name === 'email');
  const needsLine = channels.some((c) => c.name === 'line');
  const [recipientEmails, recipientLineIds] = await Promise.all([
    needsEmail ? emailResolver(event) : Promise.resolve<string[]>([]),
    needsLine ? lineResolver(event) : Promise.resolve<string[]>([]),
  ]);

  const results: ChannelResult[] = [];
  for (const ch of channels) {
    // 宛先の型がチャネルごとに違う（email=メールアドレス / line=LINEユーザーID）ので、
    // チャネル名で渡し分ける。該当しないチャネル（in-app 等）には空配列を渡す。
    const recipients =
      ch.name === 'email' ? recipientEmails : ch.name === 'line' ? recipientLineIds : [];
    try {
      results.push(await ch.send(event, recipients));
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
