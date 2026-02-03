'use client';

import type { MogiStats as MogiStatsType } from '@/types/forms/mogi';

interface MogiStatsProps {
  stats: MogiStatsType;
}

export function MogiStats({ stats }: MogiStatsProps) {
  // すべての会場IDを取得（列ヘッダー用）
  const allVenueIds = new Set<string>();
  stats.date_venue_counts.forEach((date) => {
    date.venue_counts.forEach((venue) => {
      allVenueIds.add(venue.venue_id);
    });
  });

  // 会場IDからラベルへのマッピング
  const venueIdToLabel = new Map<string, string>();
  stats.date_venue_counts.forEach((date) => {
    date.venue_counts.forEach((venue) => {
      if (!venueIdToLabel.has(venue.venue_id)) {
        venueIdToLabel.set(venue.venue_id, venue.venue_label);
      }
    });
  });

  const venueIds = Array.from(allVenueIds);

  return (
    <div className="mb-6 space-y-4">
      {/* 集計サマリー */}
      <div className="bg-white rounded-xl border border-[#e5e7eb] p-4 grid grid-cols-2 md:grid-cols-3 gap-4 text-center">
        <div>
          <p className="text-sm text-[#4b5563]">合計回答数</p>
          <p className="text-xl font-bold text-[#1f2937]">
            {stats.total_responses} 件
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

      {/* 日程・会場別集計テーブル */}
      {stats.date_venue_counts.length > 0 && (
        <div className="bg-white rounded-xl border border-[#e5e7eb] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-[#f3f4f6] border-b border-[#e5e7eb]">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-[#1f2937] uppercase border-r border-[#e5e7eb]">
                    日程
                  </th>
                  {venueIds.map((venueId) => (
                    <th
                      key={venueId}
                      className="px-4 py-3 text-center text-xs font-semibold text-[#1f2937] uppercase border-r border-[#e5e7eb] last:border-r-0"
                    >
                      {venueIdToLabel.get(venueId) || venueId}
                    </th>
                  ))}
                  <th className="px-4 py-3 text-center text-xs font-semibold text-[#1f2937] uppercase">
                    合計
                  </th>
                </tr>
              </thead>
              <tbody>
                {stats.date_venue_counts.map((date) => (
                  <tr
                    key={date.date_id}
                    className="border-b border-[#e5e7eb]/20 hover:bg-[#f3f4f6]"
                  >
                    <td className="px-4 py-3 text-sm font-medium text-[#1f2937] border-r border-[#e5e7eb]/20">
                      {date.date_label}
                    </td>
                    {venueIds.map((venueId) => {
                      const venueCount = date.venue_counts.find(
                        (v) => v.venue_id === venueId
                      );
                      return (
                        <td
                          key={venueId}
                          className="px-4 py-3 text-sm text-center text-[#4b5563] border-r border-[#e5e7eb]/20 last:border-r-0"
                        >
                          {venueCount ? venueCount.count : '-'}
                        </td>
                      );
                    })}
                    <td className="px-4 py-3 text-sm font-medium text-center text-[#1f2937]">
                      {date.total}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
