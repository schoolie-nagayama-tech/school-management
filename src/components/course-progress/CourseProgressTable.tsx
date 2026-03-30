'use client';

import { useState, useCallback, useMemo } from 'react';
import type { Student, CourseProgressItem, StudentCourseProgress, ApplicationStatus } from '@/types/database';
import { GRADE_LABELS, PROGRESS_COLUMN_GROUPS } from '@/types/database';
import type { AutoValues } from '@/lib/api/courseProgress';

interface CourseProgressTableProps {
  students: Student[];
  items: CourseProgressItem[];
  progressData: StudentCourseProgress[];
  autoValues?: AutoValues;
  canEdit: boolean;
  onStatusChange: (studentId: string, itemId: string, status: ApplicationStatus | null) => void;
  onNumberChange: (studentId: string, itemId: string, value: number | null) => void;
  onDateChange: (studentId: string, itemId: string, value: string | null) => void;
  onItemNameChange?: (itemId: string, name: string) => void;
  onItemDeadlineChange?: (itemId: string, deadline: string | null) => void;
}

function nextStatus(current: ApplicationStatus | null | undefined): ApplicationStatus | null {
  if (!current) return 'pending';
  if (current === 'pending') return 'completed';
  if (current === 'completed') return 'not_applicable';
  return null;
}

function statusSymbol(status: ApplicationStatus | null | undefined): string {
  if (!status) return '';
  if (status === 'pending') return '\u00d7';
  if (status === 'completed') return '\u2713';
  if (status === 'not_applicable') return '\u2013';
  return '';
}

function statusBgClass(status: ApplicationStatus | null | undefined): string {
  if (!status) return '';
  if (status === 'pending') return 'bg-yellow-50';
  if (status === 'completed') return 'bg-green-50';
  if (status === 'not_applicable') return 'bg-gray-100';
  return '';
}

function statusTextClass(status: ApplicationStatus | null | undefined): string {
  if (!status) return 'text-gray-300';
  if (status === 'pending') return 'text-yellow-600 font-bold';
  if (status === 'completed') return 'text-green-600 font-bold';
  if (status === 'not_applicable') return 'text-gray-400';
  return '';
}

