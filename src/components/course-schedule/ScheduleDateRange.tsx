'use client';

import { isSameRange } from '@/lib/utils/scheduleRange';

interface ScheduleDateRangeProps {
  startDate: Date;
  endDate: Date;
  onChangeRange: (start: Date, end: Date) => void;
  /**
   * 「全体表示」で戻る枠。シーズンの既定期間にタスクの日付を足した自動枠で、
   * 呼び出し側が計算して渡す（この部品がシーズン期間を二重に持たないようにするため）。
   */
  fullRange?: { start: Date; end: Date };
  onFullRange?: () => void;
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

function formatMonth(d: Date): string {
  return `${d.getFullYear()}年${d.getMonth() + 1}月`;
}

export function ScheduleDateRange({
  startDate,
  endDate,
  onChangeRange,
  fullRange,
  onFullRange,
}: ScheduleDateRangeProps) {
  const handlePrev = () => {
    onChangeRange(addMonths(startDate, -1), addMonths(endDate, -1));
  };

  const handleNext = () => {
    onChangeRange(addMonths(startDate, 1), addMonths(endDate, 1));
  };

  const handleThisMonth = () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 2, 0);
    onChangeRange(start, end);
  };

  // 全体表示中かどうか判定
  const isFullPeriod = fullRange
    ? isSameRange({ start: startDate, end: endDate }, fullRange)
    : false;

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handlePrev}
        className="px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 rounded"
      >
        ◀
      </button>
      <span className="text-xs text-gray-600 font-medium min-w-[140px] text-center">
        {formatMonth(startDate)} ~ {formatMonth(endDate)}
      </span>
      <button
        onClick={handleNext}
        className="px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 rounded"
      >
        ▶
      </button>
      <button
        onClick={handleThisMonth}
        className="px-2 py-1 text-[10px] text-gray-400 hover:text-gray-600 border border-gray-200 rounded"
      >
        今月
      </button>
      {fullRange && onFullRange && (
        <button
          onClick={onFullRange}
          title="タスクの日付をすべて含む期間に戻す"
          className={`px-2 py-1 text-[10px] border rounded transition-colors ${
            isFullPeriod
              ? 'bg-[#1e3a5f] text-white border-[#1e3a5f]'
              : 'text-gray-400 hover:text-gray-600 border-gray-200'
          }`}
        >
          全体表示
        </button>
      )}
    </div>
  );
}
