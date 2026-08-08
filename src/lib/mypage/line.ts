import 'server-only';
import { randomBytes } from 'node:crypto';

/**
 * LINEログイン（OAuth 2.0 / OpenID Connect）のクライアント。
 *
 * 正典: docs/account-line-design.md §4「認証手段の使い分け」・§5 オンボーディング。
 *
 * 設計上の位置づけ:
 *   案3（自前ログイン → 自前署名JWT → RLS）の「自前ログイン」に、ID/PW と並ぶ
 *   2本目の手段として LINE を足すだけ。検証が終わったあとは既存の signPortalJwt /
 *   setPortalSession にそのまま合流するので、セッション以降は1行も変わらない。
 *
 * ★ userId の一致条件（設計の前提。ここが崩れると push が届かない）:
 *   ここで得る `sub`（LINEユーザーID）は、Messaging API 側で push の宛先に使う
 *   userId と同一でなければならない。両者が一致するのは **LINE Login チャネルと
 *   Messaging API チャネルが同一プロバイダー配下にある場合のみ**。別プロバイダーだと
 *   同じ人でも別IDになり、「ログインした保護者に push する」が原理的に成立しない。
 *
 * 機密の扱い:
 *   チャネルシークレットは service_role key 同格。NEXT_PUBLIC_ 禁止・ログ出力禁止。
 *   'server-only' import はクライアントバンドルへの混入をビルド時に弾く保険。
 */

/** LINEの認可エンドポイント（ユーザーをここへリダイレクトする）。 */
const AUTHORIZE_URL = 'https://access.line.me/oauth2/v2.1/authorize';
/** 認可コード → トークン交換。 */
const TOKEN_URL = 'https://api.line.me/oauth2/v2.1/token';
/**
 * ID トークン検証。
 * 自前で JWS 検証せず LINE の検証エンドポイントに委ねる。署名・iss・aud・exp・nonce を
 * まとめて検証してくれるため、自前実装にありがちな検証漏れ（aud未確認など）を構造的に防げる。
 */
const VERIFY_URL = 'https://api.line.me/oauth2/v2.1/verify';

/** コールバックのパス（LINE Developers に登録する URL と一致させること）。 */
export const LINE_CALLBACK_PATH = '/api/mypage/line/callback';

/** LINEログインの設定（環境変数由来）。 */
export interface LineLoginConfig {
  channelId: string;
  channelSecret: string;
}

/** id_token から取り出すプロフィール（PIIは取らない: email スコープは要求しない）。 */
export interface LineProfile {
  /** LINEユーザーID。portal_accounts.line_user_id に入る値。 */
  userId: string;
  /** LINEの表示名。アカウント作成時の display_name の初期値に使う。 */
  displayName: string;
  /** プロフィール画像URL（任意）。 */
  pictureUrl?: string;
}

/**
 * 環境変数から LINEログインの設定を読む。
 * 呼び出し時に読むことで、未設定でもモジュール読み込み自体は失敗させない
 * （LINE未設定の環境でも他のポータル機能が動くようにするため）。
 */
export function getLineLoginConfig(): LineLoginConfig {
  const channelId = process.env.LINE_LOGIN_CHANNEL_ID;
  const channelSecret = process.env.LINE_LOGIN_CHANNEL_SECRET;
  if (!channelId || !channelSecret) {
    throw new Error('LINE_LOGIN_CHANNEL_ID / LINE_LOGIN_CHANNEL_SECRET が設定されていません');
  }
  return { channelId, channelSecret };
}

/** LINEログインが設定済みか（UIでボタンを出すかの判定に使う）。 */
export function isLineLoginConfigured(): boolean {
  return !!(process.env.LINE_LOGIN_CHANNEL_ID && process.env.LINE_LOGIN_CHANNEL_SECRET);
}

/**
 * コールバックURLを組み立てる。
 *
 * 既定はリクエスト元のオリジンから導出する（ローカル http://localhost:3000 と
 * 本番 https://www.school-ie.com を同じコードで扱うため）。
 * LINE 側は「登録済みコールバックURLと完全一致」でなければ弾くので、
 * Host ヘッダを偽装されても未登録URLは LINE が拒否する＝オープンリダイレクトにはならない。
 * 明示指定したい環境のために LINE_LOGIN_REDIRECT_URI での上書きも許す。
 */
