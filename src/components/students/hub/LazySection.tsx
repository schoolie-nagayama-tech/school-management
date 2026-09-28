'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

interface LazySectionProps {
  children: ReactNode;
  /** 読み込む前に確保しておく高さの目安（px）。目次から飛んだ先が大きくずれないようにする */
  placeholderHeight?: number;
  /** 画面のどれだけ手前から読み始めるか。既定 400px */
  rootMargin?: string;
}

/**
 * 見えてから中身をマウントする枠。
 *
 * ★なぜ遅延させるか: 生徒ハブは十数セクションあり、各部品がマウントと同時に自分でデータを取りに行く。
 *   全部を一度にマウントすると同時リクエストが一斉に飛び、生徒管理ページで起きた
 *   「同時リクエストで Supabase の接続プールが飽和し、画面全体が遅くなる」事故を繰り返す
 *   （docs/perf-students-top-section-plan.md）。画面に近づいたセクションから順に読むことで、
 *   同時に走るリクエストを数本に抑える。
 * ★一度マウントしたら外さない（スクロールで行き来するたびに取り直すと、かえってリクエストが増える）。
 * IntersectionObserver が無い環境では即マウントする（読めないより遅いほうがよい）。
 */
export function LazySection({
  children,
  placeholderHeight = 240,
  rootMargin = '400px 0px',
}: LazySectionProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (visible) return;
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [visible, rootMargin]);

  if (visible) return <>{children}</>;
  return (
    <div
      ref={ref}
      style={{ minHeight: placeholderHeight }}
      className="flex items-center justify-center text-xs text-text-faint"
      aria-busy="true"
    >
      読み込み待ち
    </div>
  );
}
