import 'server-only';
import Anthropic from '@anthropic-ai/sdk';

/**
 * Claude API のクライアント（サーバー専用）。
 *
 * ★AI機能の共通土台。鍵はサーバーの環境変数だけに置き、ブラウザには絶対に出さない。
 *   NEXT_PUBLIC_ を付けると配られてしまうので、絶対に付けないこと。
 *
 * ★モデルIDに日付を付けない。`claude-haiku-4-5-20251001` のように書くと存在しない
 *   モデル扱いになり、呼び出しが失敗して機能ごと畳まれる（一度これで動かなくなった）。
 *
 * 正典: docs/ai-platform-comparison.md / docs/ai-features-integration-plan.md §5
 */

/**
 * 主力は Haiku、難所だけ Sonnet に上げる方針（共通土台の取り決め）。
 * ヘルプはFAQから選んで写すだけの仕事なので Haiku で足りる。
 */
export const CLAUDE_MODELS = {
  fast: 'claude-haiku-4-5',
  smart: 'claude-sonnet-5',
} as const;

export type ClaudeModel = (typeof CLAUDE_MODELS)[keyof typeof CLAUDE_MODELS];

/** 呼び出せなかった理由。画面と記録で「鍵が無い」と「呼んだが失敗した」を区別するために使う */
export type ClaudeFailureReason =
  | 'not_configured' // 鍵が未設定
  | 'auth' // 鍵が違う・失効
  | 'rate_limit' // 混み合っている
  | 'no_credit' // 残高が足りない（クレジットの購入がまだ）
  | 'workspace_required' // 「すべてのワークスペース」の鍵で、対象ワークスペースの指定が要る
  | 'bad_request' // こちらの投げ方が悪い（モデルID・パラメータなど）
  | 'unavailable'; // 相手側の障害・通信不良

export class ClaudeError extends Error {
  constructor(
    message: string,
    readonly reason: ClaudeFailureReason,
    readonly status?: number,
    /**
     * APIが返した理由の原文。★admin にだけ画面に出す。
     * 原因（モデルIDの誤り・パラメータ違反など）はここにしか書かれていないので、
     * これが見えないと結局サーバーのログを掘ることになる。
     */
    readonly detail?: string
  ) {
    super(message);
    this.name = 'ClaudeError';
  }
}

/** 鍵が設定されているか。未設定なら呼び出し側は機能ごと畳む（エラーにしない） */
export function isClaudeConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new ClaudeError('ANTHROPIC_API_KEY が設定されていません', 'not_configured');
  }
  // 使い回す（毎回作ると接続が再確立される）
  if (client) return client;

  /**
   * ★「すべてのワークスペース」に紐づく鍵（コンソールのタイプ=個人）は、
   *   どのワークスペースで実行するかをヘッダーで渡さないと 400 になる。
   *   ANTHROPIC_WORKSPACE_ID を入れておけばここで付く。
   *   ワークスペース固定の鍵を作った場合は不要（未設定でよい）。
   */
  const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID?.trim();

  client = new Anthropic(
    workspaceId ? { defaultHeaders: { 'anthropic-workspace-id': workspaceId } } : undefined
  );
  return client;
}

/**
 * SDKの例外を、こちらで扱いたい粒度に畳む。
 * ★本文はそのまま外へ出さない。鍵や内部情報が混ざりうるのでログにだけ残す。
 */
function toClaudeError(e: unknown): ClaudeError {
  if (e instanceof ClaudeError) return e;

  if (e instanceof Anthropic.AuthenticationError) {
    console.error('[claude] 認証に失敗しました（鍵が違う・失効している）', e.status, e.message);
    return new ClaudeError('AIの認証に失敗しました', 'auth', e.status, e.message);
  }
  if (e instanceof Anthropic.RateLimitError) {
    console.error('[claude] レート制限', e.status, e.message);
    return new ClaudeError('AIが混み合っています', 'rate_limit', e.status, e.message);
  }
  if (e instanceof Anthropic.BadRequestError || e instanceof Anthropic.NotFoundError) {
    // ★モデルIDの誤りも残高不足もここ（400）に来る。原因が分かるようにメッセージを残す。
    console.error('[claude] リクエストが不正です', e.status, e.message);

    // ★残高不足だけは切り出す。直し方が「クレジットを買う」で全く違ううえ、
    //   前払い制なので初回セットアップで必ず一度は踏む。
    //   文面での判定なので当たらないこともあるが、外しても bad_request に落ちるだけ。
    if (/credit balance|insufficient|too low/i.test(e.message)) {
      return new ClaudeError('AIの残高が足りません', 'no_credit', e.status, e.message);
    }

    // ★「すべてのワークスペース」の鍵は、対象ワークスペースの指定が要る。
    //   直し方が「環境変数を足す」か「ワークスペース固定の鍵を作り直す」で、他の400と全く違う。
    if (/workspace[-_ ]?id/i.test(e.message)) {
      return new ClaudeError(
        'AIのワークスペース指定が要ります',
        'workspace_required',
        e.status,
        e.message
      );
    }
    return new ClaudeError('AIの呼び出し方が不正です', 'bad_request', e.status, e.message);
  }
  if (e instanceof Anthropic.APIError) {
    console.error('[claude] APIエラー', e.status, e.message);
    return new ClaudeError('AIの呼び出しに失敗しました', 'unavailable', e.status, e.message);
  }
  console.error('[claude] 呼び出しに失敗しました', e);
  return new ClaudeError(
    'AIの呼び出しに失敗しました',
    'unavailable',
    undefined,
    e instanceof Error ? e.message : String(e)
  );
}

