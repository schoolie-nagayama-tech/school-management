/**
 * Notta が Slack に自動投稿するメッセージをパースして
 * notta_transcripts に入れる形に整形する。
 *
 * 想定フォーマット:
 *   タイトル: <title>
 *   日時: Apr 10,2026 02:29 PM(GMT+0900)
 *   長さ: 22min 34s
 *   文字起こしとAI要約を確認  ← link (audio_url)
 *
 *   AI Notes
 *
 *   前回の確認
 *   ...
 *   塾からの報告
 *   ...
 *   （以下セクション続く）
 */

export interface ParsedNottaSlackMessage {
  title: string | null;
  recordedAt: string | null; // ISO
  durationSeconds: number | null;
  audioUrl: string | null;
  summary: string; // AI Notes 部分を整形したもの
}

/**
 * Slack の mrkdwn から URL とプレーンテキストを抽出して整形する。
 * `<https://url|label>` → `label (https://url)` 形式ではなく、
 * Notta のリンクは "文字起こしとAI要約を確認" の直後に現れるため別途抽出する。
 */
function stripSlackFormatting(text: string): string {
  return text
    // <url|label> → label
    .replace(/<([^|>]+)\|([^>]+)>/g, '$2')
    // <url> → url
    .replace(/<(https?:[^>]+)>/g, '$1')
    // &lt; &gt; &amp;
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * メッセージ中から最初に現れる http(s) URL を取得する。
 * Slack の `<url|label>` 形式にも対応。
 */
function extractFirstUrl(raw: string): string | null {
  const slackLink = raw.match(/<(https?:\/\/[^|>]+)(?:\|[^>]+)?>/);
  if (slackLink) return slackLink[1];
  const plain = raw.match(/https?:\/\/\S+/);
  return plain ? plain[0] : null;
}

/**
 * "Apr 10,2026 02:29 PM(GMT+0900)" のような表記を ISO 8601 に変換する。
 * 失敗したら null。
 */
function parseNottaDate(raw: string): string | null {
  if (!raw) return null;
  // タイムゾーン部 (GMT+0900) を +09:00 形式に直す
  const cleaned = raw
    .replace(/\(GMT([+-])(\d{2})(\d{2})\)/, '$1$2:$3')
    .replace(/,(\d)/, ', $1'); // "10,2026" → "10, 2026"
  const d = new Date(cleaned);
  if (!isNaN(d.getTime())) return d.toISOString();
  return null;
}

/**
 * "22min 34s" / "1h 5min" / "45s" → 秒数
 */
function parseDuration(raw: string): number | null {
  if (!raw) return null;
  let seconds = 0;
  const h = raw.match(/(\d+)\s*h/);
  const m = raw.match(/(\d+)\s*min/);
  const s = raw.match(/(\d+)\s*s(?!\w)/);
  if (h) seconds += parseInt(h[1], 10) * 3600;
  if (m) seconds += parseInt(m[1], 10) * 60;
  if (s) seconds += parseInt(s[1], 10);
  return seconds > 0 ? seconds : null;
}

export function parseNottaSlackMessage(rawText: string): ParsedNottaSlackMessage {
  const text = stripSlackFormatting(rawText);

  // Slack 版は「タイトル:」ラベルが無く、bold (*...*) がタイトル。
  // `日時:` より前の部分からタイトルを抽出する。
  // Zapier 版は `タイトル: xxx` 形式なので両方対応。
  let title: string | null = null;
  const explicitTitle = text.match(/タイトル[:：]\s*(.+)/);
  if (explicitTitle) {
    title = explicitTitle[1].trim();
  } else {
    // `日時:` より前の文字列をタイトル候補とする
    const beforeDate = text.split(/\*?\s*日時[:：]/)[0] || '';
    const cleaned = beforeDate
      .replace(/\*/g, ' ') // mrkdwn の bold 記号を除去
      .replace(/\s+/g, ' ') // 連続空白を圧縮
      .trim();
    if (cleaned) title = cleaned;
  }

  // 日時: 次のラベル(`長さ`) or `文字起こし` or 改行まで
  const dateMatch = text.match(/日時[:：]\*?\s*(.+?)(?=\*?\s*(?:長さ|文字起こし|\n)|$)/);
  const durMatch = text.match(/長さ[:：]\*?\s*(.+?)(?=\*?\s*(?:文字起こし|AI Notes|\n)|$)/);

  const recordedAt = dateMatch ? parseNottaDate(dateMatch[1].replace(/\*/g, '').trim()) : null;
  const durationSeconds = durMatch ? parseDuration(durMatch[1].replace(/\*/g, '').trim()) : null;

  // 音声URL: "文字起こしとAI要約を確認" 行のリンク、または先頭部で最初に見つかる URL
  const linkLineMatch = rawText.match(/文字起こしとAI要約を確認[\s\S]*?(<https?:\/\/[^|>]+(?:\|[^>]+)?>|https?:\/\/\S+)/);
  const audioUrl = linkLineMatch
    ? extractFirstUrl(linkLineMatch[1])
    : extractFirstUrl(rawText);

  // AI Notes 以降を summary とする。見つからなければ全文。
  const aiIdx = text.indexOf('AI Notes');
  let summary = aiIdx >= 0 ? text.slice(aiIdx + 'AI Notes'.length).trim() : text.trim();

  // 冒頭の空行を整理
  summary = summary.replace(/^\s+/, '');

  return {
    title,
    recordedAt,
    durationSeconds,
    audioUrl,
    summary,
  };
}
