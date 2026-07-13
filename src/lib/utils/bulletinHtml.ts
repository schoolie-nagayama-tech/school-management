import DOMPurify from 'isomorphic-dompurify';

/**
 * 掲示板本文のサニタイズ・判定ユーティリティ。
 * 投稿カード（BulletinPostCard）と既読ゲート（UnreadBulletinGate）の両方で
 * 同じ許可タグ・同じ判定を使うため、ここに一元化する。
 */

/** 本文が HTML かどうか（タグを含むか）。プレーンテキスト投稿との描画分岐に使う。 */
export function isHtmlContent(content: string): boolean {
  return /<[a-z][\s\S]*>/i.test(content);
}

/** 掲示板本文のリッチテキストを許可タグのみでサニタイズ（XSS対策） */
export function sanitizeBulletinHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
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
    ],
    ALLOWED_ATTR: [],
  });
}
