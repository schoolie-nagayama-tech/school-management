'use client';

import { Select } from '@/components/ui';
import { GRADE_LABELS } from '@/types/database';

export interface BillingFilters {
  search: string;
  grade: number | null;
}

interface BillingFiltersPanelProps {
  filters: BillingFilters;
  onChange: (filters: Partial<BillingFilters>) => void;
  onReset: () => void;
}

const GRADES = [
  { value: '', label: 'すべての学年' },
  ...Object.entries(GRADE_LABELS).map(([key, label]) => ({
    value: key,
    label,
  })),
];

export function BillingFiltersPanel({
  filters,
  onChange,
  onReset,
}: BillingFiltersPanelProps) {
  const hasActiveFilters = filters.search || filters.grade !== null;

  return (
    <div className="bg-white border border-[#e5e7eb] rounded-lg p-4 mb-6">
      <div className="flex flex-wrap gap-4 items-end">
        {/* 生徒名検索 */}
        <div className="flex-1 min-w-[200px]">
          <label className="block text-sm font-medium text-[#1f2937] mb-1">
            生徒名で検索
          </label>
          <input
            type="text"
            value={filters.search || ''}
            onChange={(e) => onChange({ search: e.target.value })}
            placeholder="氏名・フリガナ・生徒コードで検索"
            className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm bg-white text-[#4b5563] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]"
          />
        </div>

        {/* 学年フィルター */}
        <div className="w-32">
          <label className="block text-sm font-medium text-[#1f2937] mb-1">
            学年
          </label>
          <Select
            value={filters.grade !== null && filters.grade !== undefined ? String(filters.grade) : ''}
            onChange={(e) =>
              onChange({ grade: e.target.value ? Number(e.target.value) : null })
            }
            options={GRADES}
          />
        </div>

        {/* リセットボタン */}
        {hasActiveFilters && (
          <button
            onClick={onReset}
            className="text-sm text-[#4b5563] hover:text-[#3b82f6] underline transition-colors"
          >
            リセット
          </button>
        )}
      </div>

      {/* アクティブなフィルター表示 */}
      {hasActiveFilters && (
        <div className="mt-3 flex flex-wrap gap-2">
          {filters.search && (
            <span className="inline-flex items-center gap-1 px-2 py-1 bg-[#3b82f6]/20 text-[#1f2937] text-sm rounded">
              検索: {filters.search}
              <button
                onClick={() => onChange({ search: '' })}
                className="hover:text-[#3b82f6]"
              >
                ×
              </button>
            </span>
          )}
          {filters.grade !== null && filters.grade !== undefined && (
            <span className="inline-flex items-center gap-1 px-2 py-1 bg-[#3b82f6]/20 text-[#1f2937] text-sm rounded">
              学年: {GRADE_LABELS[filters.grade]}
              <button
                onClick={() => onChange({ grade: null })}
                className="hover:text-[#3b82f6]"
              >
                ×
              </button>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
