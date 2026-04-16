/**
 * Notta が Slack に自動投稿するメッセージをパースして
 * notta_transcripts に入れる形に整形する。
 *
 * 想定フォーマット (Slack 直連携):
 *   *<title>*
 *   *日時:* Apr 10,2026 02:29 PM(GMT+0900)
 *   *長さ:* 22min 34s
 *   <url|文字起こしとAI要約を確認>
 *
 *   AI Notes
 *   ...
 *
 * Zapier 経由の場合:
 *   タイトル: <title>
 *   日時: ...
 *   ...
 */

export interface ParsedNottaSlackMessage {
  title: string | null;
  recordedAt: string | null; // ISO
  durationSeconds: number | null;
  audioUrl: string | null;
  summary: string; // AI Notes 部分を整形したもの
}

// タイトル抽出時に「これはタイトルではない」と判定するラベル一覧
const KNOWN_LABELS = ['タイトル', '日時', '長さ', '時間', '録音', '文字起こし', 'AI Notes'];
const LABEL_SPLIT_REGEX = /(?:タイトル|日時|長さ|時間|録音|文字起こし|AI Notes)[:：]?/;

/**
 * Slack の mrkdwn から URL とプレーンテキストを抽出して整形する。
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
 * mrkdwn の bold マーカー (*...*) を除去し、空白を正規化する。
 * タイトル抽出用のクリーンテキストを返す。
 */
function stripBoldMarkers(text: string): string {
  return text
    .replace(/\*+/g, ' ')          // * を空白化
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ');      // 連続スペース圧縮（改行は維持）
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
 */
function parseNottaDate(raw: string): string | null {
  if (!raw) return null;
  const cleaned = raw
    .replace(/\(GMT([+-])(\d{2})(\d{2})\)/, '$1$2:$3')
    .replace(/,(\d)/, ', $1');
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

/**
 * クリーンテキスト（*除去済み）からタイトル候補を抽出する。
 *
 * 優先順:
 *   1. `タイトル: xxx` 形式 (Zapier)
 *   2. 既知ラベル (日時/長さ/…) より前の最初の非空行
 *   3. 既知ラベルで始まらない最初の非空行
 */
function extractTitle(cleanedText: string): string | null {
  // 1) 明示タイトル
  const explicit = cleanedText.match(/タイトル[:：]\s*(.+)/);
  if (explicit) {
    const t = explicit[1].split('\n')[0].trim();
    if (t) return t;
  }

  // 2) 既知ラベルより前の部分（最初の非空行）
  const beforeLabel = cleanedText.split(LABEL_SPLIT_REGEX)[0] || '';
  const beforeLines = beforeLabel
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (beforeLines.length > 0) {
    return beforeLines[0];
  }

  // 3) 最後のフォールバック: 既知ラベルで始まらない最初の行
  const allLines = cleanedText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  for (const line of allLines) {
    const isLabel = KNOWN_LABELS.some((l) => line.startsWith(l));
    if (!isLabel) return line;
  }

  return null;
}

export function parseNottaSlackMessage(rawText: string): ParsedNottaSlackMessage {
  const text = stripSlackFormatting(rawText);
  const cleaned = stripBoldMarkers(text);

  // タイトル抽出
  const rawTitle = extractTitle(cleaned);
  const title = rawTitle
    ? rawTitle.replace(/\s+/g, ' ').trim().slice(0, 200) || null
    : null;

  // 日時 / 長さ（cleaned で * を気にせず抽出）
  const dateMatch = cleaned.match(/日時[:：]\s*(.+?)(?=\s*(?:長さ|時間|文字起こし|AI Notes|\n)|$)/);
  const durMatch = cleaned.match(/(?:長さ|時間)[:：]\s*(.+?)(?=\s*(?:文字起こし|AI Notes|\n)|$)/);

  const recordedAt = dateMatch ? parseNottaDate(dateMatch[1].trim()) : null;
  const durationSeconds = durMatch ? parseDuration(durMatch[1].trim()) : null;

  // 音声URL
  const linkLineMatch = rawText.match(/文字起こしとAI要約を確認[\s\S]*?(<https?:\/\/[^|>]+(?:\|[^>]+)?>|https?:\/\/\S+)/);
  const audioUrl = linkLineMatch
    ? extractFirstUrl(linkLineMatch[1])
    : extractFirstUrl(rawText);

  // AI Notes 以降を summary とする
  const aiIdx = cleaned.indexOf('AI Notes');
  let summary = aiIdx >= 0 ? cleaned.slice(aiIdx + 'AI Notes'.length).trim() : cleaned.trim();
  summary = summary.replace(/^\s+/, '');

  return {
    title,
    recordedAt,
    durationSeconds,
    audioUrl,
    summary,
  };
}
