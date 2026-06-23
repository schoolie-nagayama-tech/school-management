'use client';

import type {
  Student,
  ApplicationItem,
  StudentApplication,
  ApplicationStatus,
  ApplicationColumnType,
} from '@/types/database';
import {
  GRADE_LABELS,
  APPLICATION_STATUS_SYMBOLS,
  APPLICATION_COLUMN_TYPE_LABELS,
} from '@/types/database';
import {
  updateStudentApplication,
  updateApplicationItem,
  createApplicationItem,
  deleteApplicationItem,
  updateStudentApplicationNumber,
  updateStudentApplicationDate,
} from '@/lib/api/applications';
import { useAuth } from '@/contexts/AuthContext';
import { useState } from 'react';
import { useToast } from '@/hooks/useToast';
import { Lock, Pencil, Trash2 } from 'lucide-react';
import { useConfirm } from '@/hooks/useConfirm';

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
  if (status === null) return 'bg-white text-[#4b5563]';
  if (status === 'pending') return 'bg-[#f3f4f6] text-[#4b5563]';
  if (status === 'completed') return 'bg-[#3b82f6]/20 text-[#1f2937] font-semibold';
  if (status === 'not_applicable') return 'bg-[#f3f4f6] text-[#4b5563]/60';
  return 'bg-white text-[#4b5563]';
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
  const { confirm, ConfirmDialog } = useConfirm();
  const isTeacher = profile?.role === 'teacher';
  const [updatingCells, setUpdatingCells] = useState<Set<string>>(new Set());
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [newItemColumnType, setNewItemColumnType] = useState<ApplicationColumnType>('check');
  const [newItemDueDate, setNewItemDueDate] = useState<string>('');
  const [newItemManagerOnly, setNewItemManagerOnly] = useState(false);
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null);
  const [editingCell, setEditingCell] = useState<{
    studentId: string;
    itemId: string;
    type: 'number' | 'date';
  } | null>(null);
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
      const completionRate =
        applicableStudents > 0 ? Math.round((completedCount / applicableStudents) * 100) : 0;

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
    } else {
      // date
      const inputCount = students.filter((student) => {
        const key = `${student.id}-${item.id}`;
        const app = applicationMap.get(key);
        return app?.date_value != null;
      }).length;
      const completionRate = totalStudents > 0 ? Math.round((inputCount / totalStudents) * 100) : 0;

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
      toastError('申込状況の更新に失敗しました');
    } finally {
      setUpdatingCells((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  return (
    <div className="bg-white rounded-xl border border-[#e5e7eb] overflow-hidden">
      <div className="overflow-auto max-h-[calc(100vh-200px)]">
        <table className="w-full border-collapse table-fixed">
          <thead className="sticky top-0 z-30">
            <tr className="bg-[#1e3a5f] border-b border-[#e5e7eb]">
              <th className="px-3 py-2 text-left text-white text-xs font-semibold border-r border-[#2d4a6f] sticky left-0 bg-[#1e3a5f] z-40 w-[60px]">
                学年
              </th>
              <th
                className="px-3 py-2 text-left text-white text-xs font-semibold border-r border-[#2d4a6f] sticky left-[60px] bg-[#1e3a5f] z-40 w-[160px]"
                style={{ boxShadow: '4px 0 6px -2px rgba(0,0,0,0.15)' }}
              >
                名前
              </th>
              {items.map((item) => {
                const columnType = item.column_type || 'check';
                const isOverdue = item.due_date && new Date(item.due_date) < new Date();
                const dueDateStr = item.due_date
                  ? new Date(item.due_date).toLocaleDateString('ja-JP', {
                      month: 'numeric',
                      day: 'numeric',
                    })
                  : null;

                const isReadOnlyForTeacher = isTeacher && !item.teacher_editable;
                return (
                  <th
                    key={item.id}
                    className={`px-3 py-2 text-center text-xs font-semibold border-r border-[#2d4a6f] relative group ${isOverdue ? 'bg-[#7f1d1d] text-white' : 'text-white'} ${isReadOnlyForTeacher ? 'bg-[#2d4a6f]' : ''}`}
                  >
                    {onStatusChange && !isTeacher && editingItemId === item.id ? (
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
                          className="flex-1 px-2 py-1 text-sm border border-[#e5e7eb] rounded bg-white text-[#1f2937] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]"
                        />
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-1">
                        <div className="flex items-center justify-center gap-1 w-full">
                          {onStatusChange && !isTeacher ? (
                            <>
                              <div
                                className="flex-1 flex items-center justify-center gap-1 cursor-pointer hover:bg-white/10 rounded px-1 py-0.5 transition-colors duration-150"
                                onClick={() => {
                                  setEditingItemId(item.id);
                                  setEditingName(item.name);
                                }}
                                title="クリックして編集"
                              >
                                <span className="text-xs text-white">{item.name}</span>
                                <Pencil className="h-3 w-3 text-white/50 opacity-0 group-hover:opacity-100 transition-opacity duration-150" />
                              </div>
                              <button
                                className="text-[10px] text-red-300 hover:text-red-200 opacity-0 group-hover:opacity-100 transition-opacity px-1 py-0.5 rounded hover:bg-red-500/20"
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  if (
                                    await confirm({
                                      title: '削除確認',
                                      description: `「${item.name}」を削除してもよろしいですか？この列の全ての申込状況データも削除されます。`,
                                      confirmLabel: '削除',
                                      variant: 'danger',
                                    })
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
                                  <Trash2 className="h-3 w-3" />
                                )}
                              </button>
                            </>
                          ) : (
                            <span className="text-xs text-white flex items-center justify-center gap-1 flex-wrap">
                              {item.name}
                              {isTeacher && !item.teacher_editable && (
                                <span title="閲覧のみ" className="inline-flex">
                                  <Lock className="w-3 h-3 text-amber-300 shrink-0" aria-hidden />
                                </span>
                              )}
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-white/50">
                          {APPLICATION_COLUMN_TYPE_LABELS[columnType]}
                        </div>
                        {dueDateStr && (
                          <div
                            className={`text-[10px] ${isOverdue ? 'text-red-300 font-semibold' : 'text-white/50'}`}
                          >
                            〆 {dueDateStr}
                          </div>
                        )}
                      </div>
                    )}
                  </th>
                );
              })}
              {/* 新規列追加ボタン（室長以上のみ。講師は非表示） */}
              {onStatusChange && !isTeacher && (
                <th className="px-3 py-2 text-center text-white text-xs font-semibold border-r border-[#2d4a6f] w-[120px]">
                  {isAddingNew ? (
                    <div className="flex flex-col gap-2">
                      <input
                        type="text"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        placeholder="項目名を入力"
                        className="w-full px-2 py-1 text-sm border border-[#e5e7eb] rounded bg-white text-[#1f2937] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]"
                      />
                      <select
                        value={newItemColumnType}
                        onChange={(e) =>
                          setNewItemColumnType(e.target.value as ApplicationColumnType)
                        }
                        className="w-full px-2 py-1 text-sm border border-[#e5e7eb] rounded bg-white text-[#1f2937] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]"
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
                        className="w-full px-2 py-1 text-sm border border-[#e5e7eb] rounded bg-white text-[#1f2937] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]"
                      />
                      <label className="flex items-center gap-2 text-sm text-[#4b5563]">
                        <input
                          type="checkbox"
                          checked={newItemManagerOnly}
                          onChange={(e) => setNewItemManagerOnly(e.target.checked)}
                          className="w-4 h-4 text-[#3b82f6] border-[#e5e7eb] rounded focus:ring-[#3b82f6]"
                        />
                        <span>室長以上のみ表示（講師には非表示）</span>
                      </label>
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
                                    manager_only: newItemManagerOnly,
                                  },
                                  schoolIds[0]
                                );
                                success('新しい項目を追加しました');
                                onItemsChange?.();
                                setIsAddingNew(false);
                                setEditingName('');
                                setNewItemColumnType('check');
                                setNewItemDueDate('');
                                setNewItemManagerOnly(false);
                              } catch (err) {
                                toastError(
                                  err instanceof Error ? err.message : '項目の追加に失敗しました'
                                );
                              }
                            }
                          }}
                          className="flex-1 px-2 py-1 text-xs bg-[#3b82f6] text-white rounded hover:bg-[#60a5fa] transition-colors duration-150"
                        >
                          追加
                        </button>
                        <button
                          onClick={() => {
                            setIsAddingNew(false);
                            setEditingName('');
                            setNewItemColumnType('check');
                            setNewItemDueDate('');
                            setNewItemManagerOnly(false);
                          }}
                          className="flex-1 px-2 py-1 text-xs bg-[#f3f4f6] text-[#4b5563] rounded hover:bg-[#e5e7eb] transition-colors duration-150"
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
                      className="w-full px-2 py-1 text-sm text-[#4b5563] hover:bg-[#3b82f6]/10 rounded transition-colors duration-150 border border-dashed border-[#e5e7eb] hover:border-[#3b82f6]"
                      title="新しい列を追加"
                    >
                      + 追加
                    </button>
                  )}
                </th>
              )}
            </tr>
            {/* 集計行 */}
            <tr className="bg-[#f0f4f8] border-b border-[#e5e7eb]">
              <td className="px-3 py-1.5 text-left text-[#4b5563] text-xs border-r border-[#e5e7eb] sticky left-0 bg-[#f0f4f8] z-40 w-[60px]">
                集計
              </td>
              <td
                className="px-3 py-1.5 text-left text-[#4b5563] text-xs border-r border-[#e5e7eb] sticky left-[60px] bg-[#f0f4f8] z-40 w-[160px]"
                style={{ boxShadow: '4px 0 6px -2px rgba(0,0,0,0.08)' }}
              ></td>
              {summaryData.map((summary) => (
                <td
                  key={summary.itemId}
                  className="px-3 py-1.5 text-center text-[#4b5563] text-[11px] border-r border-[#e5e7eb] bg-[#f0f4f8]"
                >
                  {summary.columnType === 'check' && (
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[11px] text-[#6b7280]">
                        対象: {summary.applicableStudents}人
                      </span>
                      <span className="text-[11px] font-semibold text-[#1e3a5f]">
                        済: {summary.completedCount} ({summary.completionRate}%)
                      </span>
                    </div>
                  )}
                  {summary.columnType === 'number' && (
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[11px] font-semibold text-[#1e3a5f]">
                        計: {summary.total}
                      </span>
                      <span className="text-[11px] text-[#6b7280]">
                        入力: {summary.inputCount}人
                      </span>
                    </div>
                  )}
                  {summary.columnType === 'date' && (
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[11px] font-semibold text-[#1e3a5f]">
                        入力済: {summary.inputCount} ({summary.completionRate}%)
                      </span>
                    </div>
                  )}
                </td>
              ))}
              {/* 新規列追加行の集計セル（空）- 室長以上のみ表示 */}
              {onStatusChange && !isTeacher && (
                <td className="px-3 py-1.5 text-center text-[#6b7280] text-[11px] border-r border-[#e5e7eb] bg-[#f0f4f8]">
                  -
                </td>
              )}
            </tr>
          </thead>
          <tbody>
            {students.map((student, idx) => {
              const rowBg = idx % 2 === 0 ? 'bg-white' : 'bg-[#f8fafc]';
              return (
                <tr
                  key={student.id}
                  className={`border-b border-[#e5e7eb] hover:bg-[#e8f0fe] transition-colors duration-150 ${rowBg}`}
                >
                  <td
                    className={`px-3 py-2 text-xs text-[#4b5563] border-r border-[#e5e7eb] sticky left-0 ${rowBg} z-20 w-[60px]`}
                  >
                    {GRADE_LABELS[student.grade] || student.grade}
                  </td>
                  <td
                    className={`px-3 py-2 text-xs text-[#1f2937] border-r border-[#e5e7eb] sticky left-[60px] ${rowBg} z-20 w-[160px] whitespace-nowrap transition-colors duration-150 ${
                      onStudentClick ? 'cursor-pointer hover:text-[#3b82f6]' : ''
                    }`}
                    style={{ boxShadow: '4px 0 6px -2px rgba(0,0,0,0.08)' }}
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
                    const hasValue =
                      columnType === 'check'
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
                          className={`px-3 py-2 text-center border-r border-[#e5e7eb] transition-colors duration-150 ${style} ${
                            isOverdueAndIncomplete ? 'bg-red-100' : ''
                          } ${isTeacher && !canEdit ? 'bg-amber-50/50' : ''} ${
                            isUpdating
                              ? 'opacity-50'
                              : onStatusChange && canEdit
                                ? 'cursor-pointer hover:bg-[#3b82f6]/10'
                                : 'cursor-default opacity-60'
                          }`}
                          onClick={() =>
                            onStatusChange &&
                            !isUpdating &&
                            canEdit &&
                            handleCellClick(student.id, item.id)
                          }
                          title={
                            isTeacher && !canEdit
                              ? '閲覧のみ（講師は編集できません）'
                              : status === null
                                ? '未確認（クリックで未申込に）'
                                : status === 'pending'
                                  ? '未申込（クリックで申込済に）'
                                  : status === 'completed'
                                    ? '申込済（クリックで対象外に）'
                                    : '対象外（クリックで未確認に）'
                          }
                        >
                          {isUpdating ? (
                            <span className="text-[#4b5563]">...</span>
                          ) : (
                            <span className="text-sm font-semibold">{symbol}</span>
                          )}
                        </td>
                      );
                    } else if (columnType === 'number') {
                      const numberValue = app?.number_value ?? null;
                      const isEditing =
                        editingCell?.studentId === student.id &&
                        editingCell?.itemId === item.id &&
                        editingCell?.type === 'number';

                      return (
                        <td
                          key={item.id}
                          className={`px-3 py-2 text-center border-r border-[#e5e7eb] transition-colors duration-150 ${
                            isOverdueAndIncomplete ? 'bg-red-100' : 'bg-white'
                          } ${isTeacher && !canEdit ? 'bg-amber-50/50' : ''} ${
                            isUpdating
                              ? 'opacity-50'
                              : onNumberChange && canEdit
                                ? 'cursor-pointer hover:bg-[#3b82f6]/10'
                                : 'cursor-default opacity-60'
                          }`}
                          onClick={() => {
                            if (onNumberChange && !isUpdating && !isEditing && canEdit) {
                              setEditingCell({
                                studentId: student.id,
                                itemId: item.id,
                                type: 'number',
                              });
                              setEditingValue(numberValue?.toString() || '');
                            }
                          }}
                          title={
                            isTeacher && !canEdit ? '閲覧のみ（講師は編集できません）' : undefined
                          }
                        >
                          {isEditing ? (
                            <input
                              type="number"
                              value={editingValue}
                              onChange={(e) => setEditingValue(e.target.value)}
                              onBlur={async () => {
                                // onBlur 時点でも canEdit を再チェック。権限が無い場合は保存せずキャンセル
                                if (!canEdit) {
                                  setEditingCell(null);
                                  setEditingValue('');
                                  return;
                                }
                                const numValue =
                                  editingValue.trim() === '' ? null : Number(editingValue);
                                setUpdatingCells((prev) => new Set(prev).add(key));
                                try {
                                  await updateStudentApplicationNumber(
                                    student.id,
                                    item.id,
                                    numValue
                                  );
                                  onNumberChange?.(student.id, item.id, numValue);
                                } catch (error) {
                                  console.error('Failed to update number:', error);
                                  toastError('数値の更新に失敗しました');
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
                              className="w-full px-2 py-1 text-sm border border-[#e5e7eb] rounded bg-white text-[#1f2937] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]"
                            />
                          ) : isUpdating ? (
                            <span className="text-[#4b5563]">...</span>
                          ) : (
                            <span className="text-sm">
                              {numberValue != null ? numberValue : '-'}
                            </span>
                          )}
                        </td>
                      );
                    } else {
                      // date
                      const dateValue = app?.date_value ?? null;
                      const isEditing =
                        editingCell?.studentId === student.id &&
                        editingCell?.itemId === item.id &&
                        editingCell?.type === 'date';
                      const displayDate = dateValue
                        ? new Date(dateValue).toLocaleDateString('ja-JP', {
                            month: 'numeric',
                            day: 'numeric',
                          })
                        : '-';

                      return (
                        <td
                          key={item.id}
                          className={`px-3 py-2 text-center border-r border-[#e5e7eb] transition-colors duration-150 ${
                            isOverdueAndIncomplete ? 'bg-red-100' : 'bg-white'
                          } ${isTeacher && !canEdit ? 'bg-amber-50/50' : ''} ${
                            isUpdating
                              ? 'opacity-50'
                              : onDateChange && canEdit
                                ? 'cursor-pointer hover:bg-[#3b82f6]/10'
                                : 'cursor-default opacity-60'
                          }`}
                          onClick={() => {
                            if (onDateChange && !isUpdating && !isEditing && canEdit) {
                              setEditingCell({
                                studentId: student.id,
                                itemId: item.id,
                                type: 'date',
                              });
                              setEditingValue(dateValue || '');
                            }
                          }}
                          title={
                            isTeacher && !canEdit ? '閲覧のみ（講師は編集できません）' : undefined
                          }
                        >
                          {isEditing ? (
                            <input
                              type="date"
                              value={editingValue}
                              onChange={(e) => setEditingValue(e.target.value)}
                              onBlur={async () => {
                                // onBlur 時点でも canEdit を再チェック。権限が無い場合は保存せずキャンセル
                                if (!canEdit) {
                                  setEditingCell(null);
                                  setEditingValue('');
                                  return;
                                }
                                const dateVal = editingValue.trim() === '' ? null : editingValue;
                                setUpdatingCells((prev) => new Set(prev).add(key));
                                try {
                                  await updateStudentApplicationDate(student.id, item.id, dateVal);
                                  onDateChange?.(student.id, item.id, dateVal);
                                } catch (error) {
                                  console.error('Failed to update date:', error);
                                  toastError('日付の更新に失敗しました');
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
                              className="w-full px-2 py-1 text-sm border border-[#e5e7eb] rounded bg-white text-[#1f2937] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]"
                            />
                          ) : isUpdating ? (
                            <span className="text-[#4b5563]">...</span>
                          ) : (
                            <span className="text-sm">{displayDate}</span>
                          )}
                        </td>
                      );
                    }
                  })}
                  {/* 新規列追加行のセル（空）- 室長以上のみ表示 */}
                  {onStatusChange && !isTeacher && (
                    <td className="px-3 py-2 text-center border-r border-[#e5e7eb] text-[#d1d5db] text-xs">
                      -
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {ConfirmDialog}
    </div>
  );
}
