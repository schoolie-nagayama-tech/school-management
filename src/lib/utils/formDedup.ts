/**
 * 保護者ポータルのフォーム二重送信判定で使う正規化ユーティリティ。
 *
 * 「送信できたか不安でもう一度送る」ケースを拾うのが目的なので、氏名の空白差やメールの
 * 大文字小文字差は同一人物として扱う。逆に回答内容が違うものは正当な変更・追加申込なので
 * 別物として扱う（＝DBのunique制約でハードに弾かない方針）。
 */

/** 同一内容の再送信を「事故」とみなす時間幅（分） */
export const DUPLICATE_WINDOW_MINUTES = 10;

/** 氏名を比較用に正規化（全角/半角スペースの有無を無視し小文字化） */
export function normalizeFormName(name: string): string {
  // JSの \s は全角スペース(U+3000)も含むので、これだけで全角/半角の差を吸収できる
  return name.replace(/\s+/g, '').trim().toLowerCase();
}

/** メールアドレスを比較用に正規化（前後空白と大文字小文字を無視） */
export function normalizeFormEmail(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase();
}

/**
 * キー順に依存しないJSON文字列化。
 * jsonb はキー順を正規化して保存するため、送信データとDBの値を素の JSON.stringify で
 * 比べると同一内容でも不一致になりうる。比較前に必ずこちらを通すこと。
 */
export function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}
