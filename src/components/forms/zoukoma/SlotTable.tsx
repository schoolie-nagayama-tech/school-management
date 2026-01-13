'use client';

import { useMemo } from 'react';
import type { TimeSlot, ZoukomaSettings } from '@/types/forms/zoukoma';

interface SlotTableProps {
  settings: ZoukomaSettings;
  selectedSlots: string[];
  onChange: (slotIds: string[]) => void;
  disabled?: boolean;
}

export function SlotTable({
  settings,
  selectedSlots,
  onChange,
  disabled = false,
}: SlotTableProps) {
  const selectedSlotSet = useMemo(() => new Set(selectedSlots), [selectedSlots]);

  // 3週間分の日程スロットを生成
  const slots = useMemo(() => {
    // 新形式（schedule）または旧形式（start_date, time_slots）に対応
    const startDateStr = settings.schedule?.start_date || settings.start_date;
    if (!startDateStr) {
      return [];
    }

    const startDate = new Date(startDateStr);
    const slots: TimeSlot[] = [];
    const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const minDaysAhead = settings.schedule?.min_days_ahead ?? 2;
    const minDate = new Date(today);
    minDate.setDate(today.getDate() + minDaysAhead);

    // 新形式の場合
    if (settings.schedule?.periods) {
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

        const isSaturday = dayOfWeek === 6;
        const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
        const isBeforeMinDate = date < minDate;

        // 各時限をチェック
        settings.schedule.periods.forEach((periodConfig) => {
          const period = parseInt(periodConfig.code, 10);
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
    } else {
      // 旧形式（後方互換性のため）
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

        // 土曜は4〜7限、平日は5〜7限
        const periods = dayOfWeek === 6 ? [4, 5, 6, 7] : [5, 6, 7];

        periods.forEach((period) => {
          const slotId = `${date.toISOString().split('T')[0]}_${period}`;
          const timeRange =
            settings.time_slots?.[period.toString() as '4' | '5' | '6' | '7'] ||
            '';
          const dateStr = `${date.getMonth() + 1}/${date.getDate()}`;
          const label = `${dateStr}(${dayName}) ${period}限${timeRange ? ' ' + timeRange : ''}`;

          slots.push({
            id: slotId,
            date: date.toISOString().split('T')[0],
            dayOfWeek: dayName,
            period,
            label,
            timeRange,
            isAvailable: true,
          });
        });
      }
    }

    return slots;
  }, [settings]);

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

  const handleSlotToggle = (slotId: string) => {
    if (disabled) return;

    const newSelected = selectedSlotSet.has(slotId)
      ? Array.from(selectedSlotSet).filter((id) => id !== slotId)
      : [...Array.from(selectedSlotSet), slotId];
    onChange(newSelected);
  };

  const handlePeriodToggle = (date: string, period: number) => {
    if (disabled) return;

    const dateSlots = slotsByDate[date] || [];
    const periodSlots = dateSlots.filter((s) => s.period === period);
    const periodSlotIds = periodSlots.map((s) => s.id);
    const allSelected = periodSlotIds.every((id) => selectedSlotSet.has(id));

    const newSelected = allSelected
      ? Array.from(selectedSlotSet).filter((id) => !periodSlotIds.includes(id))
      : [...Array.from(selectedSlotSet), ...periodSlotIds.filter((id) => !selectedSlotSet.has(id))];
    onChange(newSelected);
  };

  const handleDateToggle = (date: string) => {
    if (disabled) return;

    const dateSlots = slotsByDate[date] || [];
    const dateSlotIds = dateSlots.map((s) => s.id);
    const allSelected = dateSlotIds.every((id) => selectedSlotSet.has(id));

    const newSelected = allSelected
      ? Array.from(selectedSlotSet).filter((id) => !dateSlotIds.includes(id))
      : [...Array.from(selectedSlotSet), ...dateSlotIds.filter((id) => !selectedSlotSet.has(id))];
    onChange(newSelected);
  };

  // 時限（列）全体の全選択/全解除
  const handlePeriodToggleAll = (period: number) => {
    if (disabled) return;

    // その時限の全てのスロットを取得
    const periodSlots = slots.filter((s) => s.period === period);
    const periodSlotIds = periodSlots.map((s) => s.id);
    const allSelected = periodSlotIds.every((id) => selectedSlotSet.has(id));

    const newSelected = allSelected
      ? Array.from(selectedSlotSet).filter((id) => !periodSlotIds.includes(id))
      : [...Array.from(selectedSlotSet), ...periodSlotIds.filter((id) => !selectedSlotSet.has(id))];
    onChange(newSelected);
  };

  // 各時限の選択状態を確認
  const getPeriodSelectionState = (period: number) => {
    const periodSlots = slots.filter((s) => s.period === period);
    if (periodSlots.length === 0) return { allSelected: false, someSelected: false };
    const periodSlotIds = periodSlots.map((s) => s.id);
    const allSelected = periodSlotIds.every((id) => selectedSlotSet.has(id));
    const someSelected = periodSlotIds.some((id) => selectedSlotSet.has(id));
    return { allSelected, someSelected };
  };

  const startDateStr = settings.schedule?.start_date || settings.start_date;
  if (!startDateStr) {
    return (
      <div className="bg-[#eff0f3] rounded-lg border border-[#0d0d0d] p-4 text-center">
        <p className="text-sm text-[#2a2a2a]">日程が設定されていません</p>
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
            {[4, 5, 6, 7].map((period) => {
              const periodState = getPeriodSelectionState(period);
              const hasSlots = slots.some((s) => s.period === period);
              
              return (
                <th key={period} className="border border-[#0d0d0d] px-3 py-2 text-center">
                  {hasSlots ? (
                    <button
                      type="button"
                      onClick={() => handlePeriodToggleAll(period)}
                      className={`text-xs font-medium px-2 py-1 rounded transition-colors ${
                        periodState.allSelected
                          ? 'bg-[#ff8e3c] text-[#0d0d0d]'
                          : periodState.someSelected
                          ? 'bg-[#ff8e3c]/50 text-[#0d0d0d]'
                          : 'text-[#2a2a2a] hover:bg-[#0d0d0d]/10'
                      }`}
                      disabled={disabled}
                      title={`${period}限を全て${periodState.allSelected ? '解除' : '選択'}`}
                    >
                      {period}限
                      {periodState.allSelected && ' ✓'}
                    </button>
                  ) : (
                    <span className="text-xs text-[#2a2a2a]/40">{period}限</span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {Object.entries(slotsByDate).map(([date, dateSlots]) => {
            const dateStr = dateSlots[0]
              ? `${new Date(date).getMonth() + 1}/${new Date(date).getDate()}(${dateSlots[0].dayOfWeek})`
              : date;
            const allDateSelected = dateSlots.every((s) =>
              selectedSlotSet.has(s.id)
            );

            return (
              <tr key={date}>
                <td className="border border-[#0d0d0d] px-3 py-2 sticky left-0 z-10 bg-[#fffffe]">
                  <button
                    type="button"
                    onClick={() => handleDateToggle(date)}
                    className={`text-left font-medium px-2 py-1 rounded transition-colors ${
                      allDateSelected
                        ? 'bg-[#ff8e3c] text-[#0d0d0d]'
                        : 'text-[#2a2a2a] hover:bg-[#0d0d0d]/10'
                    }`}
                    disabled={disabled}
                    title={`この日の全てを${allDateSelected ? '解除' : '選択'}`}
                  >
                    {dateStr}
                    {allDateSelected && ' ✓'}
                  </button>
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

                  const isSelected = selectedSlotSet.has(slot.id);
                  const periodSlots = dateSlots.filter((s) => s.period === period);
                  const allPeriodSelected = periodSlots.every((s) =>
                    selectedSlotSet.has(s.id)
                  );

                  return (
                    <td
                      key={period}
                      className="border border-[#0d0d0d] px-3 py-2 text-center"
                    >
                      <button
                        type="button"
                        onClick={() => handleSlotToggle(slot.id)}
                        disabled={disabled}
                        className={`w-8 h-8 rounded border-2 transition-colors ${
                          isSelected
                            ? 'bg-[#ff8e3c] border-[#0d0d0d]'
                            : 'bg-[#fffffe] border-[#0d0d0d] hover:bg-[#eff0f3]'
                        }`}
                        title={slot.label}
                      >
                        {isSelected ? '✓' : ''}
                      </button>
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
