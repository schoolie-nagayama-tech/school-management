'use client';

import { Select } from '@/components/ui';
import type { MogiDate, DateVenueSelection } from '@/types/forms/mogi';

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
  const handleDateToggle = (date: MogiDate, checked: boolean) => {
    if (checked) {
      // 日程を選択した場合、最初の会場を自動選択
      const firstVenue = date.venues[0];
      if (firstVenue) {
        const newSelection: DateVenueSelection = {
          date_id: date.id,
          date_label: date.label,
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

  return (
    <div className="space-y-4">
      {dates.map((date) => {
        const isSelected = isDateSelected(date.id);
        const selectedVenueId = getSelectedVenueId(date.id);

        return (
          <div
            key={date.id}
            className="border border-[#e5e7eb] rounded-lg p-4 bg-white"
          >
            <div className="flex items-center gap-3 mb-3">
              <input
                type="checkbox"
                id={`date-${date.id}`}
                checked={isSelected}
                onChange={(e) => handleDateToggle(date, e.target.checked)}
                disabled={disabled}
                className="w-5 h-5 text-[#3b82f6] border-[#e5e7eb] rounded focus:ring-[#3b82f6] cursor-pointer"
              />
              <label
                htmlFor={`date-${date.id}`}
                className="text-base font-medium text-[#1f2937] cursor-pointer flex-1"
              >
                {date.label}
              </label>
            </div>

            {isSelected && (
              <div className="ml-8">
                <Select
                  label="会場"
                  value={selectedVenueId}
                  onChange={(e) => handleVenueChange(date.id, e.target.value)}
                  options={[
                    { value: '', label: '選択してください' },
                    ...date.venues.map((venue) => ({ value: venue.id, label: venue.label }))
                  ]}
                  disabled={disabled}
                  required
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
