'use client';

import type {
  SeasonalShiftSetting,
  SlotSetting,
  SeasonalShiftSubmissionSlot,
} from '@/types/seasonal-shift';

function getDatesBetween(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const d = new Date(startDate);
  const end = new Date(endDate);
  while (d <= end) {
    dates.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

/** 時間帯表示用 "12:50-14:20" -> { left: "12:50-", right: "14:20" } */
function parseTimeSlotLabel(slot: string): { left: string; right: string } {
  const idx = slot.indexOf('-');
  if (idx === -1) return { left: slot, right: '' };
  return { left: slot.slice(0, idx + 1), right: slot.slice(idx + 1) };
}

export interface SubmissionDetailMatrixProps {
  setting: SeasonalShiftSetting;
  slotSettings: SlotSetting[];
  submissionSlots: SeasonalShiftSubmissionSlot[];
}

type CellStatus = 'closed' | 'available' | 'unavailable';

export function SubmissionDetailMatrix({
  setting,
  slotSettings,
  submissionSlots,
}: SubmissionDetailMatrixProps) {
  const dates = getDatesBetween(setting.start_date, setting.end_date);
  const timeSlots = setting.weekday_slots
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const dayNames = ['日', '月', '火', '水', '木', '金', '土'];

  const getCellStatus = (date: string, timeSlot: string): CellStatus => {
    const slotSetting = slotSettings.find((s) => s.slot_date === date && s.time_slot === timeSlot);
    if (!slotSetting?.is_open) {
      return 'closed';
    }
    const submissionSlot = submissionSlots.find(
      (s) => s.shift_date === date && s.time_slot === timeSlot
    );
    return submissionSlot?.available ? 'available' : 'unavailable';
  };

  if (dates.length === 0 || timeSlots.length === 0) return null;

  // 縦形式：日付を行、時間帯を列にする（縦長で見やすい）
  return (
    <div className="overflow-x-auto -mx-1">
      <table className="min-w-full border-collapse text-sm border border-[#e5e7eb]">
        <thead>
          <tr className="bg-[#f9fafb] border-b border-[#e5e7eb]">
            <th className="border border-[#e5e7eb] p-2 text-left font-medium text-[#1f2937] whitespace-nowrap w-24">
              日付
            </th>
            {timeSlots.map((slot) => {
              const { left, right } = parseTimeSlotLabel(slot);
              return (
                <th
                  key={slot}
                  className="border border-[#e5e7eb] p-2 text-center font-medium text-[#1f2937] whitespace-nowrap min-w-[72px]"
                >
                  <div className="flex flex-col items-center gap-0.5">
                    <span className="text-xs">{left}</span>
                    <span className="text-xs text-[#6b7280]">{right}</span>
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {dates.map((dateStr) => {
            const d = new Date(dateStr + 'T12:00:00');
            const dayOfWeek = d.getDay();
            const dayName = dayNames[dayOfWeek];
            const displayDate = `${d.getMonth() + 1}/${d.getDate()}(${dayName})`;

            return (
              <tr
                key={dateStr}
                className={
                  dayOfWeek === 0 ? 'bg-blue-50/50' : dayOfWeek === 6 ? 'bg-blue-50/30' : ''
                }
              >
                <td className="border border-[#e5e7eb] p-2 whitespace-nowrap font-medium text-[#1f2937]">
                  {displayDate}
                </td>
                {timeSlots.map((timeSlot) => {
                  const status = getCellStatus(dateStr, timeSlot);
                  return (
                    <td
                      key={`${dateStr}-${timeSlot}`}
                      className={`border border-[#e5e7eb] p-2 text-center ${
                        status === 'closed'
                          ? 'bg-gray-100 text-gray-400'
                          : status === 'available'
                            ? 'bg-green-100 text-green-600 font-bold'
                            : 'bg-white'
                      }`}
                    >
                      {status === 'closed' ? '-' : status === 'available' ? '✓' : ''}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
