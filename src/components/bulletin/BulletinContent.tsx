'use client';

import { useEffect, useState } from 'react';
import { isHtmlContent, sanitizeBulletinHtml, toPlainText } from '@/lib/utils/bulletinHtml';

/**
 * 掲示板本文の描画。投稿カードと既読ゲートで共用する。
 *
 * サニタイズ（DOMPurify）はブラウザの DOM が要るため、サーバー描画では実行できない。
 * サーバーでも動かすには jsdom が必要になるが、jsdom は Vercel のランタイムで
 * 読み込めない（lib/utils/bulletinHtml.ts の説明を参照）。
 * そこで初回描画はタグを落としたテキストにし、水和後にサニタイズ済み HTML へ差し替える。
 * mounted フラグを挟むのは、サーバーとクライアント初回描画を一致させて
 * 水和ミスマッチを避けるため。
 */
export function BulletinContent({ content, className }: { content: string; className?: string }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!content) return null;

  // プレーンテキスト投稿はサニタイズ不要（React が自動でエスケープする）
  if (!isHtmlContent(content)) {
    return (
      <div className={className} style={{ whiteSpace: 'pre-wrap' }}>
        {content}
      </div>
    );
  }

  if (!mounted) {
    return (
      <div className={className} style={{ whiteSpace: 'pre-wrap' }}>
        {toPlainText(content)}
      </div>
    );
  }

  return (
    <div
      className={className}
      dangerouslySetInnerHTML={{ __html: sanitizeBulletinHtml(content) }}
    />
  );
}
