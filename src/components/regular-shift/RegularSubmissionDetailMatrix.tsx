'use client';

import type {
  RegularShiftSetting,
  RegularShiftSlotSetting,
  RegularShiftSubmissionSlot,
} from '@/types/regular-shift';

const DAY_LABELS: Record<number, string> = {
  1: '月',
  2: '火',
  3: '水',
  4: '木',
  5: '金',
  6: '土',
};

const DAYS = [1, 2, 3, 4, 5, 6] as const;

function parseTimeSlotLabel(slot: string): { left: string; right: string } {
  const idx = slot.indexOf('-');
  if (idx === -1) return { left: slot, right: '' };
  return { left: slot.slice(0, idx + 1), right: slot.slice(idx + 1) };
}

export interface RegularSubmissionDetailMatrixProps {
  setting: RegularShiftSetting;
  slotSettings: RegularShiftSlotSetting[];
  submissionSlots: RegularShiftSubmissionSlot[];
}

type CellStatus = 'closed' | 'available' | 'unavailable';

export function RegularSubmissionDetailMatrix({
  setting,
  slotSettings,
  submissionSlots,
}: RegularSubmissionDetailMatrixProps) {
  const timeSlots = setting.weekday_slots
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const getCellStatus = (day: number, timeSlot: string): CellStatus => {
    const slotSetting = slotSettings.find((s) => s.day_of_week === day && s.time_slot === timeSlot);
    if (!slotSetting?.is_open) {
      return 'closed';
    }
    const submissionSlot = submissionSlots.find(
      (s) => s.day_of_week === day && s.time_slot === timeSlot
    );
    return submissionSlot?.available ? 'available' : 'unavailable';
  };

  if (timeSlots.length === 0) return null;

  return (
    <div className="overflow-x-auto -mx-1">
      <table className="min-w-full border-collapse text-sm border border-[#e5e7eb]">
        <thead>
          <tr className="bg-[#f9fafb] border-b border-[#e5e7eb]">
            <th className="border border-[#e5e7eb] p-2 text-left font-medium text-[#1f2937] whitespace-nowrap w-16">
              曜日
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
          {DAYS.map((day) => {
            return (
              <tr key={day} className={day === 6 ? 'bg-blue-50/30' : ''}>
                <td className="border border-[#e5e7eb] p-2 whitespace-nowrap font-medium text-[#1f2937]">
                  {DAY_LABELS[day]}
                </td>
                {timeSlots.map((timeSlot) => {
                  const status = getCellStatus(day, timeSlot);
                  return (
                    <td
                      key={`${day}-${timeSlot}`}
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
