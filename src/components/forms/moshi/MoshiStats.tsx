'use client';

import type { MoshiStats as MoshiStatsType } from '@/types/forms/moshi';

interface MoshiStatsProps {
  stats: MoshiStatsType;
}

export function MoshiStats({ stats }: MoshiStatsProps) {
  return (
    <div className="mb-6 bg-[#fffffe] rounded-xl border border-[#0d0d0d] p-4">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-center">
        <div>
          <p className="text-sm text-[#2a2a2a]">合計回答数</p>
          <p className="text-xl font-bold text-[#0d0d0d]">
            {stats.total_responses} 件
          </p>
        </div>
        <div>
          <p className="text-sm text-[#2a2a2a]">通常受験</p>
          <p className="text-xl font-bold text-[#0d0d0d]">
            {stats.regular_count} 名
          </p>
        </div>
        <div>
          <p className="text-sm text-[#2a2a2a]">振替受験</p>
          <p className="text-xl font-bold text-[#0d0d0d]">
            {stats.furikae_count} 名
          </p>
        </div>
        <div>
          <p className="text-sm text-[#2a2a2a]">計上済み</p>
          <p className="text-xl font-bold text-[#0d0d0d]">
            {stats.charged_count} 件
          </p>
        </div>
        <div>
          <p className="text-sm text-[#2a2a2a]">紐付け済み</p>
          <p className="text-xl font-bold text-[#0d0d0d]">
            {stats.linked_count} 件
          </p>
        </div>
      </div>
    </div>
  );
}
