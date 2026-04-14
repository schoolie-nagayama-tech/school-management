'use client';

import { BADGE_RANK_CONFIG } from '@/types/database';
import type { BadgeRank } from '@/types/database';

interface BadgeProgressProps {
  earned: number;
  total: number;
  rankCounts?: Partial<Record<BadgeRank, number>>;
}

export function BadgeProgress({ earned, total, rankCounts }: BadgeProgressProps) {
  const pct = total > 0 ? Math.round((earned / total) * 100) : 0;

  return (
    <div className="space-y-3">
      {/* プログレスバー */}
      <div className="flex items-center gap-4">
        <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-sky-500 to-emerald-400 transition-all duration-700 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-sm font-bold text-gray-700 tabular-nums whitespace-nowrap">
          {earned}<span className="text-gray-400 font-normal">/{total}</span>
        </span>
      </div>

      {/* ランク別カウント */}
      {rankCounts && Object.keys(rankCounts).length > 0 && (
        <div className="flex gap-3 flex-wrap">
          {(['platinum', 'gold', 'silver', 'bronze'] as BadgeRank[]).map((rank) => {
            const count = rankCounts[rank];
            if (!count) return null;
            const config = BADGE_RANK_CONFIG[rank];
            return (
              <span
                key={rank}
                className="inline-flex items-center gap-1 text-xs font-medium"
                style={{ color: config.color }}
              >
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: config.color }} />
                {config.label} {count}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
