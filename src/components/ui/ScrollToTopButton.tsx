'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronUp } from 'lucide-react';

interface ScrollToTopButtonProps {
  /** このスクロール量(px)を超えたときだけ表示対象になる。既定600 */
  threshold?: number;
  /** ページ固有の位置調整などを足したいとき用 */
  className?: string;
}

/** スクロールが止まったと判定するまでの待ち時間(ms) */
const IDLE_DELAY_MS = 250;

/**
 * ページ最下部中央に「うっすら」現れる、先頭へ戻るボタン。
 *
 * 縦に長いページ（生徒管理など）で下まで行くと先頭に戻る手段が無くなるため用意した。
 * 汎用コンポーネントなので、他ページでもそのまま置くだけで使える。
 */
export function ScrollToTopButton({ threshold = 600, className = '' }: ScrollToTopButtonProps) {
  const [visible, setVisible] = useState(false);
  const rafRef = useRef<number | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // スクロール中は隠す意図:
    // 画面中央下に常時浮いていると、読んでいる本文やテーブルの最終行に重なって邪魔になる。
    // 「手を止めた人にだけ静かに現れる」ほうが、常時表示より視界のノイズが少ない。
    const handleScroll = () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);

      // スクロール中の非表示化は requestAnimationFrame で間引く（scroll は高頻度に飛ぶため）
      if (rafRef.current === null) {
        rafRef.current = window.requestAnimationFrame(() => {
          rafRef.current = null;
          setVisible(false);
        });
      }

      // 停止判定は setTimeout。一定時間 scroll が来なければ「止まった」とみなす。
      idleTimerRef.current = setTimeout(() => {
        idleTimerRef.current = null;
        // 先頭付近まで戻っているなら、そもそも出す必要がない
        setVisible(window.scrollY > threshold);
      }, IDLE_DELAY_MS);
    };

    // ブラウザがスクロール位置を復元した状態で開かれることがある（リロード・戻る）。
    // その場合 scroll イベントは飛ばないので、マウント時に一度だけ判定しておく。
    setVisible(window.scrollY > threshold);

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [threshold]);

  const handleClick = useCallback(() => {
    // 視覚効果を減らす設定の人にはスムーススクロールを使わない
    const prefersReduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: prefersReduced ? 'auto' : 'smooth' });
  }, []);

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label="ページの先頭へ戻る"
      title="ページの先頭へ戻る"
      className={[
        // モバイルは下部ナビ(MobileBottomNav: fixed bottom-0 / 中身 h-14 + safe-area)があるため、
        // その分だけ上にずらして重ならないようにする。lg 以上ではナビが無いので素直に 20px。
        'fixed left-1/2 -translate-x-1/2 z-20 print:hidden',
        'bottom-[calc(3.5rem+env(safe-area-inset-bottom,0px)+0.75rem)] lg:bottom-5',
        'flex h-10 w-10 items-center justify-center rounded-full',
        'border border-border bg-surface/80 backdrop-blur-sm shadow-sm',
        'transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none',
        'hover:opacity-100 focus-visible:opacity-100',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-ink/30',
        // 隠れている間は invisible にして、タブ順に「見えないボタン」が残らないようにする
        visible
          ? 'visible translate-y-0 opacity-[0.55]'
          : 'invisible translate-y-1 opacity-0 pointer-events-none',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <ChevronUp className="h-5 w-5 text-text-body" />
    </button>
  );
}
