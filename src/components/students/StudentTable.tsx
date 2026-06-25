'use client';

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  MessageCircle,
  FileText,
  Calendar,
  Pencil,
  Trash2,
  MoreVertical,
  Users,
  Code2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { InlineLoading } from '@/components/ui';
import type { Student, Subject } from '@/types/database';
import { GRADE_LABELS, STATUS_LABELS } from '@/types/database';
import type { SchedulePatternSummary } from '@/lib/api/students';
import { DAY_OF_WEEK_LABELS } from '@/types/schedule';

export type StudentRow = Student & {
  subjects?: Subject[];
  schedulePatterns?: SchedulePatternSummary[];
};

// 状況を小さなドットで表示（在籍中=info青、休会=warning黄、退会=非アクティブグレー）
const STATUS_DOT_COLORS: Record<Student['status'], string> = {
  active: 'bg-info',
  inactive: 'bg-warning',
  withdrawn: 'bg-border-strong',
};

export function StatusDot({ status }: { status: Student['status'] }) {
  return (
    <span
      title={STATUS_LABELS[status]}
      className={`inline-block w-2 h-2 rounded-full ${STATUS_DOT_COLORS[status]}`}
    />
  );
}

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
  icon: LucideIcon;
};

export function StudentRowActions({
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
      icon: BookOpen,
    });
  if (onInterviews)
    primaryActions.push({
      label: '面談',
      onClick: () => onInterviews(student),
      icon: MessageCircle,
    });
  if (onScores)
    primaryActions.push({
      label: '成績',
      onClick: () => onScores(student),
      icon: FileText,
    });
  if (onSchedule)
    primaryActions.push({
      label: '通塾日程',
      onClick: () => onSchedule(student),
      icon: Calendar,
    });

  // ⋯ メニューに収納する管理操作（頻度低め）
  type MenuItem = { label: string; onClick: () => void; danger?: boolean; icon: LucideIcon };
  const menuItems: MenuItem[] = [];
  if (onEdit)
    menuItems.push({
      label: '編集',
      onClick: () => onEdit(student),
      icon: Pencil,
    });
  if (onDelete)
    menuItems.push({
      label: '削除',
      onClick: () => onDelete(student),
      danger: true,
      icon: Trash2,
    });

  const handleMenuClick = (item: MenuItem, e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen(false);
    item.onClick();
  };

  return (
    <div className="flex justify-end gap-0.5 items-center" onClick={(e) => e.stopPropagation()}>
      {primaryActions.map((action) => {
        const ActionIcon = action.icon;
        return (
          <button
            key={action.label}
            onClick={action.onClick}
            aria-label={action.label}
            title={action.label}
            className="inline-flex flex-col items-center justify-center gap-0.5 px-1.5 sm:px-2 py-1.5 text-text-muted hover:text-ink hover:bg-ink-subtle rounded-lg transition-colors duration-150"
          >
            <ActionIcon className="w-4 h-4" />
            <span className="hidden sm:block text-[10px] leading-none">{action.label}</span>
          </button>
        );
      })}

      {menuItems.length > 0 && (
        <div ref={menuRef} className="relative ml-1">
          <button
            onClick={() => setOpen((v) => !v)}
            aria-label="その他の操作"
            aria-haspopup="menu"
            aria-expanded={open}
            title="編集・削除"
            className="inline-flex items-center justify-center w-9 h-9 text-text-muted hover:text-ink hover:bg-ink-subtle rounded-lg transition-colors duration-150"
          >
            <MoreVertical className="w-4 h-4" />
          </button>
          {open && (
            <div
              role="menu"
              className="absolute right-0 top-full mt-1 min-w-[140px] bg-surface-raised rounded-lg border border-border shadow-lg z-10 py-1 dropdown-menu dropdown-menu-right"
            >
              {menuItems.map((item) => (
                <button
                  key={item.label}
                  role="menuitem"
                  type="button"
                  onClick={(e) => handleMenuClick(item, e)}
                  className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2.5 transition-colors ${
                    item.danger
                      ? 'text-danger hover:bg-danger/10'
                      : 'text-text-body hover:bg-ink-subtle hover:text-ink'
                  }`}
                >
                  {(() => {
                    const ItemIcon = item.icon;
                    return <ItemIcon className="w-4 h-4 shrink-0" />;
                  })()}
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
  // 週回数: 同じ曜日×コマ（例: 国/理 のように 2 科目を 1 コマで実施）は週 1 回として数える。
  const weeklyCount = new Set(schedulePatterns.map((p) => `${p.day_of_week}-${p.time_slot_id}`))
    .size;
  return (
    <tr
      className={`transition-colors duration-150 ${
        isChecked ? 'bg-info/5' : ''
      } ${onRowClick ? 'cursor-pointer hover:bg-surface-hover' : ''}`}
      onClick={() => onRowClick?.(student)}
    >
      {selectable && (
        <td className="hidden sm:table-cell px-3 py-3" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={isChecked}
            onChange={() => onToggle(student.id)}
            className="w-4 h-4 rounded border-border text-info accent-info focus:ring-info/30"
          />
        </td>
      )}
      <td className="px-4 py-3 whitespace-nowrap">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-text-heading">
            {student.last_name} {student.first_name}
          </span>
          {student.is_programming && (
            <span title="プログラミングコース" aria-label="プログラミングコース">
              <Code2 className="w-3.5 h-3.5 text-purple-500 shrink-0" />
            </span>
          )}
          {student.is_sibling && (
            <span title="兄弟・姉妹あり" aria-label="兄弟・姉妹あり">
              <Users className="w-3.5 h-3.5 text-teal-500 shrink-0" />
            </span>
          )}
        </div>
      </td>
      <td className="hidden sm:table-cell px-4 py-3 text-sm text-text-muted">
        {student.last_name_kana} {student.first_name_kana}
      </td>
      <td className="px-4 py-3 text-sm text-text-muted whitespace-nowrap">
        {GRADE_LABELS[student.grade] || student.grade}
      </td>
      <td className="hidden md:table-cell px-4 py-3 text-sm text-text-muted">
        {student.school_name || <span className="text-text-muted/30">-</span>}
      </td>
      <td className="hidden lg:table-cell px-4 py-3 text-sm text-text-muted">
        {schedulePatterns.length > 0 ? (
          <div className="flex flex-wrap gap-x-2 gap-y-0.5 items-center">
            {schedulePatterns.map((p, i) => (
              <span key={i} className="inline-flex text-xs">
                <span className="text-text-faint">{DAY_OF_WEEK_LABELS[p.day_of_week]}</span>
                {p.subject_names?.[0] && (
                  <span className="text-info ml-0.5">{p.subject_names[0]}</span>
                )}
              </span>
            ))}
            <span className="text-[10px] text-text-faint">週{weeklyCount}回</span>
          </div>
        ) : (
          <span className="text-text-muted/30">-</span>
        )}
      </td>
      <td className="px-4 py-3">
        <StatusDot status={student.status} />
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
  /** 講師ロールの場合は true。空状態の案内文を中立的な表現に切り替える */
  isTeacher?: boolean;
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
  isTeacher = false,
}: StudentTableProps) {
  const selectable = !!selectedIds && !!onSelectionChange;

  const allSelected =
    selectable && students.length > 0 && students.every((s) => selectedIds.has(s.id));
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
      <div className="bg-surface rounded-xl border border-border p-8">
        <InlineLoading />
      </div>
    );
  }

  if (students.length === 0) {
    return (
      <div className="bg-surface rounded-xl border border-border p-8">
        <div className="text-center">
          <Users className="mx-auto h-12 w-12 text-text-faint" />
          {isTeacher ? (
            // 講師は登録・追加操作ができないため、ボタン名を案内しない中立的な文言にする
            <p className="mt-4 text-text-muted">表示できる生徒がいません</p>
          ) : (
            <>
              <p className="mt-4 text-text-muted">生徒が登録されていません</p>
              <p className="text-sm text-text-faint">
                「新規登録」ボタンから生徒を追加してください
              </p>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-surface rounded-xl border border-border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-surface-hover border-b border-border">
              {selectable && (
                <th className="hidden sm:table-cell px-3 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someSelected && !allSelected;
                    }}
                    onChange={handleToggleAll}
                    className="w-4 h-4 rounded border-border text-info accent-info focus:ring-info/30"
                  />
                </th>
              )}
              <th className="px-4 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider whitespace-nowrap">
                氏名
              </th>
              <th className="hidden sm:table-cell px-4 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider whitespace-nowrap">
                フリガナ
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider whitespace-nowrap">
                学年
              </th>
              <th className="hidden md:table-cell px-4 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider whitespace-nowrap">
                学校名
              </th>
              <th className="hidden lg:table-cell px-4 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider whitespace-nowrap">
                通塾日程
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-text-muted uppercase tracking-wider whitespace-nowrap w-6"></th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-text-muted uppercase tracking-wider whitespace-nowrap">
                操作
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
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
      <div className="px-4 py-3 bg-surface-hover border-t border-border">
        <p className="text-sm text-text-muted">
          全 <span className="font-semibold">{students.length}</span> 件
          {selectable && selectedIds.size > 0 && (
            <span className="ml-2 text-ink font-medium">（{selectedIds.size}件選択中）</span>
          )}
        </p>
      </div>
    </div>
  );
}
