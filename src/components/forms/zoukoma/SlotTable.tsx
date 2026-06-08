'use client';

import { useMemo } from 'react';
import type { TimeSlot, ZoukomaSettings, PeriodConfig } from '@/types/forms/zoukoma';

/** ローカル日付で YYYY-MM-DD を返す（toISOString は UTC 変換するため JST では前日になり、
 *  getDay() で取った曜日と1日ずれてしまうので使わない） */
function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** YYYY-MM-DD 文字列をローカル日付として Date に戻す。new Date(str) だと UTC 解釈になる */
function parseLocalDateStr(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** 期間設定が未登録のときに使うデフォルト時限（平日のみ・土日なし） */
const DEFAULT_PERIODS_FALLBACK: PeriodConfig[] = [
  { code: '5', start_time: '16:20', end_time: '17:50', available_saturday: false, available_sunday: false, available_weekday: true },
  { code: '6', start_time: '17:55', end_time: '19:25', available_saturday: false, available_sunday: false, available_weekday: true },
  { code: '7', start_time: '19:30', end_time: '21:00', available_saturday: false, available_sunday: false, available_weekday: true },
];

/** 増コマフォームで表示する日程のデフォルト週数（保護者側で増減可能） */
export const DEFAULT_WEEKS = 3;

/** 設定から指定週数分の全スロットを生成（SlotTable 外からも利用可能）。
 *  numWeeks 未指定時は従来どおり3週間。保護者が「+1週間」した場合は呼び出し側で週数を渡す。 */
export function generateAllSlots(
  settings: ZoukomaSettings,
  numWeeks: number = DEFAULT_WEEKS
): TimeSlot[] {
  const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const minDaysAhead = settings.schedule?.min_days_ahead ?? 0;
  const minDate = new Date(today);
  minDate.setDate(today.getDate() + minDaysAhead);

  const startDate = new Date(today);
  const slots: TimeSlot[] = [];

  const periodsToUse: PeriodConfig[] =
    settings.schedule?.periods?.length
      ? settings.schedule.periods
      : DEFAULT_PERIODS_FALLBACK;

  // 表示日数 = 週数 × 7。週数は最低1週間を保証
  const totalDays = Math.max(1, numWeeks) * 7;

  for (let day = 0; day < totalDays; day++) {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + day);
    const dayOfWeek = date.getDay();
    const dayName = dayNames[dayOfWeek];

    const isSunday = dayOfWeek === 0;
    const isSaturday = dayOfWeek === 6;
    const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
    const isBeforeMinDate = date < minDate;

    periodsToUse.forEach((periodConfig) => {
      const period = parseInt(periodConfig.code, 10);
      const satOk = periodConfig.available_saturday ?? false;
      const sunOk = periodConfig.available_sunday ?? false;
      const weekdayOk = periodConfig.available_weekday ?? false;
      const shouldShow =
        (isSunday && sunOk) ||
        (isSaturday && satOk) ||
        (isWeekday && weekdayOk);

      if (!shouldShow) return;

      const slotId = `${toLocalDateStr(date)}_${period}`;
      const timeRange = `${periodConfig.start_time}–${periodConfig.end_time}`;
      const dateStr = `${date.getMonth() + 1}/${date.getDate()}`;
      const label = `${dateStr}(${dayName}) ${period}限 ${timeRange}`;

      slots.push({
        id: slotId,
        date: toLocalDateStr(date),
        dayOfWeek: dayName,
        period,
        label,
        timeRange,
        isAvailable: !isBeforeMinDate,
      });
    });
  }

  return slots;
}

interface SlotTableProps {
  settings: ZoukomaSettings;
  selectedSlots: string[];
  onChange: (slotIds: string[]) => void;
  disabled?: boolean;
  /** 'available' = 出席可能を選択（従来）, 'unavailable' = 出席できない日にバツ印 */
  mode?: 'available' | 'unavailable';
  /** 表示する週数（保護者側で増減可能）。未指定時はデフォルト3週間 */
  numWeeks?: number;
}

