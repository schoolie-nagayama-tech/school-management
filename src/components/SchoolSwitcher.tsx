'use client';

import type { School } from '@/types/database';

interface SchoolSwitcherProps {
  schools: School[];
  selectedSchoolId: string;
  onChange: (schoolId: string) => void;
  // 「すべての教室」ボタンを先頭に出すか（横断サマリー表示の切り替え用）
  allowAll?: boolean;
  // 「すべての教室」が現在アクティブか（allowAll のときだけ意味を持つ）
  isAllActive?: boolean;
  // 「すべての教室」クリック時のコールバック
  onSelectAll?: () => void;
}

export function SchoolSwitcher({
  schools,
  selectedSchoolId,
  onChange,
  allowAll = false,
  isAllActive = false,
  onSelectAll,
}: SchoolSwitcherProps) {
  if (schools.length <= 1) return null;

  return (
    <div className="flex items-center gap-1.5 bg-blue-50/80 border border-blue-200 rounded-lg px-3 py-1.5 mb-4">
      <span className="text-xs text-blue-600 font-medium mr-1 whitespace-nowrap">教室:</span>
      <div className="flex flex-wrap gap-1">
        {allowAll && (
          <button
            onClick={() => onSelectAll?.()}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
              isAllActive
                ? 'bg-[#1e3a5f] text-white shadow-sm'
                : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
            }`}
          >
            すべての教室
          </button>
        )}
        {schools.map((s) => (
          <button
            key={s.id}
            onClick={() => onChange(s.id)}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
              !isAllActive && selectedSchoolId === s.id
                ? 'bg-[#1e3a5f] text-white shadow-sm'
                : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
            }`}
          >
            {s.name}
          </button>
        ))}
      </div>
    </div>
  );
}
