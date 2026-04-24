'use client';

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { Student, Subject } from '@/types/database';
import { GRADE_LABELS, STATUS_LABELS, STATUS_COLORS } from '@/types/database';
import type { SchedulePatternSummary } from '@/lib/api/students';
import { DAY_OF_WEEK_LABELS } from '@/types/schedule';

type StudentRow = Student & {
  subjects?: Subject[];
  schedulePatterns?: SchedulePatternSummary[];
};

interface StudentTableRowProps {
  student: StudentRow;
  selectable: boolean;
  isChecked: boolean;
  onToggle: (id: string) => void;
  onRowClick?: (student: Student) => void;
  onEdit?: (student: Student) => void;
  onDelete?: (student: Student) => void;
  onScores?: (student: Student) => void;
  onInterviews?: (student: Student) => void;
  onProgress?: (student: Student) => void;
  onSchedule?: (student: Student) => void;
}

interface StudentRowActionsProps {
  student: Student;
  onEdit?: (student: Student) => void;
  onDelete?: (student: Student) => void;
  onScores?: (student: Student) => void;
  onInterviews?: (student: Student) => void;
  onProgress?: (student: Student) => void;
  onSchedule?: (student: Student) => void;
}

/**
 * 生徒1行ぶんのアクション群。
 *
 * 毎日使う業務導線（成績・進行表・面談・通塾日程）は**インライン**で
 * 0クリック到達を維持する。編集・削除は頻度の低い管理操作なので
 * ⋯ メニューに格納してインラインの視覚ノイズを抑える。
 */
type PrimaryAction = {
  label: string;
  onClick: () => void;
  path: string;
};

