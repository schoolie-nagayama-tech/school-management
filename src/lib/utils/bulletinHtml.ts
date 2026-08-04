import DOMPurify from 'dompurify';

/**
 * 掲示板本文のサニタイズ・判定ユーティリティ。
 * 投稿カード（BulletinPostCard）と既読ゲート（UnreadBulletinGate）の両方で
 * 同じ許可タグ・同じ判定を使うため、ここに一元化する。
 *
 * 【重要】サニタイズはブラウザでのみ行う。
 * 以前は isomorphic-dompurify でサーバー側でもサニタイズしていたが、これは jsdom を
 * サーバーバンドルに引き込む。jsdom の依存には ESM 専用パッケージ（@exodus/bytes・
 * parse5・tough-cookie 等）が多数あり、Vercel のランタイムローダーは require(ESM) に
 * 対応していないため、読み込んだ瞬間に ERR_REQUIRE_ESM で落ちる。
 * UnreadBulletinGate はルートレイアウトに置かれているので、これで全ページの HTML が
 * 500 になった（2026-08-04 の障害）。
 * サーバー描画（水和前）では toPlainText を使うこと。描画の切り替えは BulletinContent。
 */

/** 本文が HTML かどうか（タグを含むか）。プレーンテキスト投稿との描画分岐に使う。 */
export function isHtmlContent(content: string): boolean {
  return /<[a-z][\s\S]*>/i.test(content);
}

const ALLOWED_TAGS = [
  'p',
  'br',
  'strong',
  'b',
  'em',
  'i',
  's',
  'strike',
  'h1',
  'h2',
  'h3',
  'ul',
  'ol',
  'li',
];

/**
 * 掲示板本文のリッチテキストを許可タグのみでサニタイズ（XSS対策）。
 * ブラウザ専用。サーバーで呼ばれた場合はサニタイズできないため、素の HTML は返さず
 * タグを落としたテキストにフォールバックする（未サニタイズの HTML を漏らさないため）。
 */
export function sanitizeBulletinHtml(html: string): string {
  if (typeof window === 'undefined') return toPlainText(html);
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: [],
  });
}

/** タグを落としたプレーンテキスト。サーバー描画・水和前の代替表示に使う。 */
export function toPlainText(html: string): string {
  return html.replace(/<[^>]*>/g, '');
}
