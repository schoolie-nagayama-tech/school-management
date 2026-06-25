'use client';

import { useState } from 'react';
import type {
  Student,
  ApplicationItem,
  StudentApplication,
  ApplicationStatus,
} from '@/types/database';
import { GRADE_LABELS } from '@/types/database';
import {
  updateStudentApplication,
  updateStudentApplicationNumber,
  updateStudentApplicationDate,
} from '@/lib/api/applications';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/useToast';
import { Lock } from 'lucide-react';
import { getNextStatus } from './ApplicationTable';

/**
 * 申込状況のモバイル用カード表示（アダプティブ）。
 *
 * 横に広い ApplicationTable（生徒×申込項目のマトリクス）はスマホで扱えないため、
 * lg 未満では「1生徒=1カード・申込項目を縦に列挙」する本コンポーネントへ切り替える。
 * 状態サイクルの定義（getNextStatus）と更新API（updateStudentApplication 等）は
 * テーブルと共有し、挙動がPCとズレないようにする。列の追加/編集/削除は管理操作のため
 * PC（テーブル）側に限定し、カードには出さない。
 */
interface ApplicationCardListProps {
  students: Student[];
  items: ApplicationItem[];
  applications: StudentApplication[];
  onStatusChange?: (studentId: string, itemId: string, status: ApplicationStatus | null) => void;
  onNumberChange?: (studentId: string, itemId: string, numberValue: number | null) => void;
  onDateChange?: (studentId: string, itemId: string, dateValue: string | null) => void;
  onStudentClick?: (student: Student) => void;
}

// チェック型のステータス → カード用のラベルとトークン配色（テーブルの tooltip 文言に合わせる）
const STATUS_META: Record<'null' | ApplicationStatus, { label: string; className: string }> = {
  null: { label: '未確認', className: 'border border-border text-text-faint' },
  pending: { label: '未申込', className: 'bg-surface-hover text-text-body' },
  completed: { label: '申込済', className: 'bg-info-subtle text-info font-semibold' },
  not_applicable: { label: '対象外', className: 'bg-surface-hover text-text-faint' },
};

function statusMeta(status: ApplicationStatus | null) {
  return STATUS_META[status ?? 'null'];
}

