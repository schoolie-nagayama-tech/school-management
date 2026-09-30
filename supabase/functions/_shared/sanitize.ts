// @ts-nocheck
// ============================================================
// メール本文に差し込む値の無害化・入力検証（Edge Function 共通）
//
// なぜ必要か:
//   メール HTML はテンプレート文字列で組み立てており、生徒名・備考・講師名などの
//   「人が入力した値」をそのまま埋め込んでいた。保護者フォームや講師のシフト提出は
//   未ログインでも書ける経路なので、値に <a href="..."> や <img> を仕込まれると、
//   教室の正規ドメイン(noreply@school-ie.com)から任意の HTML が配信されてしまう
//   （フィッシングリンクの埋め込み）。差し込む値はすべてここを通してエスケープする。
//
// 注意: tsconfig の include が **/*.ts のため、このファイルも CI の型チェック対象に入る。
// Deno 固有の API を使う他の関数ファイルと同じく @ts-nocheck で除外している。
// ============================================================

/**
 * HTML テキスト・属性値のエスケープ。
 * null/undefined は空文字、数値などは文字列化してから処理する
 * （テンプレートに ${undefined} が "undefined" と出ていた既存挙動より安全側）。
 * シングルクォートも潰すのは、属性値を ' で囲む書き方が混ざっても壊れないようにするため。
 */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

/**
 * http(s) の URL だけを通す。それ以外（javascript: / data: / 相対パスなど）は null。
 * href にそのまま入れる値は、エスケープだけでは javascript: スキームを防げないため
 * スキームを明示的に確認する。
 */
export function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.toString()
  } catch {
    return null
  }
}

// 実用上のメールアドレス形式チェック（RFC 完全準拠ではなく、明らかな不正と
// ヘッダーインジェクション（改行・カンマ・山括弧の混入）を弾くのが目的）
const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/

export function isValidEmail(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 254 && EMAIL_RE.test(value)
}

/**
 * 宛先（単一 or 配列）を検証して配列にそろえる。不正なら null。
 * 件数上限を設けるのは、1リクエストで大量の宛先へ送る踏み台にされないため。
 */
export function normalizeRecipients(value: unknown, max: number): string[] | null {
  const list = Array.isArray(value) ? value : [value]
  if (list.length === 0 || list.length > max) return null
  const trimmed = list.map((v) => (typeof v === 'string' ? v.trim() : v))
  if (!trimmed.every(isValidEmail)) return null
  return trimmed as string[]
}
