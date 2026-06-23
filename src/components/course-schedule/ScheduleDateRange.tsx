'use client';

import type { SeasonType } from '@/types/database';

interface ScheduleDateRangeProps {
  startDate: Date;
  endDate: Date;
  onChangeRange: (start: Date, end: Date) => void;
  season?: SeasonType;
  year?: number;
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

function formatMonth(d: Date): string {
  return `${d.getFullYear()}年${d.getMonth() + 1}月`;
}

/** シーズンごとの全体期間 (準備開始月～講習終了月) */
function getSeasonFullRange(season: SeasonType, year: number): { start: Date; end: Date } {
  switch (season) {
    case 'spring':
      // 1月中旬～4月上旬 → 1月～4月
      return {
        start: new Date(year, 0, 1), // 1月1日
        end: new Date(year, 3, 30), // 4月30日
      };
    case 'summer':
      // 4月中旬～7月上旬 → 4月～8月
      return {
        start: new Date(year, 3, 1), // 4月1日
        end: new Date(year, 7, 31), // 8月31日
      };
    case 'winter':
      // 10月～1月 → 10月～翌1月
      return {
        start: new Date(year, 9, 1), // 10月1日
        end: new Date(year + 1, 0, 31), // 翌1月31日
      };
    default:
      return {
        start: new Date(year, 0, 1),
        end: new Date(year, 3, 30),
      };
  }
}

export function ScheduleDateRange({
  startDate,
  endDate,
  onChangeRange,
  season,
  year,
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

  const handleFullPeriod = () => {
    if (!season || !year) return;
    const range = getSeasonFullRange(season, year);
    onChangeRange(range.start, range.end);
  };

  // 全体表示中かどうか判定
  const isFullPeriod = (() => {
    if (!season || !year) return false;
    const full = getSeasonFullRange(season, year);
    return startDate.getTime() === full.start.getTime() && endDate.getTime() === full.end.getTime();
  })();

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
      {season && year && (
        <button
          onClick={handleFullPeriod}
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
