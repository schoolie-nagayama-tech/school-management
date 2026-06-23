'use client';

import { Select } from '@/components/ui';
import type { MogiDate, DateVenueSelection, MogiExamType } from '@/types/forms/mogi';
import { MOGI_EXAM_TYPE_LABELS } from '@/types/forms/mogi';

// 種別ごとのヘッダー色（全地域の種別に対応）
const GROUP_HEADER_CLASSES: Record<MogiExamType, string> = {
  toritsu_v: 'text-[#1e40af] bg-[#eff6ff]',
  shiritsu_v: 'text-[#a16207] bg-[#fefce8]',
  jikousakusei: 'text-[#be185d] bg-[#fdf2f8]',
  zenken: 'text-[#047857] bg-[#ecfdf5]',
  tokushoku: 'text-[#7c3aed] bg-[#f5f3ff]',
};

interface DateVenueSelectorProps {
  dates: MogiDate[];
  selections: DateVenueSelection[];
  onChange: (selections: DateVenueSelection[]) => void;
  disabled?: boolean;
}

export function DateVenueSelector({
  dates,
  selections,
  onChange,
  disabled = false,
}: DateVenueSelectorProps) {
  // 指定日付の日程を特定するためのヘルパー（id または exam_type で一意）
  const dateKeyOf = (d: MogiDate) => (d.id.includes('__') ? d.id.split('__')[0] : d.id);

  const handleDateToggle = (date: MogiDate, checked: boolean) => {
    if (checked) {
      // 日程を選択した場合、最初の会場を自動選択
      const firstVenue = date.venues[0];
      if (firstVenue) {
        const newSelection: DateVenueSelection = {
          date_id: date.id,
          date_label: date.label,
          exam_type: date.exam_type,
          exam_type_label: date.exam_type ? MOGI_EXAM_TYPE_LABELS[date.exam_type] : undefined,
          venue_id: firstVenue.id,
          venue_label: firstVenue.label,
        };
        onChange([...selections, newSelection]);
      }
    } else {
      // 日程を解除した場合、その日程の選択を削除
      onChange(selections.filter((s) => s.date_id !== date.id));
    }
  };

  // 同じ日付で他の種別が既に選択されているか
  const getBlockingSelection = (date: MogiDate): DateVenueSelection | null => {
    const key = dateKeyOf(date);
    for (const s of selections) {
      if (s.date_id === date.id) continue; // 自分自身は除外
      const other = dates.find((d) => d.id === s.date_id);
      if (other && dateKeyOf(other) === key) return s;
    }
    return null;
  };

  const handleVenueChange = (dateId: string, venueId: string) => {
    const date = dates.find((d) => d.id === dateId);
    if (!date) return;

    const venue = date.venues.find((v) => v.id === venueId);
    if (!venue) return;

    // 既存の選択を更新
    const updated = selections.map((s) =>
      s.date_id === dateId
        ? {
            ...s,
            venue_id: venue.id,
            venue_label: venue.label,
          }
        : s
    );

    onChange(updated);
  };

  const isDateSelected = (dateId: string) => {
    return selections.some((s) => s.date_id === dateId);
  };

  const getSelectedVenueId = (dateId: string) => {
    const selection = selections.find((s) => s.date_id === dateId);
    return selection?.venue_id || '';
  };

  // 種別ごとにグループ化（全地域の種別をラベル順で、dates にある種別だけ表示）
  const groupedByType: Array<{ type: MogiExamType | null; label: string; dates: MogiDate[] }> = [];
  const allTypes = Object.keys(MOGI_EXAM_TYPE_LABELS) as MogiExamType[];
  for (const type of allTypes) {
    const matched = dates.filter((d) => d.exam_type === type);
    if (matched.length > 0) {
      groupedByType.push({ type, label: MOGI_EXAM_TYPE_LABELS[type], dates: matched });
    }
  }
  const unclassified = dates.filter((d) => !d.exam_type);
  if (unclassified.length > 0) {
    groupedByType.push({ type: null, label: 'その他の日程', dates: unclassified });
  }

  return (
    <div className="space-y-5">
      {groupedByType.map((group) => (
        <div key={group.type ?? 'other'} className="space-y-2">
          <h4
            className={`text-sm font-semibold px-2 py-1 rounded ${
              group.type ? GROUP_HEADER_CLASSES[group.type] : 'text-[#6b7280] bg-[#f3f4f6]'
            }`}
          >
            {group.label}
          </h4>
          <div className="space-y-2">
            {group.dates.map((date) => {
              const isSelected = isDateSelected(date.id);
              const selectedVenueId = getSelectedVenueId(date.id);
              const blocking = !isSelected ? getBlockingSelection(date) : null;
              const isBlocked = !!blocking;

              return (
                <div
                  key={date.id}
                  className={`border rounded-lg p-4 transition-opacity ${
                    isBlocked
                      ? 'border-[#e5e7eb] bg-[#f9fafb] opacity-60'
                      : 'border-[#e5e7eb] bg-white'
                  }`}
                >
                  <div className="flex items-center gap-3 mb-3">
                    <input
                      type="checkbox"
                      id={`date-${date.id}`}
                      checked={isSelected}
                      onChange={(e) => handleDateToggle(date, e.target.checked)}
                      disabled={disabled || isBlocked}
                      className="w-5 h-5 text-[#3b82f6] border-[#e5e7eb] rounded focus:ring-[#3b82f6] disabled:cursor-not-allowed cursor-pointer"
                    />
                    <label
                      htmlFor={`date-${date.id}`}
                      className={`text-base font-medium flex-1 ${
                        isBlocked
                          ? 'text-[#9ca3af] cursor-not-allowed'
                          : 'text-[#1f2937] cursor-pointer'
                      }`}
                    >
                      {date.label}
                    </label>
                  </div>

                  {isBlocked && blocking && (
                    <p className="ml-8 text-xs text-[#6b7280] -mt-1 mb-2">
                      同じ日に
                      <span className="font-medium text-[#4b5563]">
                        「{blocking.exam_type_label ?? 'その他の日程'}」
                      </span>
                      を選択中のため申し込みできません（1日1種別まで）
                    </p>
                  )}

                  {isSelected && (
                    <div className="ml-8 space-y-2">
                      <Select
                        label="会場"
                        value={selectedVenueId}
                        onChange={(e) => handleVenueChange(date.id, e.target.value)}
                        options={[
                          { value: '', label: '選択してください' },
                          ...date.venues.map((venue) => ({ value: venue.id, label: venue.label })),
                        ]}
                        disabled={disabled}
                        required
                      />
                      {(() => {
                        const venue = date.venues.find((v) => v.id === selectedVenueId);
                        if (!venue?.requires_uwabaki) return null;
                        return (
                          <div className="text-xs bg-[#fff7ed] border border-[#fed7aa] text-[#9a3412] rounded px-3 py-2">
                            <span className="font-medium">この会場は上履きが必要です。</span>
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