export function ApplicationCardList({
  students,
  items,
  applications,
  onStatusChange,
  onNumberChange,
  onDateChange,
  onStudentClick,
}: ApplicationCardListProps) {
  const { profile } = useAuth();
  const { error: toastError } = useToast();
  const isTeacher = profile?.role === 'teacher';

  // 申込状況をマップ化（student_id + item_id → application）
  const applicationMap = new Map<string, StudentApplication>();
  applications.forEach((app) => applicationMap.set(`${app.student_id}-${app.item_id}`, app));

  const [updatingCells, setUpdatingCells] = useState<Set<string>>(new Set());
  const [editingCell, setEditingCell] = useState<{
    studentId: string;
    itemId: string;
    type: 'number' | 'date';
  } | null>(null);
  const [editingValue, setEditingValue] = useState('');

  const markUpdating = (key: string, on: boolean) =>
    setUpdatingCells((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  // チェック型: タップで状態をサイクル（テーブルの handleCellClick と同じ）
  const handleStatusTap = async (studentId: string, itemId: string) => {
    if (!onStatusChange) return;
    const key = `${studentId}-${itemId}`;
    const current = applicationMap.get(key)?.status ?? null;
    const next = getNextStatus(current);
    markUpdating(key, true);
    try {
      await updateStudentApplication(studentId, itemId, next);
      onStatusChange(studentId, itemId, next);
    } catch (e) {
      console.error('Failed to update application status:', e);
      toastError('申込状況の更新に失敗しました');
    } finally {
      markUpdating(key, false);
    }
  };

  const commitNumber = async (studentId: string, itemId: string) => {
    const key = `${studentId}-${itemId}`;
    const value = editingValue.trim() === '' ? null : Number(editingValue);
    markUpdating(key, true);
    try {
      await updateStudentApplicationNumber(studentId, itemId, value);
      onNumberChange?.(studentId, itemId, value);
    } catch (e) {
      console.error('Failed to update number:', e);
      toastError('数値の更新に失敗しました');
    } finally {
      markUpdating(key, false);
      setEditingCell(null);
      setEditingValue('');
    }
  };

  const commitDate = async (studentId: string, itemId: string) => {
    const key = `${studentId}-${itemId}`;
    const value = editingValue.trim() === '' ? null : editingValue;
    markUpdating(key, true);
    try {
      await updateStudentApplicationDate(studentId, itemId, value);
      onDateChange?.(studentId, itemId, value);
    } catch (e) {
      console.error('Failed to update date:', e);
      toastError('日付の更新に失敗しました');
    } finally {
      markUpdating(key, false);
      setEditingCell(null);
      setEditingValue('');
    }
  };

  if (students.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface p-8 text-center">
        <p className="text-text-muted">表示できる生徒がいません</p>
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {students.map((student) => (
        <div
          key={student.id}
          className="overflow-hidden rounded-xl border border-border bg-surface-raised"
        >
          {/* カードヘッダー: 学年 + 氏名（タップで詳細） */}
          <button
            type="button"
            onClick={() => onStudentClick?.(student)}
            disabled={!onStudentClick}
            className={`flex w-full items-center gap-2 border-b border-border-subtle px-3.5 py-2.5 text-left transition-colors duration-150 ${
              onStudentClick ? 'hover:bg-surface-hover active:scale-[0.99]' : ''
            }`}
          >
            <span className="shrink-0 rounded-md bg-surface-hover px-2 py-0.5 text-xs font-medium text-text-muted">
              {GRADE_LABELS[student.grade] || student.grade}
            </span>
            <span className="truncate text-sm font-semibold text-text-heading">
              {student.last_name} {student.first_name}
            </span>
          </button>

          {/* 申込項目の行 */}
          <div className="divide-y divide-border-subtle">
            {items.map((item) => {
              const key = `${student.id}-${item.id}`;
              const app = applicationMap.get(key);
              const columnType = item.column_type || 'check';
              const isUpdating = updatingCells.has(key);
              const canEdit = !isTeacher || item.teacher_editable === true;
              const isOverdue = !!item.due_date && new Date(item.due_date) < new Date();
              const hasValue =
                columnType === 'check'
                  ? app?.status != null
                  : columnType === 'number'
                    ? app?.number_value != null
                    : app?.date_value != null;
              const isOverdueIncomplete = isOverdue && !hasValue;
              const dueDateStr = item.due_date
                ? new Date(item.due_date).toLocaleDateString('ja-JP', {
                    month: 'numeric',
                    day: 'numeric',
                  })
                : null;
              const isEditing =
                editingCell?.studentId === student.id && editingCell?.itemId === item.id;

              return (
                <div
                  key={item.id}
                  className={`flex items-center justify-between gap-3 px-3.5 py-2.5 ${
                    isOverdueIncomplete ? 'bg-danger-subtle' : ''
                  }`}
                >
                  {/* 項目名 + 期日 + 閲覧のみ */}
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-sm text-text-body">
                      <span className="truncate">{item.name}</span>
                      {isTeacher && !item.teacher_editable && (
                        <span title="閲覧のみ" className="inline-flex">
                          <Lock className="h-3 w-3 shrink-0 text-warning" aria-hidden />
                        </span>
                      )}
                    </div>
                    {dueDateStr && (
                      <div
                        className={`text-[11px] ${isOverdue ? 'font-semibold text-danger' : 'text-text-faint'}`}
                      >
                        〆 {dueDateStr}
                      </div>
                    )}
                  </div>

                  {/* 値コントロール */}
                  <div className="shrink-0">
                    {columnType === 'check' &&
                      (() => {
                        const meta = statusMeta(app?.status ?? null);
                        const tappable = !!onStatusChange && canEdit && !isUpdating;
                        return (
                          <button
                            type="button"
                            disabled={!tappable}
                            onClick={() => tappable && handleStatusTap(student.id, item.id)}
                            className={`min-w-[68px] rounded-lg px-2.5 py-1.5 text-center text-xs transition-[background-color,transform] duration-150 ${meta.className} ${
                              tappable ? 'active:scale-[0.96]' : 'opacity-70'
                            }`}
                          >
                            {isUpdating ? '…' : meta.label}
                          </button>
                        );
                      })()}

                    {columnType === 'number' &&
                      (isEditing && editingCell?.type === 'number' ? (
                        <input
                          type="number"
                          value={editingValue}
                          onChange={(e) => setEditingValue(e.target.value)}
                          onBlur={() => {
                            if (!canEdit) {
                              setEditingCell(null);
                              setEditingValue('');
                              return;
                            }
                            commitNumber(student.id, item.id);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') e.currentTarget.blur();
                            else if (e.key === 'Escape') {
                              setEditingCell(null);
                              setEditingValue('');
                            }
                          }}
                          autoFocus
                          className="w-20 rounded-lg border border-border bg-surface-raised px-2 py-1.5 text-right text-sm text-text-heading focus:outline-none focus:ring-2 focus:ring-info/30"
                        />
                      ) : (
                        <button
                          type="button"
                          disabled={!onNumberChange || !canEdit || isUpdating}
                          onClick={() => {
                            if (onNumberChange && canEdit && !isUpdating) {
                              setEditingCell({
                                studentId: student.id,
                                itemId: item.id,
                                type: 'number',
                              });
                              setEditingValue(app?.number_value?.toString() ?? '');
                            }
                          }}
                          className={`min-w-[68px] rounded-lg px-2.5 py-1.5 text-center text-sm transition-[background-color,transform] duration-150 ${
                            app?.number_value != null
                              ? 'bg-surface-hover text-text-body'
                              : 'border border-border text-text-faint'
                          } ${onNumberChange && canEdit ? 'active:scale-[0.96]' : 'opacity-70'}`}
                        >
                          {isUpdating ? '…' : (app?.number_value ?? '-')}
                        </button>
                      ))}

                    {columnType === 'date' &&
                      (isEditing && editingCell?.type === 'date' ? (
                        <input
                          type="date"
                          value={editingValue}
                          onChange={(e) => setEditingValue(e.target.value)}
                          onBlur={() => {
                            if (!canEdit) {
                              setEditingCell(null);
                              setEditingValue('');
                              return;
                            }
                            commitDate(student.id, item.id);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') e.currentTarget.blur();
                            else if (e.key === 'Escape') {
                              setEditingCell(null);
                              setEditingValue('');
                            }
                          }}
                          autoFocus
                          className="rounded-lg border border-border bg-surface-raised px-2 py-1.5 text-sm text-text-heading focus:outline-none focus:ring-2 focus:ring-info/30"
                        />
                      ) : (
                        <button
                          type="button"
                          disabled={!onDateChange || !canEdit || isUpdating}
                          onClick={() => {
                            if (onDateChange && canEdit && !isUpdating) {
                              setEditingCell({
                                studentId: student.id,
                                itemId: item.id,
                                type: 'date',
                              });
                              setEditingValue(app?.date_value ?? '');
                            }
                          }}
                          className={`min-w-[68px] rounded-lg px-2.5 py-1.5 text-center text-sm transition-[background-color,transform] duration-150 ${
                            app?.date_value
                              ? 'bg-surface-hover text-text-body'
                              : 'border border-border text-text-faint'
                          } ${onDateChange && canEdit ? 'active:scale-[0.96]' : 'opacity-70'}`}
                        >
                          {isUpdating
                            ? '…'
                            : app?.date_value
                              ? new Date(app.date_value).toLocaleDateString('ja-JP', {
                                  month: 'numeric',
                                  day: 'numeric',
                                })
                              : '-'}
                        </button>
                      ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <div className="px-1 py-1">
        <p className="text-sm text-text-muted">
          全 <span className="font-semibold">{students.length}</span> 件
        </p>
      </div>
    </div>
  );
}
