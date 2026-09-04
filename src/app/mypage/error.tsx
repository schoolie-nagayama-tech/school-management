'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';

/**
 * 保護者ポータル（/mypage）のエラー境界。
 *
 * ★保護者に内部情報を出さないこと。
 *   ここは塾の外部（保護者のスマホ）から見える画面なので、error.message や
 *   スタックトレースを描画してはいけない。原因の追跡は Sentry 側で行い、
 *   画面には問い合わせ用の digest（不透明なハッシュ）だけを出す。
 *   /portal/error.tsx で同じ事故（スタックトレースを保護者に表示）があったので、
 *   最初からその形に揃えている。
 *
 * ★100%スマホ前提。375px 幅で破綻しないこと。ボタンは指で押せる高さを確保する。
 *   親レイアウトが壊れている可能性もあるので、Tailwind に頼らずインラインスタイルで書く。
 */
export default function MypageError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Hiragino Sans", sans-serif',
        color: '#1f2937',
      }}
    >
      <div style={{ maxWidth: '360px', width: '100%' }}>
        <h1 style={{ fontSize: '18px', fontWeight: 700, margin: '0 0 12px' }}>
          ページを表示できませんでした
        </h1>
        <p style={{ fontSize: '14px', lineHeight: 1.8, margin: '0 0 20px', color: '#4b5563' }}>
          一時的な問題が発生しています。下のボタンからもう一度お試しください。
          繰り返し表示される場合は、お手数ですが教室までご連絡ください。
        </p>

        <button
          onClick={reset}
          style={{
            display: 'block',
            width: '100%',
            minHeight: '48px',
            padding: '12px',
            fontSize: '15px',
            fontWeight: 700,
            color: '#fff',
            background: '#059669',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
          }}
        >
          再読み込み
        </button>

        {error.digest && (
          <p
            style={{
              marginTop: '20px',
              fontSize: '12px',
              color: '#9ca3af',
              textAlign: 'center',
            }}
          >
            お問い合わせ番号: {error.digest}
          </p>
        )}
      </div>
    </div>
  );
}
