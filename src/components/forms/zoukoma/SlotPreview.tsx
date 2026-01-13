'use client';

import { useMemo } from 'react';
import type { ScheduleConfig, TimeSlot } from '@/types/forms/zoukoma';

interface SlotPreviewProps {
  schedule: ScheduleConfig | null;
}

export function SlotPreview({ schedule }: SlotPreviewProps) {
  const slots = useMemo(() => {
    if (!schedule?.start_date) {
      return [];
    }

    const startDate = new Date(schedule.start_date);
    const slots: TimeSlot[] = [];
    const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const minDate = new Date(today);
    minDate.setDate(today.getDate() + schedule.min_days_ahead);

    // 3週間分（21日間）を生成
    for (let day = 0; day < 21; day++) {
      const date = new Date(startDate);
      date.setDate(startDate.getDate() + day);
      const dayOfWeek = date.getDay();
      const dayName = dayNames[dayOfWeek];

      // 日曜は除外
      if (dayOfWeek === 0) {
        continue;
      }

      // 最短日より前は選択不可
      const isBeforeMinDate = date < minDate;

      // 各時限をチェック
      schedule.periods.forEach((periodConfig) => {
        const period = parseInt(periodConfig.code, 10);
        const isSaturday = dayOfWeek === 6;
        const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;

        // 表示条件をチェック
        const shouldShow =
          (isSaturday && periodConfig.available_saturday) ||
          (isWeekday && periodConfig.available_weekday);

        if (!shouldShow) {
          return;
        }

        const slotId = `${date.toISOString().split('T')[0]}_${period}`;
        const timeRange = `${periodConfig.start_time}–${periodConfig.end_time}`;
        const dateStr = `${date.getMonth() + 1}/${date.getDate()}`;
        const label = `${dateStr}(${dayName}) ${period}限 ${timeRange}`;

        slots.push({
          id: slotId,
          date: date.toISOString().split('T')[0],
          dayOfWeek: dayName,
          period,
          label,
          timeRange,
          isAvailable: !isBeforeMinDate,
        });
      });
    }

    return slots;
  }, [schedule]);

  // 日付ごとにグループ化
  const slotsByDate = useMemo(() => {
    const grouped: Record<string, TimeSlot[]> = {};
    slots.forEach((slot) => {
      if (!grouped[slot.date]) {
        grouped[slot.date] = [];
      }
      grouped[slot.date].push(slot);
    });
    return grouped;
  }, [slots]);

  if (!schedule?.start_date) {
    return (
      <div className="bg-[#eff0f3] rounded-lg border border-[#0d0d0d] p-4 text-center">
        <p className="text-sm text-[#2a2a2a]">開始日を設定するとプレビューが表示されます</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse border border-[#0d0d0d] bg-[#fffffe] text-sm">
        <thead>
          <tr className="bg-[#eff0f3]">
            <th className="border border-[#0d0d0d] px-3 py-2 text-left sticky left-0 z-10 bg-[#eff0f3]">
              日付
            </th>
            <th className="border border-[#0d0d0d] px-3 py-2 text-center">4限</th>
            <th className="border border-[#0d0d0d] px-3 py-2 text-center">5限</th>
            <th className="border border-[#0d0d0d] px-3 py-2 text-center">6限</th>
            <th className="border border-[#0d0d0d] px-3 py-2 text-center">7限</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(slotsByDate).map(([date, dateSlots]) => {
            const dateStr = dateSlots[0]
              ? `${new Date(date).getMonth() + 1}/${new Date(date).getDate()}(${dateSlots[0].dayOfWeek})`
              : date;

            return (
              <tr key={date}>
                <td className="border border-[#0d0d0d] px-3 py-2 sticky left-0 z-10 bg-[#fffffe]">
                  <span className="text-sm font-medium text-[#0d0d0d]">
                    {dateStr}
                  </span>
                </td>
                {[4, 5, 6, 7].map((period) => {
                  const slot = dateSlots.find((s) => s.period === period);
                  if (!slot) {
                    return (
                      <td
                        key={period}
                        className="border border-[#0d0d0d] px-3 py-2 text-center bg-[#eff0f3]"
                      ></td>
                    );
                  }

                  return (
                    <td
                      key={period}
                      className="border border-[#0d0d0d] px-3 py-2 text-center"
                    >
                      <div
                        className={`inline-block px-2 py-1 rounded text-xs ${
                          slot.isAvailable
                            ? 'bg-[#ff8e3c] text-[#0d0d0d]'
                            : 'bg-[#eff0f3] text-[#2a2a2a] opacity-50'
                        }`}
                        title={slot.label}
                      >
                        {slot.timeRange}
                      </div>
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