export interface ClaudeBlock {
  text: string;
  /**
   * true にすると、このブロックまでをプロンプトキャッシュに載せる。
   * 中身が毎回同じで大きいもの（FAQの見出し一覧など）に付ける。
   */
  cache?: boolean;
}

export interface ClaudeCallOptions {
  model?: ClaudeModel;
  /** system は配列で渡す。cache: true のブロックがキャッシュ境界になる */
  system: ClaudeBlock[];
  userText: string;
  maxTokens?: number;
  signal?: AbortSignal;
}

/** 1回だけ叩く。useCache=false のときは cache_control を一切付けない */
async function send(options: ClaudeCallOptions, useCache: boolean): Promise<string> {
  const response = await getClient().messages.create(
    {
      model: options.model ?? CLAUDE_MODELS.fast,
      max_tokens: options.maxTokens ?? 1024,
      system: options.system.map((b) =>
        b.cache && useCache
          ? { type: 'text' as const, text: b.text, cache_control: { type: 'ephemeral' as const } }
          : { type: 'text' as const, text: b.text }
      ),
      messages: [{ role: 'user', content: options.userText }],
    },
    { signal: options.signal }
  );

  return response.content
    .filter((c): c is Anthropic.TextBlock => c.type === 'text')
    .map((c) => c.text)
    .join('');
}

/**
 * プロンプトキャッシュが使えないと分かったら、以後このプロセスでは付けない。
 * 組織の設定は途中で変わらないので、毎回1回目を捨てるのは無駄。
 */
let cacheDisabled = false;

/** Messages API を叩いてテキストを返す */
export async function callClaude(options: ClaudeCallOptions): Promise<string> {
  const wantsCache = options.system.some((b) => b.cache);

  try {
    return await send(options, wantsCache && !cacheDisabled);
  } catch (e) {
    const err = toClaudeError(e);

    /**
     * cache_control が理由で 400 になったときの保険。
     *
     * ★プロンプトキャッシュはリクエストごとに cache_control を付けて使うもので、
     *   コンソールに有効/無効のスイッチがあるわけではない
     *   （コンソールの「プロンプトキャッシュ」カードは使用状況の表示であって設定ではない）。
     *   なのでここが実際に効く場面は多くないが、キャッシュは速度と費用のための飾りであって
     *   機能の前提ではないので、弾かれたら外して通す。
     */
    if (wantsCache && !cacheDisabled && err.reason === 'bad_request' && isCacheRejection(err)) {
      cacheDisabled = true;
      console.warn('[claude] cache_control が弾かれたため、以後キャッシュ無しで呼びます。');
      return await send(options, false);
    }

    throw err;
  }
}

/** 400 の理由がキャッシュまわりかどうか。文面での判定なので、外しても素直に投げ直すだけ */
function isCacheRejection(err: ClaudeError): boolean {
  return /cache/i.test(err.detail ?? '');
}

/**
 * JSONを返させる。
 * ★プレフィル（assistantの書き出しを固定する手）は新しめのモデルでは400になるので使わない。
 *   代わりに「JSONだけを返す」ようプロンプトで指示し、前後の余計な文字はここで落とす。
 * 壊れたJSONなら null（呼び出し側で「答えられない」に倒す）。
 */
export async function callClaudeJson<T>(options: ClaudeCallOptions): Promise<T | null> {
  const raw = await callClaude(options);
  return parseJsonLoose<T>(raw);
}

/**
 * 前置きやコードフェンスが付いていても最初のJSONオブジェクトを取り出す。
 * 素の JSON.parse だけだと、ちょっとした前置きひとつで機能が黙ってしまうため。
 */
export function parseJsonLoose<T>(raw: string): T | null {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    /* 下で拾い直す */
  }

  // ```json ... ``` を剥がす
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim()) as T;
    } catch {
      /* 続ける */
    }
  }

  // 最初の { から最後の } までを試す
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1)) as T;
    } catch {
      /* あきらめる */
    }
  }

  console.error('[claude] JSONとして読めませんでした', trimmed.slice(0, 300));
  return null;
}
