'use client';

import type { SoudanStats as SoudanStatsType } from '@/types/forms/soudan';

interface SoudanStatsProps {
  stats: SoudanStatsType;
}

export function SoudanStats({ stats }: SoudanStatsProps) {
  return (
    <div className="mb-6 space-y-4">
      {/* 集計サマリー */}
      <div className="bg-[#fffffe] rounded-xl border border-[#0d0d0d] p-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
          <div>
            <p className="text-sm text-[#2a2a2a]">合計回答数</p>
            <p className="text-xl font-bold text-[#0d0d0d]">
              {stats.total_responses} 件
            </p>
          </div>
          <div>
            <p className="text-sm text-[#2a2a2a]">対応済み</p>
            <p className="text-xl font-bold text-[#0d0d0d]">
              {stats.handled_count} 件
            </p>
          </div>
          <div>
            <p className="text-sm text-[#2a2a2a]">未対応</p>
            <p className="text-xl font-bold text-[#0d0d0d]">
              {stats.total_responses - stats.handled_count} 件
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

      {/* 相談区分別集計 */}
      {stats.category_counts.length > 0 && (
        <div className="bg-[#fffffe] rounded-xl border border-[#0d0d0d] p-4">
          <h3 className="text-sm font-semibold text-[#0d0d0d] mb-3">相談区分別集計</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {stats.category_counts.map((item) => (
              <div key={item.category} className="text-center">
                <p className="text-xs text-[#2a2a2a] mb-1">{item.category}</p>
                <p className="text-lg font-bold text-[#0d0d0d]">{item.count} 件</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