function StudentRowActions({
  student,
  onEdit,
  onDelete,
  onScores,
  onInterviews,
  onProgress,
  onSchedule,
}: StudentRowActionsProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  // インラインのメイン業務導線（左から: 進行表 → 面談 → 成績 → 通塾日程）
  const primaryActions: PrimaryAction[] = [];
  if (onProgress)
    primaryActions.push({
      label: '進行表',
      onClick: () => onProgress(student),
      path: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253',
    });
  if (onInterviews)
    primaryActions.push({
      label: '面談',
      onClick: () => onInterviews(student),
      path: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z',
    });
  if (onScores)
    primaryActions.push({
      label: '成績',
      onClick: () => onScores(student),
      path: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
    });
  if (onSchedule)
    primaryActions.push({
      label: '通塾日程',
      onClick: () => onSchedule(student),
      path: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
    });

  // ⋯ メニューに収納する管理操作（頻度低め）
  type MenuItem = { label: string; onClick: () => void; danger?: boolean; path: string };
  const menuItems: MenuItem[] = [];
  if (onEdit)
    menuItems.push({
      label: '編集',
      onClick: () => onEdit(student),
      path: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z',
    });
  if (onDelete)
    menuItems.push({
      label: '削除',
      onClick: () => onDelete(student),
      danger: true,
      path: 'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16',
    });

  const handleMenuClick = (item: MenuItem, e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen(false);
    item.onClick();
  };

  return (
    <div
      className="flex justify-end gap-0.5 items-center"
      onClick={(e) => e.stopPropagation()}
    >
      {primaryActions.map((action) => (
        <button
          key={action.label}
          onClick={action.onClick}
          aria-label={action.label}
          title={action.label}
          className="inline-flex flex-col items-center justify-center gap-0.5 px-2 py-1.5 text-gray-600 hover:text-ink hover:bg-ink-subtle rounded-lg transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={action.path} />
          </svg>
          <span className="text-[10px] leading-none">{action.label}</span>
        </button>
      ))}

      {menuItems.length > 0 && (
        <div ref={menuRef} className="relative ml-1">
          <button
            onClick={() => setOpen((v) => !v)}
            aria-label="その他の操作"
            aria-haspopup="menu"
            aria-expanded={open}
            title="編集・削除"
            className="inline-flex items-center justify-center w-9 h-9 text-gray-600 hover:text-ink hover:bg-ink-subtle rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"
              />
            </svg>
          </button>
          {open && (
            <div
              role="menu"
              className="absolute right-0 top-full mt-1 min-w-[140px] bg-white rounded-lg border border-gray-200 shadow-lg z-10 py-1"
            >
              {menuItems.map((item) => (
                <button
                  key={item.label}
                  role="menuitem"
                  type="button"
                  onClick={(e) => handleMenuClick(item, e)}
                  className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2.5 transition-colors ${
                    item.danger
                      ? 'text-[#ef4444] hover:bg-[#ef4444]/10'
                      : 'text-gray-700 hover:bg-ink-subtle hover:text-ink'
                  }`}
                >
                  <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={item.path} />
                  </svg>
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const StudentTableRow = memo(function StudentTableRow({
  student,
  selectable,
  isChecked,
  onToggle,
  onRowClick,
  onEdit,
  onDelete,
  onScores,
  onInterviews,
  onProgress,
  onSchedule,
}: StudentTableRowProps) {
  const schedulePatterns = student.schedulePatterns || [];
  return (
    <tr
      className={`transition-colors duration-150 ${
        isChecked ? 'bg-[#1e3a5f]/5' : ''
      } ${onRowClick ? 'cursor-pointer hover:bg-gray-50' : ''}`}
      onClick={() => onRowClick?.(student)}
    >
      {selectable && (
        <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={isChecked}
            onChange={() => onToggle(student.id)}
            className="w-4 h-4 rounded border-gray-300 text-[#1e3a5f] focus:ring-[#1e3a5f]/30"
          />
        </td>
      )}
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-[#1a1a1a]">
            {student.last_name} {student.first_name}
          </span>
          {student.is_programming && (
            <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded bg-purple-100 text-purple-700 border border-purple-200">
              プログラミング
            </span>
          )}
        </div>
      </td>
      <td className="px-4 py-3 text-sm text-[#4b5563]">
        {student.last_name_kana} {student.first_name_kana}
      </td>
      <td className="px-4 py-3 text-sm text-[#4b5563]">
        {GRADE_LABELS[student.grade] || student.grade}
      </td>
      <td className="px-4 py-3 text-sm text-[#4b5563]">
        {student.school_name || <span className="text-[#4b5563]/30">-</span>}
      </td>
      <td className="px-4 py-3 text-sm text-[#4b5563]">
        {schedulePatterns.length > 0 ? (
          <div className="flex flex-wrap gap-x-2 gap-y-0.5 items-center">
            {schedulePatterns.map((p, i) => (
              <span key={i} className="inline-flex text-xs">
                <span className="text-[#6b7280]">{DAY_OF_WEEK_LABELS[p.day_of_week]}</span>
                {p.subject_names?.[0] && (
                  <span className="text-[#3b82f6] ml-0.5">{p.subject_names[0]}</span>
                )}
              </span>
            ))}
            <span className="text-[10px] text-[#9ca3af]">週{schedulePatterns.length}回</span>
          </div>
        ) : (
          <span className="text-[#4b5563]/30">-</span>
        )}
      </td>
      <td className="px-4 py-3">
        <span
          className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${STATUS_COLORS[student.status]}`}
        >
          {STATUS_LABELS[student.status]}
        </span>
      </td>
      <td className="px-4 py-3 text-right">
        <StudentRowActions
          student={student}
          onEdit={onEdit}
          onDelete={onDelete}
          onScores={onScores}
          onInterviews={onInterviews}
          onProgress={onProgress}
          onSchedule={onSchedule}
        />
      </td>
    </tr>
  );
});

interface StudentTableProps {
  students: StudentRow[];
  onEdit?: (student: Student) => void;
  onDelete?: (student: Student) => void;
  onRowClick?: (student: Student) => void;
  onScores?: (student: Student) => void;
  onInterviews?: (student: Student) => void;
  onProgress?: (student: Student) => void;
  onSchedule?: (student: Student) => void;
  isLoading?: boolean;
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;
}

export function StudentTable({
  students,
  onEdit,
  onDelete,
  onRowClick,
  onScores,
  onInterviews,
  onProgress,
  onSchedule,
  isLoading = false,
  selectedIds,
  onSelectionChange,
}: StudentTableProps) {
  const selectable = !!selectedIds && !!onSelectionChange;

  const allSelected = selectable && students.length > 0 && students.every((s) => selectedIds.has(s.id));
  const someSelected = selectable && students.some((s) => selectedIds.has(s.id));

  const handleToggleAll = () => {
    if (!onSelectionChange) return;
    if (allSelected) {
      // 現在表示中の生徒のみ選択解除
      const next = new Set(selectedIds);
      students.forEach((s) => next.delete(s.id));
      onSelectionChange(next);
    } else {
      const next = new Set(selectedIds);
      students.forEach((s) => next.add(s.id));
      onSelectionChange(next);
    }
  };

  const handleToggle = useCallback(
    (id: string) => {
      if (!onSelectionChange || !selectedIds) return;
      const next = new Set(selectedIds);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      onSelectionChange(next);
    },
    [onSelectionChange, selectedIds]
  );

  if (isLoading) {
    return (
      <div className="bg-[#f8f8f8] rounded-xl border border-gray-200 p-8">
        <div className="flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-[#1e3a5f] border-t-transparent rounded-full animate-spin"></div>
          <span className="ml-3 text-gray-500">読み込み中...</span>
        </div>
      </div>
    );
  }

  if (students.length === 0) {
    return (
      <div className="bg-[#f8f8f8] rounded-xl border border-gray-200 p-8">
        <div className="text-center">
          <svg
            className="mx-auto h-12 w-12 text-gray-300"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z"
            />
          </svg>
          <p className="mt-4 text-gray-600">生徒が登録されていません</p>
          <p className="text-sm text-gray-400">
            「新規登録」ボタンから生徒を追加してください
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#f8f8f8] rounded-xl border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              {selectable && (
                <th className="px-3 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someSelected && !allSelected;
                    }}
                    onChange={handleToggleAll}
                    className="w-4 h-4 rounded border-gray-300 text-[#1e3a5f] focus:ring-[#1e3a5f]/30"
                  />
                </th>
              )}
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                氏名
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                フリガナ
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                学年
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                学校名
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                通塾日程
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                状況
              </th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">
                操作
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {students.map((student) => (
              <StudentTableRow
                key={student.id}
                student={student}
                selectable={selectable}
                isChecked={!!selectedIds?.has(student.id)}
                onToggle={handleToggle}
                onRowClick={onRowClick}
                onEdit={onEdit}
                onDelete={onDelete}
                onScores={onScores}
                onInterviews={onInterviews}
                onProgress={onProgress}
                onSchedule={onSchedule}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* フッター：件数表示 */}
      <div className="px-4 py-3 bg-gray-50 border-t border-gray-200">
        <p className="text-sm text-[#4b5563]">
          全 <span className="font-semibold">{students.length}</span> 件
          {selectable && selectedIds.size > 0 && (
            <span className="ml-2 text-[#1e3a5f] font-medium">
              （{selectedIds.size}件選択中）
            </span>
          )}
        </p>
      </div>
    </div>
  );
}
