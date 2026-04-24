'use client';

import type { MogiStats as MogiStatsType, MogiExamType } from '@/types/forms/mogi';
import { MOGI_EXAM_TYPE_LABELS } from '@/types/forms/mogi';

interface MogiStatsProps {
  stats: MogiStatsType;
}

const TYPE_CHIP_CLASS: Record<MogiExamType | 'unclassified', string> = {
  toritsu_v: 'bg-[#eff6ff] text-[#1e40af] border-[#bfdbfe]',
  shiritsu_v: 'bg-[#fefce8] text-[#a16207] border-[#fde68a]',
  jikousakusei: 'bg-[#fdf2f8] text-[#be185d] border-[#fbcfe8]',
  zenken: 'bg-[#ecfdf5] text-[#047857] border-[#a7f3d0]',
  tokushoku: 'bg-[#f5f3ff] text-[#7c3aed] border-[#ddd6fe]',
  unclassified: 'bg-[#f3f4f6] text-[#6b7280] border-[#e5e7eb]',
};

export function MogiStats({ stats }: MogiStatsProps) {
  // 種別ごとにグルーピング（種別順 → 未分類は最後）
  const groups: Array<{
    key: MogiExamType | 'unclassified';
    label: string;
    dates: MogiStatsType['date_venue_counts'];
  }> = [];
  const allTypes = Object.keys(MOGI_EXAM_TYPE_LABELS) as MogiExamType[];
  for (const type of allTypes) {
    const matched = stats.date_venue_counts.filter((d) => d.exam_type === type);
    if (matched.length > 0) groups.push({ key: type, label: MOGI_EXAM_TYPE_LABELS[type], dates: matched });
  }
  const unclassified = stats.date_venue_counts.filter((d) => !d.exam_type);
  if (unclassified.length > 0) {
    groups.push({ key: 'unclassified', label: '未分類', dates: unclassified });
  }

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

      {/* 種別別サマリー */}
      {stats.type_counts && stats.type_counts.length > 0 && (
        <div className="bg-white rounded-xl border border-[#e5e7eb] p-4">
          <p className="text-xs font-semibold text-[#6b7280] uppercase tracking-wider mb-3">
            模試種別ごとの申込数
          </p>
          <div className="flex flex-wrap gap-2">
            {stats.type_counts.map((t) => (
              <span
                key={t.exam_type}
                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm border ${
                  TYPE_CHIP_CLASS[t.exam_type]
                }`}
              >
                <span className="font-medium">{t.label}</span>
                <span className="font-bold">{t.count}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 種別ごと × 日程・会場別集計テーブル */}
      {groups.map((group) => {
        // グループ内で使われている会場を列挙
        const groupVenueIds: string[] = [];
        const groupVenueLabel = new Map<string, string>();
        for (const d of group.dates) {
          for (const v of d.venue_counts) {
            if (!groupVenueLabel.has(v.venue_id)) {
              groupVenueIds.push(v.venue_id);
              groupVenueLabel.set(v.venue_id, v.venue_label);
            }
          }
        }

        return (
          <div
            key={group.key}
            className="bg-white rounded-xl border border-[#e5e7eb] overflow-hidden"
          >
            <div
              className={`px-4 py-2 text-sm font-semibold border-b border-[#e5e7eb] ${
                group.key in MOGI_EXAM_TYPE_LABELS
                  ? TYPE_CHIP_CLASS[group.key as MogiExamType]
                  : TYPE_CHIP_CLASS.unclassified
              }`}
            >
              {group.label}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-[#f3f4f6] border-b border-[#e5e7eb]">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[#1f2937] uppercase border-r border-[#e5e7eb]">
                      日程
                    </th>
                    {groupVenueIds.map((venueId) => (
                      <th
                        key={venueId}
                        className="px-4 py-3 text-center text-xs font-semibold text-[#1f2937] uppercase border-r border-[#e5e7eb] last:border-r-0"
                      >
                        {groupVenueLabel.get(venueId) || venueId}
                      </th>
                    ))}
                    <th className="px-4 py-3 text-center text-xs font-semibold text-[#1f2937] uppercase">
                      合計
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {group.dates.map((date) => (
                    <tr
                      key={date.date_id}
                      className="border-b border-[#e5e7eb]/20 hover:bg-[#f3f4f6]"
                    >
                      <td className="px-4 py-3 text-sm font-medium text-[#1f2937] border-r border-[#e5e7eb]/20">
                        {date.date_label}
                      </td>
                      {groupVenueIds.map((venueId) => {
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
        );
      })}
    </div>
  );
}
