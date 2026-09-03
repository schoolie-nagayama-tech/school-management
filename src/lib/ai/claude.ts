/**
 * Claude API の最小クライアント（サーバー専用）。
 *
 * ★AI機能の共通土台の1本目。鍵はサーバーの環境変数だけに置き、ブラウザには絶対に出さない。
 * ★SDKを入れずに fetch で直接叩いている。理由は依存を増やさないことと、
 *   使っているのが Messages API の1エンドポイントだけで、SDKの利点が薄いこと。
 *   プロバイダを差し替えたくなったらこのファイルだけを置き換える。
 *
 * 正典: docs/ai-platform-comparison.md / docs/ai-features-integration-plan.md §5
 */

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

/** 主力は Haiku。難所だけ Sonnet に上げる方針（共通土台の取り決め）。 */
export const CLAUDE_MODELS = {
  fast: 'claude-haiku-4-5-20251001',
  smart: 'claude-sonnet-5',
} as const;

export type ClaudeModel = (typeof CLAUDE_MODELS)[keyof typeof CLAUDE_MODELS];

/** 鍵が設定されているか。未設定なら呼び出し側は機能ごと畳む（エラーにしない） */
export function isClaudeConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
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
  /** 応答の書き出しを固定して、前置きを防ぐ（JSONを返させるときに使う） */
  prefill?: string;
  signal?: AbortSignal;
}

export class ClaudeError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = 'ClaudeError';
  }
}

/** Messages API を1回叩いてテキストを返す */
export async function callClaude(options: ClaudeCallOptions): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new ClaudeError('ANTHROPIC_API_KEY が設定されていません');

  const messages: { role: 'user' | 'assistant'; content: string }[] = [
    { role: 'user', content: options.userText },
  ];
  // prefill を assistant の先頭に置くと、その続きから書き始める
  if (options.prefill) messages.push({ role: 'assistant', content: options.prefill });

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': API_VERSION,
    },
    signal: options.signal,
    body: JSON.stringify({
      model: options.model ?? CLAUDE_MODELS.fast,
      max_tokens: options.maxTokens ?? 1024,
      system: options.system.map((b) =>
        b.cache
          ? { type: 'text', text: b.text, cache_control: { type: 'ephemeral' } }
          : { type: 'text', text: b.text }
      ),
      messages,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    // ★本文をそのまま外に出さない。鍵や内部情報が混ざる可能性があるためログにだけ残す
    console.error('[claude] request failed', res.status, body.slice(0, 500));
    throw new ClaudeError('AIの呼び出しに失敗しました', res.status);
  }

  const json = (await res.json()) as { content?: { type: string; text?: string }[] };
  const text = (json.content ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('');
  return (options.prefill ?? '') + text;
}

/**
 * JSONを返させる。prefill で「{」から書き始めさせ、前置きの文章が混ざるのを防ぐ。
 * 壊れたJSONが返ったら null（呼び出し側で「答えられない」に倒す）。
 */
export async function callClaudeJson<T>(options: ClaudeCallOptions): Promise<T | null> {
  const raw = await callClaude({ ...options, prefill: options.prefill ?? '{' });
  try {
    return JSON.parse(raw) as T;
  } catch {
    // 末尾に余計な文字が付くことがあるので、最後の } までで切って1度だけ試す
    const end = raw.lastIndexOf('}');
    if (end > 0) {
      try {
        return JSON.parse(raw.slice(0, end + 1)) as T;
      } catch {
        /* あきらめる */
      }
    }
    console.error('[claude] JSONとして読めませんでした', raw.slice(0, 300));
    return null;
  }
}
