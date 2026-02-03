'use client';

import type { YoubiStats as YoubiStatsType } from '@/types/forms/youbi';

interface YoubiStatsProps {
  stats: YoubiStatsType;
}

export function YoubiStats({ stats }: YoubiStatsProps) {
  return (
    <div className="mb-6">
      <div className="bg-white rounded-xl border border-[#e5e7eb] p-4">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-center">
          <div>
            <p className="text-sm text-[#4b5563]">合計申請数</p>
            <p className="text-xl font-bold text-[#1f2937]">
              {stats.total_responses} 件
            </p>
          </div>
          <div>
            <p className="text-sm text-[#4b5563]">対応済み</p>
            <p className="text-xl font-bold text-[#1f2937]">
              {stats.handled_count} 件
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
    </div>
  );
}