function formatDeadline(deadline: string | null): string {
  if (!deadline) return '';
  const d = new Date(deadline);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function CourseProgressTable({
  students,
  items,
  progressData,
  autoValues,
  canEdit,
  onStatusChange,
  onNumberChange,
  onDateChange,
  onItemNameChange,
  onItemDeadlineChange,
}: CourseProgressTableProps) {
  const [editingCell, setEditingCell] = useState<{ studentId: string; itemId: string } | null>(null);
  const [editValue, setEditValue] = useState('');
  // 項目名編集
  const [editingItemName, setEditingItemName] = useState<string | null>(null);
  const [editItemNameValue, setEditItemNameValue] = useState('');
  // 期日編集
  const [editingDeadline, setEditingDeadline] = useState<string | null>(null);
  const [editDeadlineValue, setEditDeadlineValue] = useState('');

  const progressMap = useMemo(() => {
    const map = new Map<string, StudentCourseProgress>();
    for (const d of progressData) {
      map.set(`${d.student_id}:${d.item_id}`, d);
    }
    return map;
  }, [progressData]);

  const sortedStudents = useMemo(() => {
    return [...students].sort((a, b) => (a.grade || 0) - (b.grade || 0));
  }, [students]);

  const columnGroups = useMemo(() => {
    const groups: { key: string; label: string; color: string; items: CourseProgressItem[] }[] = [];
    const ungrouped: CourseProgressItem[] = [];
    const groupMap = new Map<string, CourseProgressItem[]>();

    for (const item of items) {
      const g = item.column_group;
      if (g && PROGRESS_COLUMN_GROUPS[g]) {
        if (!groupMap.has(g)) groupMap.set(g, []);
        groupMap.get(g)!.push(item);
      } else {
        ungrouped.push(item);
      }
    }
    if (ungrouped.length > 0) {
      groups.push({ key: '_ungrouped', label: '', color: '#6b7280', items: ungrouped });
    }
    for (const [key, groupItems] of Array.from(groupMap)) {
      const def = PROGRESS_COLUMN_GROUPS[key];
      groups.push({ key, label: def.label, color: def.color, items: groupItems });
    }
    return groups;
  }, [items]);

  const itemCompletionRates = useMemo(() => {
    const rates: Record<string, { completed: number; total: number }> = {};
    for (const item of items) {
      if (item.column_type !== 'check') continue;
      let completed = 0;
      for (const s of students) {
        const d = progressMap.get(`${s.id}:${item.id}`);
        if (d?.status === 'completed') completed++;
      }
      rates[item.id] = { completed, total: students.length };
    }
    return rates;
  }, [items, students, progressMap]);

  const studentCompletionRates = useMemo(() => {
    const checkItems = items.filter((i) => i.column_type === 'check');
    const rates: Record<string, { completed: number; total: number }> = {};
    for (const s of students) {
      let completed = 0;
      for (const item of checkItems) {
        const d = progressMap.get(`${s.id}:${item.id}`);
        if (d?.status === 'completed') completed++;
      }
      rates[s.id] = { completed, total: checkItems.length };
    }
    return rates;
  }, [items, students, progressMap]);

  const handleCheckClick = useCallback(
    (studentId: string, itemId: string) => {
      if (!canEdit) return;
      const d = progressMap.get(`${studentId}:${itemId}`);
      onStatusChange(studentId, itemId, nextStatus(d?.status));
    },
    [canEdit, progressMap, onStatusChange]
  );

  const handleStartEdit = useCallback(
    (studentId: string, itemId: string, currentValue: string) => {
      if (!canEdit) return;
      setEditingCell({ studentId, itemId });
      setEditValue(currentValue);
    },
    [canEdit]
  );

  const handleNumberBlur = useCallback(
    (studentId: string, itemId: string) => {
      setEditingCell(null);
      const trimmed = editValue.trim();
      const val = trimmed === '' ? null : Number(trimmed);
      if (trimmed !== '' && isNaN(val as number)) return;
      onNumberChange(studentId, itemId, val);
    },
    [editValue, onNumberChange]
  );

  const handleDateBlur = useCallback(
    (studentId: string, itemId: string) => {
      setEditingCell(null);
      onDateChange(studentId, itemId, editValue.trim() || null);
    },
    [editValue, onDateChange]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, studentId: string, itemId: string, type: 'number' | 'date') => {
      if (e.key === 'Enter') {
        if (type === 'number') handleNumberBlur(studentId, itemId);
        else handleDateBlur(studentId, itemId);
      } else if (e.key === 'Escape') {
        setEditingCell(null);
      }
    },
    [handleNumberBlur, handleDateBlur]
  );

  // 項目名保存
  const handleItemNameSave = useCallback(
    (itemId: string) => {
      setEditingItemName(null);
      const name = editItemNameValue.trim();
      if (name && onItemNameChange) onItemNameChange(itemId, name);
    },
    [editItemNameValue, onItemNameChange]
  );

  // 期日保存
  const handleDeadlineSave = useCallback(
    (itemId: string) => {
      setEditingDeadline(null);
      if (onItemDeadlineChange) onItemDeadlineChange(itemId, editDeadlineValue || null);
    },
    [editDeadlineValue, onItemDeadlineChange]
  );

  // 自動計算値を取得
  const getAutoValue = useCallback(
    (studentId: string, autoSource: string | null): number | null => {
      if (!autoSource || !autoValues) return null;
      const sv = autoValues[studentId];
      if (!sv) return 0;
      if (autoSource === 'regular_weekly') return sv.regular_weekly;
      if (autoSource === 'course_sessions') return sv.course_sessions;
      return null;
    },
    [autoValues]
  );

  if (students.length === 0) {
    return <div className="py-12 text-center text-sm text-gray-400 italic">対象の生徒がいません</div>;
  }
  if (items.length === 0) {
    return <div className="py-12 text-center text-sm text-gray-400 italic">進捗項目がありません。テンプレートから作成してください。</div>;
  }

  let lastGrade: number | null = null;

  return (
    <div className="overflow-x-auto border border-gray-200 rounded-lg">
      <table className="w-full border-collapse text-xs">
        <thead>
          {/* 列グループヘッダー */}
          <tr>
            <th colSpan={2} className="border border-gray-200 bg-gray-50 px-2 py-1 sticky left-0 z-20" />
            {columnGroups.map((g) => (
              <th
                key={g.key}
                colSpan={g.items.length}
                className="border border-gray-200 px-2 py-1 text-center text-[10px] font-medium"
                style={{ backgroundColor: g.color + '15', color: g.color }}
              >
                {g.label}
              </th>
            ))}
            <th className="border border-gray-200 bg-gray-50 px-2 py-1 min-w-[80px]" />
          </tr>
          {/* 列ヘッダー（項目名 + 完了率） */}
          <tr className="bg-gray-100">
            <th className="border border-gray-200 px-2 py-2 text-left font-medium text-gray-700 sticky left-0 bg-gray-100 z-20 min-w-[48px]">
              学年
            </th>
            <th className="border border-gray-200 px-2 py-2 text-left font-medium text-gray-700 sticky left-[48px] bg-gray-100 z-20 min-w-[80px]">
              名前
            </th>
            {columnGroups.flatMap((g) =>
              g.items.map((item) => (
                <th
                  key={item.id}
                  className="border border-gray-200 px-1 py-2 text-center font-medium text-gray-700 min-w-[52px] whitespace-nowrap"
                >
                  {/* 項目名（ダブルクリックで編集） */}
                  {editingItemName === item.id ? (
                    <input
                      type="text"
                      value={editItemNameValue}
                      onChange={(e) => setEditItemNameValue(e.target.value)}
                      onBlur={() => handleItemNameSave(item.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleItemNameSave(item.id);
                        if (e.key === 'Escape') setEditingItemName(null);
                      }}
                      autoFocus
                      className="w-full px-1 py-0.5 text-[10px] border border-blue-300 rounded text-center"
                    />
                  ) : (
                    <div
                      className={`text-[10px] leading-tight ${canEdit && onItemNameChange ? 'cursor-pointer hover:text-blue-600' : ''}`}
                      onDoubleClick={() => {
                        if (canEdit && onItemNameChange) {
                          setEditingItemName(item.id);
                          setEditItemNameValue(item.name);
                        }
                      }}
                      title={`${item.name}${item.auto_source ? ' (自動)' : ''}${item.deadline ? ` 期日:${item.deadline}` : ''}\nダブルクリックで名前を編集`}
                    >
                      {item.name}
                      {item.auto_source && <span className="text-blue-400 ml-0.5" title="自動計算">A</span>}
                    </div>
                  )}
                  {/* 期日表示 */}
                  {editingDeadline === item.id ? (
                    <input
                      type="date"
                      value={editDeadlineValue}
                      onChange={(e) => setEditDeadlineValue(e.target.value)}
                      onBlur={() => handleDeadlineSave(item.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleDeadlineSave(item.id);
                        if (e.key === 'Escape') setEditingDeadline(null);
                      }}
                      autoFocus
                      className="w-full px-0.5 py-0 text-[9px] border border-blue-300 rounded mt-0.5"
                    />
                  ) : (
                    <div
                      className={`text-[9px] mt-0.5 ${
                        item.deadline
                          ? new Date(item.deadline) < new Date()
                            ? 'text-red-500 font-bold'
                            : 'text-orange-500'
                          : 'text-gray-300'
                      } ${canEdit && onItemDeadlineChange ? 'cursor-pointer hover:underline' : ''}`}
                      onClick={() => {
                        if (canEdit && onItemDeadlineChange) {
                          setEditingDeadline(item.id);
                          setEditDeadlineValue(item.deadline || '');
                        }
                      }}
                      title="クリックで期日を設定"
                    >
                      {item.deadline ? formatDeadline(item.deadline) : '期日'}
                    </div>
                  )}
                  {/* チェック列の完了率 */}
                  {item.column_type === 'check' && itemCompletionRates[item.id] && (
                    <div className="mt-0.5">
                      <span className={`text-[9px] px-1 rounded ${
                        itemCompletionRates[item.id].completed === itemCompletionRates[item.id].total
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-100 text-gray-500'
                      }`}>
                        {itemCompletionRates[item.id].completed}/{itemCompletionRates[item.id].total}
                      </span>
                    </div>
                  )}
                </th>
              ))
            )}
            <th className="border border-gray-200 px-2 py-2 text-center font-medium text-gray-700 min-w-[80px]">
              進捗
            </th>
          </tr>
        </thead>
        <tbody>
          {sortedStudents.map((student) => {
            const showGradeSeparator = student.grade !== lastGrade;
            lastGrade = student.grade || null;
            const completion = studentCompletionRates[student.id];
            const completionRate = completion && completion.total > 0 ? completion.completed / completion.total : 0;

            return (
              <tr key={student.id} className={`hover:bg-blue-50/30 ${showGradeSeparator ? 'border-t-2 border-t-gray-300' : ''}`}>
                <td className="border border-gray-200 px-2 py-1 text-center text-xs text-gray-600 sticky left-0 bg-white z-10">
                  {GRADE_LABELS[student.grade || 0] || ''}
                </td>
                <td className="border border-gray-200 px-2 py-1 sticky left-[48px] bg-white z-10">
                  <span className="text-xs font-medium text-[#1e3a5f] whitespace-nowrap">
                    {student.last_name} {student.first_name}
                  </span>
                </td>
                {columnGroups.flatMap((g) =>
                  g.items.map((item) => {
                    const d = progressMap.get(`${student.id}:${item.id}`);
                    const isEditing = editingCell?.studentId === student.id && editingCell?.itemId === item.id;

                    // 自動計算列
                    if (item.auto_source && item.column_type === 'number') {
                      const autoVal = getAutoValue(student.id, item.auto_source);
                      return (
                        <td key={item.id} className="border border-gray-200 px-1 py-1 text-center bg-blue-50/30">
                          <span className="text-xs text-blue-700 font-medium">{autoVal ?? 0}</span>
                        </td>
                      );
                    }

                    if (item.column_type === 'check') {
                      return (
                        <td
                          key={item.id}
                          className={`border border-gray-200 px-1 py-1 text-center cursor-pointer select-none ${statusBgClass(d?.status)}`}
                          onClick={() => handleCheckClick(student.id, item.id)}
                        >
                          <span className={`text-sm ${statusTextClass(d?.status)}`}>{statusSymbol(d?.status)}</span>
                        </td>
                      );
                    }

                    if (item.column_type === 'number') {
                      if (isEditing) {
                        return (
                          <td key={item.id} className="border border-gray-200 px-0 py-0">
                            <input
                              type="number"
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onBlur={() => handleNumberBlur(student.id, item.id)}
                              onKeyDown={(e) => handleKeyDown(e, student.id, item.id, 'number')}
                              autoFocus
                              className="w-full px-1 py-1 text-xs text-center border-0 focus:ring-1 focus:ring-[#3b82f6] outline-none"
                            />
                          </td>
                        );
                      }
                      return (
                        <td
                          key={item.id}
                          className="border border-gray-200 px-1 py-1 text-center cursor-pointer hover:bg-blue-50"
                          onClick={() => handleStartEdit(student.id, item.id, d?.number_value != null ? String(d.number_value) : '')}
                        >
                          <span className="text-xs text-[#1e3a5f]">{d?.number_value != null ? d.number_value : ''}</span>
                        </td>
                      );
                    }

                    if (item.column_type === 'date') {
                      if (isEditing) {
                        return (
                          <td key={item.id} className="border border-gray-200 px-0 py-0">
                            <input
                              type="date"
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onBlur={() => handleDateBlur(student.id, item.id)}
                              onKeyDown={(e) => handleKeyDown(e, student.id, item.id, 'date')}
                              autoFocus
                              className="w-full px-1 py-1 text-xs text-center border-0 focus:ring-1 focus:ring-[#3b82f6] outline-none"
                            />
                          </td>
                        );
                      }
                      const dateStr = d?.date_value
                        ? new Date(d.date_value).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })
                        : '';
                      return (
                        <td
                          key={item.id}
                          className="border border-gray-200 px-1 py-1 text-center cursor-pointer hover:bg-blue-50"
                          onClick={() => handleStartEdit(student.id, item.id, d?.date_value || '')}
                        >
                          <span className="text-xs text-[#1e3a5f]">{dateStr}</span>
                        </td>
                      );
                    }

                    return <td key={item.id} className="border border-gray-200" />;
                  })
                )}
                <td className="border border-gray-200 px-2 py-1">
                  <div className="flex items-center gap-1.5">
                    <div className="flex-1 bg-gray-100 rounded-full h-1.5 min-w-[40px]">
                      <div
                        className="h-1.5 rounded-full transition-all"
                        style={{
                          width: `${Math.round(completionRate * 100)}%`,
                          backgroundColor: completionRate >= 0.8 ? '#10b981' : completionRate >= 0.5 ? '#f59e0b' : '#ef4444',
                        }}
                      />
                    </div>
                    <span className="text-[10px] text-gray-400 whitespace-nowrap">
                      {completion ? `${completion.completed}/${completion.total}` : ''}
                    </span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
