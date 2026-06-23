'use client';

import { ApplicationFilters, ApplicationItem } from '@/types/database';
import { Select } from '@/components/ui';
import { GRADE_LABELS } from '@/types/database';
import { X } from 'lucide-react';

interface ApplicationFiltersPanelProps {
  filters: ApplicationFilters;
  items: ApplicationItem[];
  onChange: (filters: Partial<ApplicationFilters>) => void;
  onReset: () => void;
}

const GRADES = [
  { value: '', label: 'すべての学年' },
  ...Object.entries(GRADE_LABELS).map(([key, label]) => ({
    value: key,
    label,
  })),
];

export function ApplicationFiltersPanel({
  filters,
  items,
  onChange,
  onReset,
}: ApplicationFiltersPanelProps) {
  const hasActiveFilters =
    filters.search || filters.grade !== null || filters.itemId || filters.showHidden;

  return (
    <div className="bg-white border border-[#e5e7eb] rounded-lg p-4 mb-6">
      <div className="flex flex-wrap gap-4 items-end">
        {/* 生徒名検索 */}
        <div className="flex-1 min-w-[200px]">
          <label className="block text-sm font-medium text-[#1f2937] mb-1">生徒名で検索</label>
          <input
            type="text"
            value={filters.search || ''}
            onChange={(e) => onChange({ search: e.target.value })}
            placeholder="氏名・フリガナで検索"
            className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm bg-white text-[#4b5563] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]"
          />
        </div>

        {/* 学年フィルター */}
        <div className="w-32">
          <label className="block text-sm font-medium text-[#1f2937] mb-1">学年</label>
          <Select
            value={
              filters.grade !== null && filters.grade !== undefined ? String(filters.grade) : ''
            }
            onChange={(e) => onChange({ grade: e.target.value ? Number(e.target.value) : null })}
            options={GRADES}
          />
        </div>

        {/* 申込項目フィルター */}
        <div className="w-48">
          <label className="block text-sm font-medium text-[#1f2937] mb-1">申込項目</label>
          <Select
            value={filters.itemId || ''}
            onChange={(e) => onChange({ itemId: e.target.value || null })}
            options={[
              { value: '', label: 'すべての項目' },
              ...items
                .filter((i) => !i.is_hidden)
                .map((item) => ({
                  value: item.id,
                  label: item.name,
                })),
            ]}
          />
        </div>

        {/* 非表示を含める */}
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={filters.showHidden || false}
              onChange={(e) => onChange({ showHidden: e.target.checked })}
              className="w-4 h-4 text-[#3b82f6] border-[#e5e7eb] rounded focus:ring-[#3b82f6]"
            />
            <span className="text-sm text-[#4b5563]">終了した項目も表示</span>
          </label>
        </div>

        {/* リセットボタン */}
        {hasActiveFilters && (
          <button
            onClick={onReset}
            className="text-sm text-[#4b5563] hover:text-[#3b82f6] underline transition-colors duration-150"
          >
            リセット
          </button>
        )}
      </div>

      {/* アクティブなフィルター表示 */}
      {hasActiveFilters && (
        <div className="mt-3 flex flex-wrap gap-2 slide-in-bar">
          {filters.search && (
            <span className="inline-flex items-center gap-1 px-2 py-1 bg-[#3b82f6]/20 text-[#1f2937] text-sm rounded">
              検索: {filters.search}
              <button
                onClick={() => onChange({ search: '' })}
                className="hover:text-[#3b82f6] transition-colors duration-150"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
          {filters.grade !== null && filters.grade !== undefined && (
            <span className="inline-flex items-center gap-1 px-2 py-1 bg-[#3b82f6]/20 text-[#1f2937] text-sm rounded">
              学年: {GRADE_LABELS[filters.grade]}
              <button
                onClick={() => onChange({ grade: null })}
                className="hover:text-[#3b82f6] transition-colors duration-150"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
          {filters.itemId && (
            <span className="inline-flex items-center gap-1 px-2 py-1 bg-[#3b82f6]/20 text-[#1f2937] text-sm rounded">
              項目: {items.find((i) => i.id === filters.itemId)?.name}
              <button
                onClick={() => onChange({ itemId: null })}
                className="hover:text-[#3b82f6] transition-colors duration-150"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