export function buildRedirectUri(requestUrl: string): string {
  const override = process.env.LINE_LOGIN_REDIRECT_URI;
  if (override) return override;
  return new URL(LINE_CALLBACK_PATH, new URL(requestUrl).origin).toString();
}

/** CSRF対策の state / リプレイ対策の nonce に使うランダム文字列。 */
export function generateRandomToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * 認可URL（ユーザーをリダイレクトする先）を組み立てる。
 *
 * ★ bot_prompt について:
 *   ログインと同時に「公式アカウントを友だち追加」を促すパラメータ。
 *   push は友だちでないと届かないため、本システムでは既定で aggressive（同意画面に追加を出す）。
 *   **この指定には LINE Developers で「リンクされたLINE公式アカウント」の設定が必要**で、
 *   未設定のまま送ると LINE 側でエラーになる。まだ設定していない環境では
 *   LINE_LOGIN_BOT_PROMPT=off を指定して無効化できる。
 */
export function buildAuthorizeUrl(params: {
  redirectUri: string;
  state: string;
  nonce: string;
}): string {
  const { channelId } = getLineLoginConfig();
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', channelId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('state', params.state);
  url.searchParams.set('nonce', params.nonce);
  // openid = id_token を受け取る / profile = 表示名・画像。email は要求しない（PIIを持たない設計）。
  url.searchParams.set('scope', 'openid profile');

  const botPrompt = process.env.LINE_LOGIN_BOT_PROMPT ?? 'aggressive';
  if (botPrompt !== 'off') {
    url.searchParams.set('bot_prompt', botPrompt);
  }
  return url.toString();
}

/**
 * 認可コードをトークンに交換する。
 * @returns id_token（OpenID Connect のIDトークン）
 */
export async function exchangeCodeForIdToken(params: {
  code: string;
  redirectUri: string;
}): Promise<string> {
  const { channelId, channelSecret } = getLineLoginConfig();

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: params.code,
      redirect_uri: params.redirectUri,
      client_id: channelId,
      client_secret: channelSecret,
    }),
    // トークン交換は毎回実行する（キャッシュ厳禁）。
    cache: 'no-store',
  });

  if (!res.ok) {
    // レスポンス本文にはシークレットは含まれないが、念のため要約だけ投げる。
    const detail = await res.text().catch(() => '');
    throw new Error(`LINEトークン交換に失敗しました (${res.status}) ${detail.slice(0, 200)}`);
  }

  const json = (await res.json()) as { id_token?: string };
  if (!json.id_token) {
    throw new Error('LINEトークン応答に id_token がありません');
  }
  return json.id_token;
}

/**
 * id_token を LINE の検証エンドポイントで検証し、プロフィールを取り出す。
 *
 * nonce を渡すことで「認可開始時に発行した nonce と一致するか」まで LINE 側に検証させる
 * （リプレイ攻撃対策）。aud（＝自分のチャネルID）の検証も LINE 側が行う。
 */
export async function verifyIdToken(params: {
  idToken: string;
  nonce: string;
}): Promise<LineProfile> {
  const { channelId } = getLineLoginConfig();

  const res = await fetch(VERIFY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      id_token: params.idToken,
      client_id: channelId,
      nonce: params.nonce,
    }),
    cache: 'no-store',
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`LINE IDトークンの検証に失敗しました (${res.status}) ${detail.slice(0, 200)}`);
  }

  const json = (await res.json()) as {
    sub?: string;
    name?: string;
    picture?: string;
  };
  if (!json.sub) {
    throw new Error('LINE IDトークンに sub がありません');
  }

  return {
    userId: json.sub,
    // 表示名は取れないこともある（プロフィール非公開など）。その場合の既定値を入れる。
    displayName: json.name?.trim() || 'LINEユーザー',
    pictureUrl: json.picture,
  };
}
