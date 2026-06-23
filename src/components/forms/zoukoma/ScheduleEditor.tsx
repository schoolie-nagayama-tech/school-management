'use client';

import { useState } from 'react';
import { Input, Button } from '@/components/ui';
import type { PeriodConfig, ScheduleConfig } from '@/types/forms/zoukoma';

interface ScheduleEditorProps {
  schedule: ScheduleConfig | null;
  onChange: (schedule: ScheduleConfig) => void;
  disabled?: boolean;
}

const DEFAULT_PERIODS: PeriodConfig[] = [
  {
    code: '4',
    start_time: '14:25',
    end_time: '15:55',
    available_saturday: false,
    available_sunday: false,
    available_weekday: false,
  },
  {
    code: '5',
    start_time: '16:20',
    end_time: '17:50',
    available_saturday: false,
    available_sunday: false,
    available_weekday: true,
  },
  {
    code: '6',
    start_time: '17:55',
    end_time: '19:25',
    available_saturday: false,
    available_sunday: false,
    available_weekday: true,
  },
  {
    code: '7',
    start_time: '19:30',
    end_time: '21:00',
    available_saturday: false,
    available_sunday: false,
    available_weekday: true,
  },
];

export function ScheduleEditor({ schedule, onChange, disabled = false }: ScheduleEditorProps) {
  const [startDate, setStartDate] = useState(schedule?.start_date || '');
  const [minDaysAhead, setMinDaysAhead] = useState(schedule?.min_days_ahead ?? 0);
  const [periods, setPeriods] = useState<PeriodConfig[]>(() => {
    const raw = schedule?.periods || DEFAULT_PERIODS;
    return raw.map((p) => ({
      ...p,
      available_saturday: p.available_saturday ?? false,
      available_sunday: p.available_sunday ?? false,
    }));
  });

  const emitSchedule = (
    nextStartDate: string,
    nextMinDaysAhead: number,
    nextPeriods: PeriodConfig[]
  ) => {
    if (nextPeriods.length > 0) {
      onChange({
        ...(nextStartDate ? { start_date: nextStartDate } : {}),
        min_days_ahead: nextMinDaysAhead,
        periods: nextPeriods,
      });
    }
  };

  const handleStartDateChange = (value: string) => {
    setStartDate(value);
    emitSchedule(value, minDaysAhead, periods);
  };

  const handleMinDaysAheadChange = (value: string) => {
    const numValue = parseInt(value, 10);
    if (isNaN(numValue) || numValue < 0) {
      return;
    }
    setMinDaysAhead(numValue);
    emitSchedule(startDate, numValue, periods);
  };

  const handlePeriodChange = (
    index: number,
    field: keyof PeriodConfig,
    value: string | boolean
  ) => {
    if (disabled) return;
    const newPeriods = [...periods];
    newPeriods[index] = {
      ...newPeriods[index],
      [field]: value,
    };
    setPeriods(newPeriods);
    emitSchedule(startDate, minDaysAhead, newPeriods);
  };

  const handleSetDefaults = () => {
    if (disabled) return;
    setPeriods([...DEFAULT_PERIODS]);
    emitSchedule(startDate, minDaysAhead, DEFAULT_PERIODS);
  };

  return (
    <div className="space-y-4">
      {/* 開始日（後方互換用・フォームでは入力日から3週間を使用） */}
      <div>
        <Input
          label="開始日（参考・未使用時は入力日から3週間）"
          type="date"
          value={startDate}
          onChange={(e) => handleStartDateChange(e.target.value)}
          disabled={disabled}
        />
        <p className="text-xs text-[#4b5563] mt-1">
          フォームでは「入力している日から3週間」が表示されます。ここは参考用です。
        </p>
      </div>

      {/* 申込可能な最短日 */}
      <div>
        <Input
          label="申込可能な最短日"
          type="number"
          min="0"
          value={minDaysAhead}
          onChange={(e) => handleMinDaysAheadChange(e.target.value)}
          disabled={disabled}
          required
        />
        <p className="text-xs text-[#4b5563] mt-1">
          入力日から何日後以降を選択可能にするか（0＝当日から）
        </p>
      </div>

      {/* 時限設定 */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <label className="block text-sm font-medium text-[#1f2937]">時限設定</label>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleSetDefaults}
            disabled={disabled}
          >
            デフォルトを設定
          </Button>
        </div>
        <div className="border border-[#e5e7eb] rounded-lg overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-[#f3f4f6] border-b border-[#e5e7eb]">
                <th className="px-4 py-2 text-left text-sm font-semibold text-[#1f2937]">時限</th>
                <th className="px-4 py-2 text-left text-sm font-semibold text-[#1f2937]">
                  開始時間
                </th>
                <th className="px-4 py-2 text-left text-sm font-semibold text-[#1f2937]">
                  終了時間
                </th>
                <th className="px-4 py-2 text-center text-sm font-semibold text-[#1f2937]">土曜</th>
                <th className="px-4 py-2 text-center text-sm font-semibold text-[#1f2937]">日曜</th>
                <th className="px-4 py-2 text-center text-sm font-semibold text-[#1f2937]">平日</th>
              </tr>
            </thead>
            <tbody>
              {periods.map((period, index) => (
                <tr key={period.code} className="border-b border-[#e5e7eb]/20 last:border-b-0">
                  <td className="px-4 py-2 text-sm font-medium text-[#1f2937]">{period.code}限</td>
                  <td className="px-4 py-2">
                    <Input
                      type="time"
                      value={period.start_time}
                      onChange={(e) => handlePeriodChange(index, 'start_time', e.target.value)}
                      disabled={disabled}
                      className="w-32"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <Input
                      type="time"
                      value={period.end_time}
                      onChange={(e) => handlePeriodChange(index, 'end_time', e.target.value)}
                      disabled={disabled}
                      className="w-32"
                    />
                  </td>
                  <td className="px-4 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={period.available_saturday ?? false}
                      onChange={(e) =>
                        handlePeriodChange(index, 'available_saturday', e.target.checked)
                      }
                      disabled={disabled}
                      className="w-4 h-4 text-[#3b82f6] border-[#e5e7eb] rounded focus:ring-[#3b82f6]"
                    />
                  </td>
                  <td className="px-4 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={period.available_sunday ?? false}
                      onChange={(e) =>
                        handlePeriodChange(index, 'available_sunday', e.target.checked)
                      }
                      disabled={disabled}
                      className="w-4 h-4 text-[#3b82f6] border-[#e5e7eb] rounded focus:ring-[#3b82f6]"
                    />
                  </td>
                  <td className="px-4 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={period.available_weekday}
                      onChange={(e) =>
                        handlePeriodChange(index, 'available_weekday', e.target.checked)
                      }
                      disabled={disabled}
                      className="w-4 h-4 text-[#3b82f6] border-[#e5e7eb] rounded focus:ring-[#3b82f6]"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-[#4b5563] mt-2">
          土日はデフォルトで選択不可。必要に応じてチェックを入れてください。
        </p>
      </div>
    </div>
  );
}
