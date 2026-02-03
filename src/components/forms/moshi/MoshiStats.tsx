'use client';

import type { MoshiStats as MoshiStatsType } from '@/types/forms/moshi';

interface MoshiStatsProps {
  stats: MoshiStatsType;
}

export function MoshiStats({ stats }: MoshiStatsProps) {
  return (
    <div className="mb-6 bg-white rounded-xl border border-[#e5e7eb] p-4">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-center">
        <div>
          <p className="text-sm text-[#4b5563]">合計回答数</p>
          <p className="text-xl font-bold text-[#1f2937]">
            {stats.total_responses} 件
          </p>
        </div>
        <div>
          <p className="text-sm text-[#4b5563]">通常受験</p>
          <p className="text-xl font-bold text-[#1f2937]">
            {stats.regular_count} 名
          </p>
        </div>
        <div>
          <p className="text-sm text-[#4b5563]">振替受験</p>
          <p className="text-xl font-bold text-[#1f2937]">
            {stats.furikae_count} 名
          </p>
        </div>
        <div>
          <p className="text-sm text-[#4b5563]">計上済み</p>
          <p className="text-xl font-bold text-[#1f2937]">
            {stats.charged_count} 件
          </p>
        </div>
        <div>
          <p className="text-sm text-[#4b5563]">紐付け済み</p>
          <p className="text-xl font-bold text-[#1f2937]">
            {stats.linked_count} 件
          </p>
        </div>
      </div>
    </div>
  );
}
