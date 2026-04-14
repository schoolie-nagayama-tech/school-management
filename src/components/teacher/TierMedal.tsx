'use client';

import Link from 'next/link';
import { getTier, getNextTier } from '@/lib/teacher-tier';

interface TierMedalProps {
  count: number;
  /** クリック時の遷移先。省略時は /my/badges。 */
  href?: string;
  className?: string;
}

/**
 * 講師バッジ数に応じて色と演出が変化するメダル。
 * ヘッダー右側に配置する想定。
 */
export function TierMedal({ count, href = '/my/badges', className }: TierMedalProps) {
  const tier = getTier(count);
  const next = getNextTier(count);
  const remaining = next ? next.threshold - count : 0;

  return (
    <Link
      href={href}
      className={`tier-medal tier-medal-${tier.key}${className ? ' ' + className : ''}`}
      title={`獲得バッジ ${count} 個`}
    >
      <span className="tier-medal-ring" aria-hidden />
      <span className="tier-medal-core">
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
          <path
            d="M12 3l2.4 5.6L20 9.5l-4.3 3.7L17 19l-5-3-5 3 1.3-5.8L4 9.5l5.6-.9z"
            fill="currentColor"
          />
        </svg>
      </span>
      <span className="tier-medal-txt">
        <span className="tier-medal-count">{count}</span>
        {next ? (
          <span className="tier-medal-next">
            次まで<b>{remaining}</b>
          </span>
        ) : (
          <span className="tier-medal-next tier-medal-next-max">最高位</span>
        )}
      </span>
    </Link>
  );
}
