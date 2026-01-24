'use client';

import type { Student, ApplicationItem, StudentApplication, ApplicationStatus, ApplicationColumnType } from '@/types/database';
import { GRADE_LABELS, APPLICATION_STATUS_SYMBOLS, APPLICATION_COLUMN_TYPE_LABELS } from '@/types/database';
import { updateStudentApplication, updateApplicationItem, createApplicationItem, deleteApplicationItem, updateStudentApplicationNumber, updateStudentApplicationDate } from '@/lib/api/applications';
import { useAuth } from '@/contexts/AuthContext';
import { useState } from 'react';
import { useToast } from '@/hooks/useToast';

interface ApplicationTableProps {
  students: Student[];
  items: ApplicationItem[];
  applications: StudentApplication[];
  onStatusChange?: (studentId: string, itemId: string, status: ApplicationStatus | null) => void;
  onNumberChange?: (studentId: string, itemId: string, numberValue: number | null) => void;
  onDateChange?: (studentId: string, itemId: string, dateValue: string | null) => void;
  onStudentClick?: (student: Student) => void;
  onItemsChange?: () => void; // 項目が変更されたときに呼ばれるコールバック
}

// ステータスのサイクル: 空白 → pending → completed → not_applicable → 空白
function getNextStatus(currentStatus: ApplicationStatus | null): ApplicationStatus | null {
  if (currentStatus === null) return 'pending';
  if (currentStatus === 'pending') return 'completed';
  if (currentStatus === 'completed') return 'not_applicable';
  if (currentStatus === 'not_applicable') return null;
  return null;
}

// ステータスの表示記号を取得
function getStatusSymbol(status: ApplicationStatus | null): string {
  if (status === null) return '';
  return APPLICATION_STATUS_SYMBOLS[status] || '';
}

// ステータスのスタイルを取得
function getStatusStyle(status: ApplicationStatus | null): string {
  if (status === null) return 'bg-[#fffffe] text-[#2a2a2a]';
  if (status === 'pending') return 'bg-[#eff0f3] text-[#2a2a2a]';
  if (status === 'completed') return 'bg-[#ff8e3c]/20 text-[#0d0d0d] font-semibold';
  if (status === 'not_applicable') return 'bg-[#eff0f3] text-[#2a2a2a]/60';
  return 'bg-[#fffffe] text-[#2a2a2a]';
}

