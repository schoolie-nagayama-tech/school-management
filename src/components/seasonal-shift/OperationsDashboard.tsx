'use client';

import { useState } from 'react';
import type { SeasonalShiftSetting, SlotSetting } from '@/types/seasonal-shift';

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

/** 0〜1 を slate-100（少）／200（中）／300（多）にマッピング */
function getShadeClass(normalized: number, isClosed: boolean): string {
  if (isClosed) return 'bg-slate-100';
  if (normalized < 0.34) return 'bg-slate-100';
  if (normalized < 0.67) return 'bg-slate-200';
  return 'bg-slate-300';
}

export interface TeacherSlotCount {
  teacher_name: string;
  teacher_email: string;
  count: number;
}

export interface OperationsDashboardProps {
  setting: SeasonalShiftSetting;
  slotSettings: SlotSetting[];
  counts: Record<string, number>;
  teacherSlotCounts?: TeacherSlotCount[];
}

export function OperationsDashboard({
  setting,
  slotSettings,
  counts,
  teacherSlotCounts = [],
}: OperationsDashboardProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dates = getDatesBetween(setting.start_date, setting.end_date);
  const timeSlots = setting.weekday_slots
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const dayNames = ['日', '月', '火', '水', '木', '金', '土'];

  const isSlotOpen = (date: string, timeSlot: string): boolean => {
    if (slotSettings.length > 0) {
      const slotSetting = slotSettings.find(
        (s) => s.slot_date === date && s.time_slot === timeSlot
      );
      return slotSetting?.is_open ?? false;
    }
    const d = new Date(date + 'T12:00:00');
    const day = d.getDay();
    if (day === 0) return false;
    const saturdaySlots = setting.saturday_slots.split(',').map((s) => s.trim()).filter(Boolean);
    if (day === 6) return saturdaySlots.includes(timeSlot);
    return true;
  };

  const getCount = (date: string, timeSlot: string): number => {
    if (!isSlotOpen(date, timeSlot)) return -1;
    return counts[`${date}|${timeSlot}`] ?? 0;
  };

  // 各コマ（列）ごとに min, max を計算
  const slotMinMax = timeSlots.map((timeSlot) => {
    let min = Infinity;
    let max = -Infinity;
    dates.forEach((date) => {
      const c = getCount(date, timeSlot);
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

  // 各セルの正規化値（0〜1、そのコマ内での相対位置）
  const getNormalized = (date: string, timeSlot: string, slotIdx: number): number => {
    const count = getCount(date, timeSlot);
    if (count < 0) return 0;
    const { min, max } = slotMinMax[slotIdx];
    if (max <= min) return 0;
    return (count - min) / (max - min);
  };

  // 全体平均（開講セルのみ）
  let totalSum = 0;
  let totalN = 0;
  dates.forEach((date) => {
    timeSlots.forEach((ts) => {
      const c = getCount(date, ts);
      if (c >= 0) {
        totalSum += c;
        totalN++;
      }
    });
  });
  const overallAverage = totalN > 0 ? totalSum / totalN : 0;

  // 要注意：全体平均の −40% 以上下回るセル
  const isAttention = (date: string, timeSlot: string): boolean => {
    const count = getCount(date, timeSlot);
    if (count < 0) return false;
    return count <= overallAverage * 0.6;
  };

  // 日合計
  const dayTotals = dates.map((date) => {
    let sum = 0;
    timeSlots.forEach((ts) => {
      const c = getCount(date, ts);
      if (c >= 0) sum += c;
    });
    return sum;
  });
  const maxDayTotal = Math.max(1, ...dayTotals);

  if (dates.length === 0 || timeSlots.length === 0) return null;

  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 text-left text-sm font-medium text-slate-700 transition-colors duration-150"
      >
        <span>運営判断用ダッシュボード</span>
        <span className="text-slate-400 text-xs">
          {isOpen ? '▲ 閉じる' : '▼ 開く'}
        </span>
      </button>
      {isOpen && (
        <div className="p-4 bg-white">
          <div className="overflow-x-auto -mx-1">
            <table className="min-w-full border-collapse text-sm border border-slate-200">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="border border-slate-200 p-2 text-left font-medium text-slate-700 whitespace-nowrap w-24">
                    日付
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
                    日合計
                  </th>
                </tr>
              </thead>
              <tbody>
                {dates.map((dateStr, rowIdx) => {
                  const d = new Date(dateStr + 'T12:00:00');
                  const dayName = dayNames[d.getDay()];
                  const displayDate = `${d.getMonth() + 1}/${d.getDate()}(${dayName})`;
                  const total = dayTotals[rowIdx];

                  return (
                    <tr key={dateStr} className="border-b border-slate-200/60">
                      <td className="border border-slate-200 p-2 whitespace-nowrap font-medium text-slate-700 text-xs">
                        {displayDate}
                      </td>
                      {timeSlots.map((timeSlot, slotIdx) => {
                        const count = getCount(dateStr, timeSlot);
                        const isClosed = count < 0;
                        const normalized = getNormalized(dateStr, timeSlot, slotIdx);
                        const attention = isAttention(dateStr, timeSlot);
                        const bg = getShadeClass(normalized, isClosed);

                        return (
                          <td
                            key={`${dateStr}-${timeSlot}`}
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
                            <span className="text-xs text-slate-700">
                              {isClosed ? '-' : count}
                            </span>
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
                          <span className="text-xs text-slate-700 tabular-nums w-6">
                            {total}
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {teacherSlotCounts.length > 0 && (
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div className="border border-slate-200 rounded-lg p-3 bg-slate-50">
                <div className="font-medium text-slate-700 mb-2">コマ数が多い講師（上位3名）</div>
                <ul className="space-y-1 text-xs text-slate-600">
                  {teacherSlotCounts.slice(0, 3).map((t, i) => (
                    <li key={`top-${i}`}>{t.teacher_name} … {t.count}コマ</li>
                  ))}
                </ul>
              </div>
              <div className="border border-slate-200 rounded-lg p-3 bg-slate-50">
                <div className="font-medium text-slate-700 mb-2">コマ数が少ない講師（下位3名）</div>
                <ul className="space-y-1 text-xs text-slate-600">
                  {teacherSlotCounts.slice(-3).reverse().map((t, i) => (
                    <li key={`bottom-${i}`}>{t.teacher_name} … {t.count}コマ</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
