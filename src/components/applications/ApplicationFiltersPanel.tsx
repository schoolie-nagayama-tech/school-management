'use client';

import { ApplicationFilters, ApplicationItem } from '@/types/database';
import { Input, Select } from '@/components/ui';
import { GRADE_LABELS } from '@/types/database';

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
    filters.search ||
    filters.grade !== null ||
    filters.itemId ||
    filters.showHidden;

  return (
    <div className="bg-[#fffffe] border border-[#0d0d0d] rounded-lg p-4 mb-6">
      <div className="flex flex-wrap gap-4 items-end">
        {/* 生徒名検索 */}
        <div className="flex-1 min-w-[200px]">
          <label className="block text-sm font-medium text-[#0d0d0d] mb-1">
            生徒名で検索
          </label>
          <input
            type="text"
            value={filters.search || ''}
            onChange={(e) => onChange({ search: e.target.value })}
            placeholder="氏名・フリガナで検索"
            className="w-full px-3 py-2 border border-[#0d0d0d] rounded-lg text-sm bg-[#fffffe] text-[#2a2a2a] focus:outline-none focus:ring-2 focus:ring-[#ff8e3c]"
          />
        </div>

        {/* 学年フィルター */}
        <div className="w-32">
          <label className="block text-sm font-medium text-[#0d0d0d] mb-1">
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

        {/* 申込項目フィルター */}
        <div className="w-48">
          <label className="block text-sm font-medium text-[#0d0d0d] mb-1">
            申込項目
          </label>
          <Select
            value={filters.itemId || ''}
            onChange={(e) =>
              onChange({ itemId: e.target.value || null })
            }
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
              className="w-4 h-4 text-[#ff8e3c] border-[#0d0d0d] rounded focus:ring-[#ff8e3c]"
            />
            <span className="text-sm text-[#2a2a2a]">終了した項目も表示</span>
          </label>
        </div>

        {/* リセットボタン */}
        {hasActiveFilters && (
          <button
            onClick={onReset}
            className="text-sm text-[#2a2a2a] hover:text-[#ff8e3c] underline transition-colors"
          >
            リセット
          </button>
        )}
      </div>

      {/* アクティブなフィルター表示 */}
      {hasActiveFilters && (
        <div className="mt-3 flex flex-wrap gap-2">
          {filters.search && (
            <span className="inline-flex items-center gap-1 px-2 py-1 bg-[#ff8e3c]/20 text-[#0d0d0d] text-sm rounded">
              検索: {filters.search}
              <button
                onClick={() => onChange({ search: '' })}
                className="hover:text-[#ff8e3c]"
              >
                ×
              </button>
            </span>
          )}
          {filters.grade !== null && filters.grade !== undefined && (
            <span className="inline-flex items-center gap-1 px-2 py-1 bg-[#ff8e3c]/20 text-[#0d0d0d] text-sm rounded">
              学年: {GRADE_LABELS[filters.grade]}
              <button
                onClick={() => onChange({ grade: null })}
                className="hover:text-[#ff8e3c]"
              >
                ×
              </button>
            </span>
          )}
          {filters.itemId && (
            <span className="inline-flex items-center gap-1 px-2 py-1 bg-[#ff8e3c]/20 text-[#0d0d0d] text-sm rounded">
              項目: {items.find((i) => i.id === filters.itemId)?.name}
              <button
                onClick={() => onChange({ itemId: null })}
                className="hover:text-[#ff8e3c]"
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