export function ApplicationTable({
  students,
  items,
  applications,
  onStatusChange,
  onNumberChange,
  onDateChange,
  onStudentClick,
  onItemsChange,
}: ApplicationTableProps) {
  const { getSelectedSchoolIds, profile } = useAuth();
  const isTeacher = profile?.role === 'teacher';
  const [updatingCells, setUpdatingCells] = useState<Set<string>>(new Set());
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [newItemColumnType, setNewItemColumnType] = useState<ApplicationColumnType>('check');
  const [newItemDueDate, setNewItemDueDate] = useState<string>('');
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null);
  const [editingCell, setEditingCell] = useState<{ studentId: string; itemId: string; type: 'number' | 'date' } | null>(null);
  const [editingValue, setEditingValue] = useState<string>('');
  const { success, error: toastError } = useToast();

  // 申込状況をマップ化（student_id + item_id → application）
  const applicationMap = new Map<string, StudentApplication>();
  applications.forEach((app) => {
    applicationMap.set(`${app.student_id}-${app.item_id}`, app);
  });

  // 集計行の計算
  const summaryData = items.map((item) => {
    const totalStudents = students.length;
    const columnType = item.column_type || 'check';
    
    if (columnType === 'check') {
      const applicableStudents = students.filter((student) => {
        const key = `${student.id}-${item.id}`;
        const app = applicationMap.get(key);
        return app?.status !== 'not_applicable';
      }).length;
      const completedCount = students.filter((student) => {
        const key = `${student.id}-${item.id}`;
        const app = applicationMap.get(key);
        return app?.status === 'completed';
      }).length;
      const completionRate = applicableStudents > 0 
        ? Math.round((completedCount / applicableStudents) * 100) 
        : 0;

      return {
        itemId: item.id,
        columnType: 'check' as const,
        totalStudents,
        applicableStudents,
        completedCount,
        completionRate,
      };
    } else if (columnType === 'number') {
      const inputCount = students.filter((student) => {
        const key = `${student.id}-${item.id}`;
        const app = applicationMap.get(key);
        return app?.number_value != null;
      }).length;
      const total = students.reduce((sum, student) => {
        const key = `${student.id}-${item.id}`;
        const app = applicationMap.get(key);
        return sum + (app?.number_value || 0);
      }, 0);

      return {
        itemId: item.id,
        columnType: 'number' as const,
        totalStudents,
        inputCount,
        total,
      };
    } else { // date
      const inputCount = students.filter((student) => {
        const key = `${student.id}-${item.id}`;
        const app = applicationMap.get(key);
        return app?.date_value != null;
      }).length;
      const completionRate = totalStudents > 0 
        ? Math.round((inputCount / totalStudents) * 100) 
        : 0;

      return {
        itemId: item.id,
        columnType: 'date' as const,
        totalStudents,
        inputCount,
        completionRate,
      };
    }
  });

  const handleCellClick = async (studentId: string, itemId: string) => {
    // 編集権限がない場合は何もしない
    if (!onStatusChange) return;

    const key = `${studentId}-${itemId}`;
    const app = applicationMap.get(key);
    const currentStatus = app?.status || null;
    const nextStatus = getNextStatus(currentStatus);

    setUpdatingCells((prev) => new Set(prev).add(key));

    try {
      await updateStudentApplication(studentId, itemId, nextStatus);
      onStatusChange(studentId, itemId, nextStatus);
    } catch (error) {
      console.error('Failed to update application status:', error);
      alert('申込状況の更新に失敗しました');
    } finally {
      setUpdatingCells((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  return (
    <div className="bg-[#fffffe] rounded-xl border border-[#0d0d0d] overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-[#eff0f3] border-b border-[#0d0d0d]">
              <th className="px-4 py-3 text-left text-[#0d0d0d] font-semibold border-r border-[#0d0d0d] sticky left-0 bg-[#eff0f3] z-10">
                学年
              </th>
              <th className="px-4 py-3 text-left text-[#0d0d0d] font-semibold border-r border-[#0d0d0d] sticky left-[80px] bg-[#eff0f3] z-10">
                名前
              </th>
              {items.map((item) => {
                const columnType = item.column_type || 'check';
                const isOverdue = item.due_date && new Date(item.due_date) < new Date();
                const dueDateStr = item.due_date 
                  ? new Date(item.due_date).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })
                  : null;
                
                return (
                  <th
                    key={item.id}
                    className={`px-4 py-3 text-center text-[#0d0d0d] font-semibold border-r border-[#0d0d0d] min-w-[120px] relative group ${isOverdue ? 'bg-red-100' : ''}`}
                  >
                    {onStatusChange && editingItemId === item.id ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          onBlur={async () => {
                            if (editingName.trim() && editingName.trim() !== item.name) {
                              try {
                                await updateApplicationItem(item.id, { name: editingName.trim() });
                                success('項目名を更新しました');
                                onItemsChange?.();
                              } catch (err) {
                                toastError(
                                  err instanceof Error ? err.message : '項目名の更新に失敗しました'
                                );
                              }
                            }
                            setEditingItemId(null);
                            setEditingName('');
                          }}
                          onKeyDown={async (e) => {
                            if (e.key === 'Enter') {
                              e.currentTarget.blur();
                            } else if (e.key === 'Escape') {
                              setEditingItemId(null);
                              setEditingName('');
                            }
                          }}
                          autoFocus
                          className="flex-1 px-2 py-1 text-sm border border-[#0d0d0d] rounded bg-[#fffffe] text-[#0d0d0d] focus:outline-none focus:ring-2 focus:ring-[#ff8e3c]"
                        />
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-1">
                        <div className="flex items-center justify-center gap-1 w-full">
                          {onStatusChange ? (
                            <>
                              <div
                                className="flex-1 flex items-center justify-center gap-1 cursor-pointer hover:bg-[#ff8e3c]/10 rounded px-2 py-1 transition-colors"
                                onClick={() => {
                                  setEditingItemId(item.id);
                                  setEditingName(item.name);
                                }}
                                title="クリックして編集"
                              >
                                <span className="text-sm">{item.name}</span>
                                <span className="text-xs text-[#2a2a2a]/40 opacity-0 group-hover:opacity-100 transition-opacity">
                                  ✏️
                                </span>
                              </div>
                              <button
                                className="text-xs text-[#d9376e] hover:text-[#d9376e]/80 opacity-0 group-hover:opacity-100 transition-opacity px-1 py-1 rounded hover:bg-[#d9376e]/10"
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  if (
                                    window.confirm(
                                      `「${item.name}」を削除してもよろしいですか？\n\nこの列の全ての申込状況データも削除されます。`
                                    )
                                  ) {
                                    setDeletingItemId(item.id);
                                    try {
                                      await deleteApplicationItem(item.id);
                                      success('項目を削除しました');
                                      onItemsChange?.();
                                    } catch (err) {
                                      toastError(
                                        err instanceof Error
                                          ? err.message
                                          : '項目の削除に失敗しました'
                                      );
                                    } finally {
                                      setDeletingItemId(null);
                                    }
                                  }
                                }}
                                disabled={deletingItemId === item.id}
                                title="削除"
                              >
                                {deletingItemId === item.id ? (
                                  <span className="text-xs">...</span>
                                ) : (
                                  <span>🗑️</span>
                                )}
                              </button>
                            </>
                          ) : (
                            <span className="text-sm">{item.name}</span>
                          )}
                        </div>
                        <div className="text-[10px] text-[#2a2a2a]/70">
                          [{APPLICATION_COLUMN_TYPE_LABELS[columnType]}]
                        </div>
                        {dueDateStr && (
                          <div className={`text-[10px] ${isOverdue ? 'text-red-600 font-semibold' : 'text-[#2a2a2a]/70'}`}>
                            〆 {dueDateStr}
                          </div>
                        )}
                      </div>
                    )}
                  </th>
                );
              })}
              {/* 新規列追加ボタン（編集権限がある場合のみ表示） */}
              {onStatusChange && (
                <th className="px-4 py-3 text-center text-[#0d0d0d] font-semibold border-r border-[#0d0d0d] min-w-[120px]">
                  {isAddingNew ? (
                  <div className="flex flex-col gap-2">
                    <input
                      type="text"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      placeholder="項目名を入力"
                      className="w-full px-2 py-1 text-sm border border-[#0d0d0d] rounded bg-[#fffffe] text-[#0d0d0d] focus:outline-none focus:ring-2 focus:ring-[#ff8e3c]"
                    />
                    <select
                      value={newItemColumnType}
                      onChange={(e) => setNewItemColumnType(e.target.value as ApplicationColumnType)}
                      className="w-full px-2 py-1 text-sm border border-[#0d0d0d] rounded bg-[#fffffe] text-[#0d0d0d] focus:outline-none focus:ring-2 focus:ring-[#ff8e3c]"
                    >
                      <option value="check">チェック</option>
                      <option value="number">数値</option>
                      <option value="date">日付</option>
                    </select>
                    <input
                      type="date"
                      value={newItemDueDate}
                      onChange={(e) => setNewItemDueDate(e.target.value)}
                      placeholder="期日（任意）"
                      className="w-full px-2 py-1 text-sm border border-[#0d0d0d] rounded bg-[#fffffe] text-[#0d0d0d] focus:outline-none focus:ring-2 focus:ring-[#ff8e3c]"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={async () => {
                          if (editingName.trim()) {
                            try {
                              const schoolIds = getSelectedSchoolIds();
                              if (schoolIds.length === 0) {
                                toastError('教室が選択されていません');
                                return;
                              }
                              await createApplicationItem(
                                { 
                                  name: editingName.trim(),
                                  column_type: newItemColumnType,
                                  due_date: newItemDueDate || null,
                                }, 
                                schoolIds[0]
                              );
                              success('新しい項目を追加しました');
                              onItemsChange?.();
                              setIsAddingNew(false);
                              setEditingName('');
                              setNewItemColumnType('check');
                              setNewItemDueDate('');
                            } catch (err) {
                              toastError(
                                err instanceof Error ? err.message : '項目の追加に失敗しました'
                              );
                            }
                          }
                        }}
                        className="flex-1 px-2 py-1 text-xs bg-[#ff8e3c] text-[#0d0d0d] rounded hover:bg-[#ff7a1f] transition-colors"
                      >
                        追加
                      </button>
                      <button
                        onClick={() => {
                          setIsAddingNew(false);
                          setEditingName('');
                          setNewItemColumnType('check');
                          setNewItemDueDate('');
                        }}
                        className="flex-1 px-2 py-1 text-xs bg-[#eff0f3] text-[#2a2a2a] rounded hover:bg-[#0d0d0d]/10 transition-colors"
                      >
                        キャンセル
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setIsAddingNew(true);
                      setEditingName('');
                      setNewItemColumnType('check');
                      setNewItemDueDate('');
                    }}
                    className="w-full px-2 py-1 text-sm text-[#2a2a2a] hover:bg-[#ff8e3c]/10 rounded transition-colors border border-dashed border-[#0d0d0d] hover:border-[#ff8e3c]"
                    title="新しい列を追加"
                  >
                    + 追加
                  </button>
                  )}
                </th>
              )}
            </tr>
            {/* 集計行 */}
            <tr className="bg-[#eff0f3]/50 border-b border-[#0d0d0d]">
              <td colSpan={2} className="px-4 py-2 text-left text-[#2a2a2a] text-sm border-r border-[#0d0d0d] sticky left-0 bg-[#eff0f3]/50 z-10">
                集計
              </td>
              {summaryData.map((summary) => (
                <td
                  key={summary.itemId}
                  className="px-4 py-2 text-center text-[#2a2a2a] text-sm border-r border-[#0d0d0d]"
                >
                  {summary.columnType === 'check' && (
                    <div className="flex flex-col gap-1">
                      <span className="text-xs">
                        対象: {summary.applicableStudents}人
                      </span>
                      <span className="text-xs font-semibold">
                        申込済: {summary.completedCount}人 ({summary.completionRate}%)
                      </span>
                    </div>
                  )}
                  {summary.columnType === 'number' && (
                    <div className="flex flex-col gap-1">
                      <span className="text-xs font-semibold">
                        合計: {summary.total}
                      </span>
                      <span className="text-xs">
                        入力: {summary.inputCount}人
                      </span>
                    </div>
                  )}
                  {summary.columnType === 'date' && (
                    <div className="flex flex-col gap-1">
                      <span className="text-xs font-semibold">
                        入力済: {summary.inputCount}人 ({summary.completionRate}%)
                      </span>
                    </div>
                  )}
                </td>
              ))}
              {/* 新規列追加行の集計セル（空） */}
              <td className="px-4 py-2 text-center text-[#2a2a2a] text-sm border-r border-[#0d0d0d]">
                -
              </td>
            </tr>
          </thead>
          <tbody>
            {students.map((student) => (
              <tr
                key={student.id}
                className="border-b border-[#0d0d0d] hover:bg-[#eff0f3]/30"
              >
                <td className="px-4 py-3 text-[#2a2a2a] border-r border-[#0d0d0d] sticky left-0 bg-[#fffffe] z-10">
                  {GRADE_LABELS[student.grade] || student.grade}
                </td>
                <td
                  className={`px-4 py-3 text-[#2a2a2a] border-r border-[#0d0d0d] sticky left-[80px] bg-[#fffffe] z-10 ${
                    onStudentClick ? 'cursor-pointer hover:text-[#ff8e3c]' : ''
                  }`}
                  onClick={() => onStudentClick?.(student)}
                >
                  {student.last_name} {student.first_name}
                </td>
                {items.map((item) => {
                  const key = `${student.id}-${item.id}`;
                  const app = applicationMap.get(key);
                  const isUpdating = updatingCells.has(key);
                  const columnType = item.column_type || 'check';
                  const isOverdue = item.due_date && new Date(item.due_date) < new Date();
                  const hasValue = columnType === 'check' 
                    ? app?.status != null
                    : columnType === 'number'
                    ? app?.number_value != null
                    : app?.date_value != null;
                  const isOverdueAndIncomplete = isOverdue && !hasValue;
                  // 講師の場合、teacher_editableがfalseの列は編集不可
                  const canEdit = !isTeacher || item.teacher_editable === true;

                  if (columnType === 'check') {
                    const status = app?.status || null;
                    const symbol = getStatusSymbol(status);
                    const style = getStatusStyle(status);

                    return (
                      <td
                        key={item.id}
                        className={`px-4 py-3 text-center border-r border-[#0d0d0d] transition-colors ${style} ${
                          isOverdueAndIncomplete ? 'bg-red-100' : ''
                        } ${
                          isUpdating ? 'opacity-50' : (onStatusChange && canEdit) ? 'cursor-pointer hover:bg-[#ff8e3c]/10' : 'cursor-default opacity-60'
                        }`}
                        onClick={() => onStatusChange && !isUpdating && canEdit && handleCellClick(student.id, item.id)}
                        title={
                          status === null
                            ? '未確認（クリックで未申込に）'
                            : status === 'pending'
                            ? '未申込（クリックで申込済に）'
                            : status === 'completed'
                            ? '申込済（クリックで対象外に）'
                            : '対象外（クリックで未確認に）'
                        }
                      >
                        {isUpdating ? (
                          <span className="text-[#2a2a2a]">...</span>
                        ) : (
                          <span className="text-lg font-semibold">{symbol}</span>
                        )}
                      </td>
                    );
                  } else if (columnType === 'number') {
                    const numberValue = app?.number_value ?? null;
                    const isEditing = editingCell?.studentId === student.id && editingCell?.itemId === item.id && editingCell?.type === 'number';

                    return (
                      <td
                        key={item.id}
                        className={`px-4 py-3 text-center border-r border-[#0d0d0d] transition-colors ${
                          isOverdueAndIncomplete ? 'bg-red-100' : 'bg-[#fffffe]'
                        } ${
                          isUpdating ? 'opacity-50' : (onNumberChange && canEdit) ? 'cursor-pointer hover:bg-[#ff8e3c]/10' : 'cursor-default opacity-60'
                        }`}
                        onClick={() => {
                          if (onNumberChange && !isUpdating && !isEditing && canEdit) {
                            setEditingCell({ studentId: student.id, itemId: item.id, type: 'number' });
                            setEditingValue(numberValue?.toString() || '');
                          }
                        }}
                      >
                        {isEditing ? (
                          <input
                            type="number"
                            value={editingValue}
                            onChange={(e) => setEditingValue(e.target.value)}
                            onBlur={async () => {
                              const numValue = editingValue.trim() === '' ? null : Number(editingValue);
                              setUpdatingCells((prev) => new Set(prev).add(key));
                              try {
                                await updateStudentApplicationNumber(student.id, item.id, numValue);
                                onNumberChange?.(student.id, item.id, numValue);
                              } catch (error) {
                                console.error('Failed to update number:', error);
                                alert('数値の更新に失敗しました');
                              } finally {
                                setUpdatingCells((prev) => {
                                  const next = new Set(prev);
                                  next.delete(key);
                                  return next;
                                });
                                setEditingCell(null);
                                setEditingValue('');
                              }
                            }}
                            onKeyDown={async (e) => {
                              if (e.key === 'Enter') {
                                e.currentTarget.blur();
                              } else if (e.key === 'Escape') {
                                setEditingCell(null);
                                setEditingValue('');
                              }
                            }}
                            autoFocus
                            className="w-full px-2 py-1 text-sm border border-[#0d0d0d] rounded bg-[#fffffe] text-[#0d0d0d] focus:outline-none focus:ring-2 focus:ring-[#ff8e3c]"
                          />
                        ) : isUpdating ? (
                          <span className="text-[#2a2a2a]">...</span>
                        ) : (
                          <span className="text-sm">{numberValue != null ? numberValue : '-'}</span>
                        )}
                      </td>
                    );
                  } else { // date
                    const dateValue = app?.date_value ?? null;
                    const isEditing = editingCell?.studentId === student.id && editingCell?.itemId === item.id && editingCell?.type === 'date';
                    const displayDate = dateValue 
                      ? new Date(dateValue).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })
                      : '-';

                    return (
                      <td
                        key={item.id}
                        className={`px-4 py-3 text-center border-r border-[#0d0d0d] transition-colors ${
                          isOverdueAndIncomplete ? 'bg-red-100' : 'bg-[#fffffe]'
                        } ${
                          isUpdating ? 'opacity-50' : (onDateChange && canEdit) ? 'cursor-pointer hover:bg-[#ff8e3c]/10' : 'cursor-default opacity-60'
                        }`}
                        onClick={() => {
                          if (onDateChange && !isUpdating && !isEditing && canEdit) {
                            setEditingCell({ studentId: student.id, itemId: item.id, type: 'date' });
                            setEditingValue(dateValue || '');
                          }
                        }}
                      >
                        {isEditing ? (
                          <input
                            type="date"
                            value={editingValue}
                            onChange={(e) => setEditingValue(e.target.value)}
                            onBlur={async () => {
                              const dateVal = editingValue.trim() === '' ? null : editingValue;
                              setUpdatingCells((prev) => new Set(prev).add(key));
                              try {
                                await updateStudentApplicationDate(student.id, item.id, dateVal);
                                onDateChange?.(student.id, item.id, dateVal);
                              } catch (error) {
                                console.error('Failed to update date:', error);
                                alert('日付の更新に失敗しました');
                              } finally {
                                setUpdatingCells((prev) => {
                                  const next = new Set(prev);
                                  next.delete(key);
                                  return next;
                                });
                                setEditingCell(null);
                                setEditingValue('');
                              }
                            }}
                            onKeyDown={async (e) => {
                              if (e.key === 'Enter') {
                                e.currentTarget.blur();
                              } else if (e.key === 'Escape') {
                                setEditingCell(null);
                                setEditingValue('');
                              }
                            }}
                            autoFocus
                            className="w-full px-2 py-1 text-sm border border-[#0d0d0d] rounded bg-[#fffffe] text-[#0d0d0d] focus:outline-none focus:ring-2 focus:ring-[#ff8e3c]"
                          />
                        ) : isUpdating ? (
                          <span className="text-[#2a2a2a]">...</span>
                        ) : (
                          <span className="text-sm">{displayDate}</span>
                        )}
                      </td>
                    );
                  }
                })}
                {/* 新規列追加行のセル（空）- 編集権限がある場合のみ表示 */}
                {onStatusChange && (
                  <td className="px-4 py-3 text-center border-r border-[#0d0d0d] bg-[#eff0f3]">
                    -
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
