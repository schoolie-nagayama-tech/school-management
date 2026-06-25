'use client';

import { useState } from 'react';
import type { RegularShiftSetting, RegularShiftSlotSetting } from '@/types/regular-shift';
import { TeacherWorkloadPanel } from '@/components/shift/TeacherWorkloadPanel';

const DAY_LABELS: Record<number, string> = {
  1: '月',
  2: '火',
  3: '水',
  4: '木',
  5: '金',
  6: '土',
};

const DAYS = [1, 2, 3, 4, 5, 6] as const;

/** 0-1 normalized -> shade class */
function getShadeClass(normalized: number, isClosed: boolean): string {
  if (isClosed) return 'bg-slate-100';
  if (normalized < 0.34) return 'bg-slate-100';
  if (normalized < 0.67) return 'bg-slate-200';
  return 'bg-slate-300';
}

export interface RegularTeacherSlotCount {
  teacher_name: string;
  teacher_email: string;
  count: number;
}

export interface RegularOperationsDashboardProps {
  setting: RegularShiftSetting;
  slotSettings: RegularShiftSlotSetting[];
  /** key: "day_of_week|time_slot", value: count of available teachers */
  counts: Record<string, number>;
  teacherSlotCounts?: RegularTeacherSlotCount[];
}

export function RegularOperationsDashboard({
  setting,
  slotSettings,
  counts,
  teacherSlotCounts = [],
}: RegularOperationsDashboardProps) {
  const [isOpen, setIsOpen] = useState(false);
  const timeSlots = setting.weekday_slots
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const isSlotOpen = (day: number, timeSlot: string): boolean => {
    if (slotSettings.length > 0) {
      const slotSetting = slotSettings.find(
        (s) => s.day_of_week === day && s.time_slot === timeSlot
      );
      return slotSetting?.is_open ?? false;
    }
    // Default: weekdays open, Saturday depends on saturday_slots
    if (day === 6) {
      const saturdaySlots = setting.saturday_slots
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      return saturdaySlots.includes(timeSlot);
    }
    return true;
  };

  const getCount = (day: number, timeSlot: string): number => {
    if (!isSlotOpen(day, timeSlot)) return -1;
    return counts[`${day}|${timeSlot}`] ?? 0;
  };

  // Per-column min/max
  const slotMinMax = timeSlots.map((timeSlot) => {
    let min = Infinity;
    let max = -Infinity;
    DAYS.forEach((day) => {
      const c = getCount(day, timeSlot);
      if (c >= 0) {
        min = Math.min(min, c);
        max = Math.max(max, c);
      }
    });
    return {
      min: min === Infinity ? 0 : min,
      max: max === -Infinity ? 0 : max,
    };
  });

  const getNormalized = (day: number, timeSlot: string, slotIdx: number): number => {
    const count = getCount(day, timeSlot);
    if (count < 0) return 0;
    const { min, max } = slotMinMax[slotIdx];
    if (max <= min) return 0;
    return (count - min) / (max - min);
  };

  // Overall average (open cells only)
  let totalSum = 0;
  let totalN = 0;
  DAYS.forEach((day) => {
    timeSlots.forEach((ts) => {
      const c = getCount(day, ts);
      if (c >= 0) {
        totalSum += c;
        totalN++;
      }
    });
  });
  const overallAverage = totalN > 0 ? totalSum / totalN : 0;

  // Attention: cells 40%+ below average
  const isAttention = (day: number, timeSlot: string): boolean => {
    const count = getCount(day, timeSlot);
    if (count < 0) return false;
    return count <= overallAverage * 0.6;
  };

  // Day totals
  const dayTotals = DAYS.map((day) => {
    let sum = 0;
    timeSlots.forEach((ts) => {
      const c = getCount(day, ts);
      if (c >= 0) sum += c;
    });
    return sum;
  });
  const maxDayTotal = Math.max(1, ...dayTotals);

  if (timeSlots.length === 0) return null;

  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 active:bg-slate-200 text-left text-sm font-medium text-slate-700 transition-[background-color] duration-150"
      >
        <span>運営判断用ダッシュボード</span>
        <span className="text-slate-400 text-xs">{isOpen ? '▲ 閉じる' : '▼ 開く'}</span>
      </button>
      {isOpen && (
        // 展開時に feed-card-enter で軽いフェードスライドイン
        <div className="p-4 bg-white feed-card-enter">
          <div className="overflow-x-auto -mx-1">
            <table className="min-w-full border-collapse text-sm border border-slate-200">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="border border-slate-200 p-2 text-left font-medium text-slate-700 whitespace-nowrap w-16">
                    曜日
                  </th>
                  {timeSlots.map((slot, idx) => (
                    <th
                      key={slot}
                      className="border border-slate-200 p-2 text-center font-medium text-slate-700 whitespace-nowrap min-w-[72px]"
                    >
                      <div>{slot}</div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {slotMinMax[idx].min}〜{slotMinMax[idx].max}人
                      </div>
                    </th>
                  ))}
                  <th className="border border-slate-200 p-2 text-center font-medium text-slate-700 whitespace-nowrap w-24">
                    曜日合計
                  </th>
                </tr>
              </thead>
              <tbody>
                {DAYS.map((day, rowIdx) => {
                  const total = dayTotals[rowIdx];
                  return (
                    <tr key={day} className="border-b border-slate-200/60">
                      <td className="border border-slate-200 p-2 whitespace-nowrap font-medium text-slate-700 text-xs">
                        {DAY_LABELS[day]}
                      </td>
                      {timeSlots.map((timeSlot, slotIdx) => {
                        const count = getCount(day, timeSlot);
                        const isClosed = count < 0;
                        const normalized = getNormalized(day, timeSlot, slotIdx);
                        const attention = isAttention(day, timeSlot);
                        const bg = getShadeClass(normalized, isClosed);

                        return (
                          <td
                            key={`${day}-${timeSlot}`}
                            className={`p-1.5 text-center min-w-[56px] relative ${bg} ${
                              attention
                                ? 'border border-dashed border-slate-400'
                                : 'border border-slate-200'
                            }`}
                          >
                            {attention && (
                              <span
                                className="absolute top-0.5 right-1 text-slate-500 text-[10px]"
                                aria-hidden
                              >
                                !
                              </span>
                            )}
                            <span className="text-xs text-slate-700">{isClosed ? '-' : count}</span>
                          </td>
                        );
                      })}
                      <td className="border border-slate-200 p-2">
                        <div className="flex items-center gap-2 min-w-[5rem]">
                          <div className="flex-1 h-4 bg-slate-200 rounded overflow-hidden">
                            <div
                              className="h-full bg-slate-400 rounded"
                              style={{
                                width: `${(total / maxDayTotal) * 100}%`,
                                minWidth: total > 0 ? 4 : 0,
                              }}
                            />
                          </div>
                          <span className="text-xs text-slate-700 tabular-nums w-6">{total}</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <TeacherWorkloadPanel teachers={teacherSlotCounts} />
        </div>
      )}
    </div>
  );
}
