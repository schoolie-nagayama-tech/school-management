'use client';

import type { Student, ApplicationItem, StudentApplication, ApplicationStatus } from '@/types/database';
import { GRADE_LABELS, APPLICATION_STATUS_SYMBOLS } from '@/types/database';
import { updateStudentApplication, updateApplicationItem, createApplicationItem, deleteApplicationItem } from '@/lib/api/applications';
import { useAuth } from '@/contexts/AuthContext';
import { useState } from 'react';
import { useToast } from '@/hooks/useToast';

interface ApplicationTableProps {
  students: Student[];
  items: ApplicationItem[];
  applications: StudentApplication[];
  onStatusChange: (studentId: string, itemId: string, status: ApplicationStatus | null) => void;
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
  onStudentClick,
  onItemsChange,
}: ApplicationTableProps) {
  const { getSelectedSchoolIds } = useAuth();
  const [updatingCells, setUpdatingCells] = useState<Set<string>>(new Set());
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null);
  const { success, error: toastError } = useToast();

  // 申込状況をマップ化（student_id + item_id → status）
  const applicationMap = new Map<string, ApplicationStatus>();
  applications.forEach((app) => {
    applicationMap.set(`${app.student_id}-${app.item_id}`, app.status);
  });

  // 集計行の計算
  const summaryData = items.map((item) => {
    const totalStudents = students.length;
    const applicableStudents = students.filter((student) => {
      const key = `${student.id}-${item.id}`;
      const status = applicationMap.get(key);
      return status !== 'not_applicable';
    }).length;
    const completedCount = students.filter((student) => {
      const key = `${student.id}-${item.id}`;
      return applicationMap.get(key) === 'completed';
    }).length;
    const completionRate = applicableStudents > 0 
      ? Math.round((completedCount / applicableStudents) * 100) 
      : 0;

    return {
      itemId: item.id,
      totalStudents,
      applicableStudents,
      completedCount,
      completionRate,
    };
  });

  const handleCellClick = async (studentId: string, itemId: string) => {
    // 編集権限がない場合は何もしない
    if (!onStatusChange) return;

    const key = `${studentId}-${itemId}`;
    const currentStatus = applicationMap.get(key) || null;
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
              {items.map((item) => (
                <th
                  key={item.id}
                  className="px-4 py-3 text-center text-[#0d0d0d] font-semibold border-r border-[#0d0d0d] min-w-[120px] relative group"
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
                    <div className="flex items-center justify-center gap-1">
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
                  )}
                </th>
              ))}
              {/* 新規列追加ボタン（編集権限がある場合のみ表示） */}
              {onStatusChange && (
                <th className="px-4 py-3 text-center text-[#0d0d0d] font-semibold border-r border-[#0d0d0d] min-w-[120px]">
                  {isAddingNew ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      placeholder="項目名を入力"
                      onBlur={async () => {
                        if (editingName.trim()) {
                          try {
                            const schoolIds = getSelectedSchoolIds();
                            if (schoolIds.length === 0) {
                              toastError('教室が選択されていません');
                              return;
                            }
                            // 複数教室が選択されている場合は最初の教室を使用
                            await createApplicationItem({ name: editingName.trim() }, schoolIds[0]);
                            success('新しい項目を追加しました');
                            onItemsChange?.();
                          } catch (err) {
                            toastError(
                              err instanceof Error ? err.message : '項目の追加に失敗しました'
                            );
                          }
                        }
                        setIsAddingNew(false);
                        setEditingName('');
                      }}
                      onKeyDown={async (e) => {
                        if (e.key === 'Enter' && editingName.trim()) {
                          try {
                            const schoolIds = getSelectedSchoolIds();
                            if (schoolIds.length === 0) {
                              toastError('教室が選択されていません');
                              return;
                            }
                            // 複数教室が選択されている場合は最初の教室を使用
                            await createApplicationItem({ name: editingName.trim() }, schoolIds[0]);
                            success('新しい項目を追加しました');
                            onItemsChange?.();
                            setIsAddingNew(false);
                            setEditingName('');
                          } catch (err) {
                            toastError(
                              err instanceof Error ? err.message : '項目の追加に失敗しました'
                            );
                          }
                        } else if (e.key === 'Escape') {
                          setIsAddingNew(false);
                          setEditingName('');
                        }
                      }}
                      autoFocus
                      className="flex-1 px-2 py-1 text-sm border border-[#0d0d0d] rounded bg-[#fffffe] text-[#0d0d0d] focus:outline-none focus:ring-2 focus:ring-[#ff8e3c]"
                    />
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setIsAddingNew(true);
                      setEditingName('');
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
                  <div className="flex flex-col gap-1">
                    <span className="text-xs">
                      対象: {summary.applicableStudents}人
                    </span>
                    <span className="text-xs font-semibold">
                      申込済: {summary.completedCount}人 ({summary.completionRate}%)
                    </span>
                  </div>
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
                  const status = applicationMap.get(key) || null;
                  const symbol = getStatusSymbol(status);
                  const style = getStatusStyle(status);
                  const isUpdating = updatingCells.has(key);

                  return (
                    <td
                      key={item.id}
                      className={`px-4 py-3 text-center border-r border-[#0d0d0d] transition-colors ${style} ${
                        isUpdating ? 'opacity-50' : onStatusChange ? 'cursor-pointer hover:bg-[#ff8e3c]/10' : 'cursor-default'
                      }`}
                      onClick={() => onStatusChange && !isUpdating && handleCellClick(student.id, item.id)}
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