export function SlotTable({
  settings,
  selectedSlots,
  onChange,
  disabled = false,
  mode = 'available',
  numWeeks = DEFAULT_WEEKS,
}: SlotTableProps) {
  const isUnavailableMode = mode === 'unavailable';
  const selectedSlotSet = useMemo(() => new Set(selectedSlots), [selectedSlots]);

  // 入力日から指定週数分の日程スロットを生成（期間設定がなくてもデフォルト時限で表示）
  const slots = useMemo(() => generateAllSlots(settings, numWeeks), [settings, numWeeks]);

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

  // 未使用の関数（将来の機能拡張用）
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _handlePeriodToggle = (date: string, period: number) => {
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

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse border border-[#e5e7eb] bg-white text-sm">
        <thead>
          <tr className="bg-[#f3f4f6]">
            <th className="border border-[#e5e7eb] px-3 py-2 text-left sticky left-0 z-10 bg-[#f3f4f6]">
              日付
            </th>
            {[4, 5, 6, 7].map((period) => {
              const periodState = getPeriodSelectionState(period);
              const hasSlots = slots.some((s) => s.period === period);
              
              return (
                <th key={period} className="border border-[#e5e7eb] px-3 py-2 text-center">
                  {hasSlots ? (
                    <button
                      type="button"
                      onClick={() => handlePeriodToggleAll(period)}
                      className={`text-xs font-medium px-2 py-1 rounded transition-colors ${
                        periodState.allSelected
                          ? isUnavailableMode
                            ? 'bg-[#ef4444] text-white'
                            : 'bg-[#3b82f6] text-white'
                          : periodState.someSelected
                          ? isUnavailableMode
                            ? 'bg-[#ef4444]/50 text-[#1f2937]'
                            : 'bg-[#3b82f6]/50 text-[#1f2937]'
                          : 'text-[#4b5563] hover:bg-[#e5e7eb]'
                      }`}
                      disabled={disabled}
                      title={`${period}限を全て${periodState.allSelected ? '解除' : isUnavailableMode ? '✗にする' : '選択'}`}
                    >
                      {period}限
                      {periodState.allSelected && (isUnavailableMode ? ' ✗' : ' ✓')}
                    </button>
                  ) : (
                    <span className="text-xs text-[#4b5563]/40">{period}限</span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {Object.entries(slotsByDate).map(([date, dateSlots]) => {
            const dateStr = dateSlots[0]
              ? (() => {
                  // date は toLocalDateStr で作ったローカル日付文字列。new Date(str) だと UTC 解釈で
                  // JST では前日扱いになりうるため、明示的にローカル日付へ戻す
                  const d = parseLocalDateStr(date);
                  return `${d.getMonth() + 1}/${d.getDate()}(${dateSlots[0].dayOfWeek})`;
                })()
              : date;
            const allDateSelected = dateSlots.every((s) =>
              selectedSlotSet.has(s.id)
            );

            return (
              <tr key={date}>
                <td className="border border-[#e5e7eb] px-3 py-2 sticky left-0 z-10 bg-white">
                  <button
                    type="button"
                    onClick={() => handleDateToggle(date)}
                    className={`text-left font-medium px-2 py-1 rounded transition-colors ${
                      allDateSelected
                        ? isUnavailableMode
                          ? 'bg-[#ef4444] text-white'
                          : 'bg-[#3b82f6] text-white'
                        : 'text-[#4b5563] hover:bg-[#e5e7eb]'
                    }`}
                    disabled={disabled}
                    title={`この日の全てを${allDateSelected ? '解除' : isUnavailableMode ? '✗にする' : '選択'}`}
                  >
                    {dateStr}
                    {allDateSelected && (isUnavailableMode ? ' ✗' : ' ✓')}
                  </button>
                </td>
                {[4, 5, 6, 7].map((period) => {
                  const slot = dateSlots.find((s) => s.period === period);
                  if (!slot) {
                    return (
                      <td
                        key={period}
                        className="border border-[#e5e7eb] px-3 py-2 text-center bg-[#f3f4f6]"
                      ></td>
                    );
                  }

                  const isSelected = selectedSlotSet.has(slot.id);
                  const periodSlots = dateSlots.filter((s) => s.period === period);
                  // eslint-disable-next-line @typescript-eslint/no-unused-vars
                  const _allPeriodSelected = periodSlots.every((s) =>
                    selectedSlotSet.has(s.id)
                  );

                  return (
                    <td
                      key={period}
                      className="border border-[#e5e7eb] px-3 py-2 text-center"
                    >
                      <button
                        type="button"
                        onClick={() => handleSlotToggle(slot.id)}
                        disabled={disabled}
                        className={`w-8 h-8 rounded border-2 transition-colors ${
                          isSelected
                            ? isUnavailableMode
                              ? 'bg-[#ef4444] border-[#ef4444] text-white'
                              : 'bg-[#3b82f6] border-[#e5e7eb]'
                            : 'bg-white border-[#e5e7eb] hover:bg-[#f3f4f6]'
                        }`}
                        title={slot.label}
                      >
                        {isSelected ? (isUnavailableMode ? '✗' : '✓') : ''}
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
