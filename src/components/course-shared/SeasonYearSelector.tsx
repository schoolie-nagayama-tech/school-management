'use client';

import type { SeasonType } from '@/types/database';
import { SEASON_LABELS } from '@/types/database';

interface SeasonYearSelectorProps {
  season: SeasonType;
  year: number;
  onSeasonChange: (season: SeasonType) => void;
  onYearChange: (year: number) => void;
}

export function SeasonYearSelector({
  season,
  year,
  onSeasonChange,
  onYearChange,
}: SeasonYearSelectorProps) {
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
        {(['spring', 'summer', 'winter'] as const).map((s) => (
          <button
            key={s}
            onClick={() => onSeasonChange(s)}
            className={`px-3 py-1.5 text-xs rounded-md transition-[color,background-color,transform] duration-150 ease-out active:scale-[0.97] ${
              season === s
                ? 'bg-white text-[#1e3a5f] font-semibold shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {SEASON_LABELS[s]}
          </button>
        ))}
      </div>
      <select
        value={year}
        onChange={(e) => onYearChange(Number(e.target.value))}
        className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white text-[#1e3a5f] font-medium"
      >
        {years.map((y) => (
          <option key={y} value={y}>
            {y}年
          </option>
        ))}
      </select>
    </div>
  );
}
