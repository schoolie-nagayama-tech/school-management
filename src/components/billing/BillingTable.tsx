'use client';

import type { Student, BillingItem, StudentBilling } from '@/types/database';
import { GRADE_LABELS } from '@/types/database';
import { toggleStudentBilling, updateBillingItem, deleteBillingItem, syncOrdersToBilling, autoFillFifthWeekBilling, updateBillingValue, syncFormToBilling, calcFifthWeekBilling } from '@/lib/api/billing';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';
import { getFifthWeekDayLabels } from '@/lib/utils/fifthWeek';
import { useAuth } from '@/contexts/AuthContext';
import { useState } from 'react';
import { useToast } from '@/hooks/useToast';
import { useConfirm } from '@/hooks/useConfirm';
import { Pencil, Trash2, Zap, Inbox } from 'lucide-react';

interface BillingTableProps {
  students: Student[];
  items: BillingItem[];
  billings: StudentBilling[];
  onBillingChange?: (studentId: string, billingItemId: string, isBilled: boolean) => void;
  onStudentClick?: (student: Student) => void;
  onItemsChange?: () => void;
  periodStartDate?: string;  // For 5th week auto-calc
  periodEndDate?: string;    // For order sync
  schoolIds?: string | string[];  // For 5th week auto-calc
  billingPeriodId?: string;  // For form sync and 5th week calc
  billingPeriodName?: string;  // For 5th week dialog display
  onStockChange?: (itemName: string, delta: number) => void;  // 在庫増減通知（計上時-1, 解除時+1）
}

export function BillingTable({
  students,
  items,
  billings,
  onBillingChange,
  onStudentClick,
  onItemsChange,
  periodStartDate,
  periodEndDate,
  schoolIds,
  billingPeriodId,
  billingPeriodName,
  onStockChange,
}: BillingTableProps) {
  const { profile } = useAuth();
  const isTeacher = profile?.role === 'teacher';
  const isManagerOrAbove = profile?.role === 'manager' || profile?.role === 'owner' || profile?.role === 'admin';
  const [updatingCells, setUpdatingCells] = useState<Set<string>>(new Set());
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null);
  const [autoFilling, setAutoFilling] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [editingCell, setEditingCell] = useState<{ studentId: string; itemId: string } | null>(null);
  const [editingValue, setEditingValue] = useState<string>('');
  const { success, error: toastError } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();

  // 請求状況をマップ化（student_id + billing_item_id -> billing）
  const billingMap = new Map<string, StudentBilling>();
  billings.forEach((b) => {
    billingMap.set(`${b.student_id}-${b.billing_item_id}`, b);
  });

  // 項目ごとにquantityを持つかどうかを判定
  const itemHasQuantity = (itemId: string): boolean => {
    return students.some((student) => {
      const key = `${student.id}-${itemId}`;
      const billing = billingMap.get(key);
      return billing?.quantity != null && billing.quantity > 0;
    });
  };

  // 集計行の計算
  const summaryData = items.map((item) => {
    const totalStudents = students.length;
    const hasQuantityData = itemHasQuantity(item.id);
    const valueType = item.value_type || 'check';

    let billedCount = 0;
    let quantitySum = 0;
    let numberSum = 0;
    let numberBilledCount = 0;
    let numberHasValueCount = 0;
    let textBilledCount = 0;
    let textHasValueCount = 0;

    students.forEach((student) => {
      const key = `${student.id}-${item.id}`;
      const billing = billingMap.get(key);

      if (valueType === 'number') {
        if (billing?.is_billed) numberBilledCount++;
        if (billing?.value_number != null) {
          numberHasValueCount++;
          numberSum += billing.value_number;
        }
      } else if (valueType === 'text') {
        if (billing?.is_billed) textBilledCount++;
        if (billing?.value_text != null && billing.value_text !== '') textHasValueCount++;
      } else {
        // check type (default)
        const isBilled = billing?.is_billed === true || (billing?.quantity != null && billing.quantity > 0);
        if (isBilled) billedCount++;
        if (billing?.quantity != null && billing.quantity > 0) {
          quantitySum += billing.quantity;
        }
      }
    });

    const billedRate = totalStudents > 0
      ? Math.round((billedCount / totalStudents) * 100)
      : 0;

    return {
      itemId: item.id,
      valueType,
      totalStudents,
      billedCount,
      billedRate,
      hasQuantityData,
      quantitySum,
      numberSum,
      numberBilledCount,
      numberHasValueCount,
      textBilledCount,
      textHasValueCount,
    };
  });

  const handleCellClick = async (studentId: string, billingItemId: string) => {
    if (!onBillingChange) return;

    const key = `${studentId}-${billingItemId}`;
    const existing = billingMap.get(key);
    const currentIsBilled = existing?.is_billed === true;
    const newIsBilled = !currentIsBilled;

    setUpdatingCells((prev) => new Set(prev).add(key));

    try {
      await toggleStudentBilling(studentId, billingItemId, newIsBilled);
      onBillingChange(studentId, billingItemId, newIsBilled);
    } catch (error) {
      console.error('Failed to toggle billing status:', error);
      toastError('請求状況の更新に失敗しました');
    } finally {
      setUpdatingCells((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  // Number cell edit handler
  const handleNumberCellClick = (studentId: string, itemId: string, currentBilling: StudentBilling | undefined) => {
    if (isTeacher) return;
    setEditingCell({ studentId, itemId });
    setEditingValue(currentBilling?.value_number != null ? String(currentBilling.value_number) : '');
  };

  // Text cell edit handler
  const handleTextCellClick = (studentId: string, itemId: string, currentBilling: StudentBilling | undefined) => {
    if (isTeacher) return;
    setEditingCell({ studentId, itemId });
    setEditingValue(currentBilling?.value_text || '');
  };

  // Save edited value
  const handleSaveEditedValue = async (valueType: 'number' | 'text') => {
    if (!editingCell) return;
    const { studentId, itemId } = editingCell;
    const key = `${studentId}-${itemId}`;
    setUpdatingCells((prev) => new Set(prev).add(key));
    try {
      if (valueType === 'number') {
        const numVal = editingValue.trim() === '' ? null : Number(editingValue);
        await updateBillingValue(studentId, itemId, { value_number: numVal });
      } else {
        const textVal = editingValue.trim() === '' ? null : editingValue.trim();
        await updateBillingValue(studentId, itemId, { value_text: textVal });
      }
      onItemsChange?.();
    } catch (err) {
      toastError(err instanceof Error ? err.message : '値の更新に失敗しました');
    } finally {
      setUpdatingCells((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      setEditingCell(null);
      setEditingValue('');
    }
  };

  // Charged toggle for number/text cells
  const handleChargedToggle = async (studentId: string, itemId: string, currentBilling: StudentBilling | undefined) => {
    if (isTeacher || !onBillingChange) return;
    const key = `${studentId}-${itemId}`;
    setUpdatingCells((prev) => new Set(prev).add(key));
    try {
      const newIsBilled = !currentBilling?.is_billed;
      await updateBillingValue(studentId, itemId, { is_billed: newIsBilled });
      onBillingChange(studentId, itemId, newIsBilled);

      // 単語練習帳の計上/解除時に在庫を連動
      if (onStockChange) {
        const item = items.find(i => i.id === itemId);
        if (item && item.name === '単語練習帳') {
          // 計上時: 在庫 -1, 解除時: 在庫 +1
          const qty = (currentBilling?.value_number ?? 1);
          onStockChange(item.name, newIsBilled ? -qty : qty);
        }
      }
    } catch (err) {
      toastError(err instanceof Error ? err.message : '計上の更新に失敗しました');
    } finally {
      setUpdatingCells((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  // Form sync handler
  const handleFormSync = async (_itemId: string) => {
    if (!billingPeriodId || !schoolIds) return;
    const confirmed = await confirm({
      title: 'フォーム回答同期',
      description: 'フォーム回答から請求データを同期しますか？\n紐付け済みの回答件数が反映されます。',
      confirmLabel: '同期する',
      variant: 'default',
    });
    if (!confirmed) return;

    setSyncing(true);
    try {
      const result = await syncFormToBilling(billingPeriodId, schoolIds);
      success(`${result.synced}件の請求データを同期しました`);
      onItemsChange?.();
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'フォーム同期に失敗しました');
    } finally {
      setSyncing(false);
    }
  };

  // 5th week calc handler (new version using calcFifthWeekBilling)
  // 5週目は翌月分（月謝は翌月分を請求するため）
  // 表示月は calcFifthWeekBilling と同じロジックで算出（期間名ベース）
  const handleCalcFifthWeek = async () => {
    if (!billingPeriodId || !schoolIds) return;

    // billingPeriodNameから年月を取得（例: "2026年4月請求" → 2026, 4）
    // calcFifthWeekBillingと同じロジック: 請求月 + 1 = 対象月
    let baseYear: number;
    let baseMonth: number;
    const nameMatch = billingPeriodName?.match(/(\d{4})年(\d{1,2})月/);
    if (nameMatch) {
      baseYear = Number(nameMatch[1]);
      baseMonth = Number(nameMatch[2]) + 1; // 翌月が対象
      if (baseMonth > 12) { baseMonth -= 12; baseYear++; }
    } else if (periodStartDate) {
      // フォールバック: periodStartDateから+2ヶ月
      const [yearStr, monthStr] = periodStartDate.split('-');
      baseYear = Number(yearStr);
      baseMonth = Number(monthStr) + 2;
      if (baseMonth > 12) { baseMonth -= 12; baseYear++; }
    } else {
      return;
    }

    const dayLabels = getFifthWeekDayLabels(baseYear, baseMonth);

    const description = dayLabels
      ? `${baseYear}年${baseMonth}月の5週目コマ数を通塾日程から自動計算しますか？\n\n${baseYear}年${baseMonth}月は${dayLabels}曜日に5週目があります。`
      : `${baseYear}年${baseMonth}月には5週目がありません。\n全生徒に「0」を入力します。`;

    const confirmed = await confirm({
      title: '5週目自動計算（翌月分）',
      description,
      confirmLabel: '自動計算',
      variant: 'default',
    });
    if (!confirmed) return;

    setAutoFilling(true);
    try {
      const result = await calcFifthWeekBilling(billingPeriodId, schoolIds);
      if (!dayLabels) {
        success(`${result.updated}名に5週目 = 0 を入力しました`);
      } else {
        success(`${result.updated}名の5週目コマ数を自動計算しました`);
      }
      onItemsChange?.();
    } catch (err) {
      toastError(err instanceof Error ? err.message : '5週目の自動計算に失敗しました');
    } finally {
      setAutoFilling(false);
    }
  };

  // 5週目自動計算ハンドラ (legacy) - 翌月分
  const handleAutoFillFifthWeek = async (itemId: string) => {
    if (!schoolIds) return;

    // billingPeriodNameから年月を取得（請求月 + 1 = 対象月）
    let year: number;
    let month: number;
    const nameMatch = billingPeriodName?.match(/(\d{4})年(\d{1,2})月/);
    if (nameMatch) {
      year = Number(nameMatch[1]);
      month = Number(nameMatch[2]) + 1; // 翌月が対象
      if (month > 12) { month = 1; year++; }
    } else if (periodStartDate) {
      // フォールバック: periodStartDateから+2ヶ月
      const [yearStr, monthStr] = periodStartDate.split('-');
      year = Number(yearStr);
      month = Number(monthStr) + 2;
      if (month > 12) { month -= 12; year++; }
    } else {
      return;
    }
    const dayLabels = getFifthWeekDayLabels(year, month);

    const description = dayLabels
      ? `翌月（${year}年${month}月）の5週目コマ数を通塾日程から自動計算しますか？\n\n${year}年${month}月は${dayLabels}曜日に5週目があります。`
      : `${year}年${month}月には5週目がありません。\n全生徒に「0」を入力します。`;

    const confirmed = await confirm({
      title: '5週目自動計算（翌月分）',
      description,
      confirmLabel: '自動計算',
      variant: 'default',
    });

    if (!confirmed) return;

    setAutoFilling(true);
    try {
      const result = await autoFillFifthWeekBilling(itemId, periodStartDate!, schoolIds);
      if (!dayLabels) {
        success(`${result.updated}名に5週目 = 0 を入力しました`);
      } else {
        success(`${result.updated}名の5週目コマ数を自動計算しました`);
      }
      onItemsChange?.();
    } catch (err) {
      toastError(err instanceof Error ? err.message : '5週目の自動計算に失敗しました');
    } finally {
      setAutoFilling(false);
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
              <th className="px-3 py-2 text-left text-white text-xs font-semibold border-r border-[#2d4a6f] sticky left-[60px] bg-[#1e3a5f] z-40 w-[160px]" style={{ boxShadow: '4px 0 6px -2px rgba(0,0,0,0.15)' }}>
                名前
              </th>
              {items.map((item) => {
                const isFifthWeekItem = item.name.includes('5週目');
                const showAutoFillButton = isFifthWeekItem && onBillingChange && isManagerOrAbove && periodStartDate && schoolIds;
                return (
                  <th
                    key={item.id}
                    className="px-3 py-2 text-center text-xs font-semibold border-r border-[#2d4a6f] text-white relative group"
                  >
                    {onBillingChange && isManagerOrAbove && editingItemId === item.id ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          onBlur={async () => {
                            if (editingName.trim() && editingName.trim() !== item.name) {
                              try {
                                await updateBillingItem(item.id, { name: editingName.trim() });
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
                          {onBillingChange && isManagerOrAbove ? (
                            <>
                              <div
                                className="flex-1 flex items-center justify-center gap-1 cursor-pointer hover:bg-white/10 rounded px-1 py-0.5 transition-colors"
                                onClick={() => {
                                  setEditingItemId(item.id);
                                  setEditingName(item.name);
                                }}
                                title="クリックして編集"
                              >
                                <span className="text-xs text-white">{item.name}</span>
                                <Pencil className="h-3 w-3 text-white/40 opacity-0 group-hover:opacity-100 transition-opacity" />
                              </div>
                              <button
                                className="text-[10px] text-red-300 hover:text-red-200 opacity-0 group-hover:opacity-100 transition-opacity px-1 py-0.5 rounded hover:bg-red-500/20"
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  if (
                                    await confirm({
                                      title: '削除確認',
                                      description: `「${item.name}」を削除してもよろしいですか？この列の全ての請求データも削除されます。`,
                                      confirmLabel: '削除',
                                      variant: 'danger',
                                    })
                                  ) {
                                    setDeletingItemId(item.id);
                                    try {
                                      await deleteBillingItem(item.id);
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
                            <span className="text-xs text-white">{item.name}</span>
                          )}
                        </div>
                        {/* アクションボタン（1列に1つだけ） */}
                        {(showAutoFillButton || (item.linked_form_type && !isTeacher && billingPeriodId && schoolIds) || (item.source_type === 'order' && !isTeacher && periodStartDate && schoolIds)) && (
                          <div className="flex items-center gap-1">
                            {showAutoFillButton && (
                              <button
                                className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-400/30 text-amber-200 hover:bg-amber-400/50 transition-colors disabled:opacity-50"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (billingPeriodId) {
                                    handleCalcFifthWeek();
                                  } else {
                                    handleAutoFillFifthWeek(item.id);
                                  }
                                }}
                                disabled={autoFilling}
                                title="通塾日程から5週目コマ数を自動計算"
                              >
                                {autoFilling ? '...' : (<><Zap className="inline h-3 w-3 mr-0.5" />自動計算</>)}
                              </button>
                            )}
                            {item.linked_form_type && !isTeacher && billingPeriodId && schoolIds && (
                              <button
                                className="text-[10px] px-1.5 py-0.5 rounded-full bg-cyan-400/30 text-cyan-200 hover:bg-cyan-400/50 transition-colors disabled:opacity-50"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleFormSync(item.id);
                                }}
                                disabled={syncing}
                                title="フォーム回答から件数を同期"
                              >
                                {syncing ? '...' : (<><Inbox className="inline h-3 w-3 mr-0.5" />同期</>)}
                              </button>
                            )}
                            {item.source_type === 'order' && !isTeacher && periodStartDate && schoolIds && (
                              <button
                                className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-400/30 text-purple-200 hover:bg-purple-400/50 transition-colors"
                                title="発注管理から同期"
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  if (!await confirm({
                                    title: '発注管理から同期',
                                    description: `「${item.name}」を発注管理から自動同期しますか？\n期間内の発注が請求に反映されます。`,
                                    confirmLabel: '同期する',
                                  })) return;
                                  try {
                                    const result = await syncOrdersToBilling(item.id, schoolIds, periodStartDate, periodEndDate || periodStartDate);
                                    success(`${result.synced}名の発注を同期しました`);
                                    onItemsChange?.();
                                  } catch (err) {
                                    toastError(getUserErrorMessage(err, '同期に失敗しました'));
                                  }
                                }}
                              >
                                <Inbox className="inline h-3 w-3 mr-0.5" />同期
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </th>
                );
              })}
            </tr>
            {/* 集計行 */}
            <tr className="bg-[#f0f4f8] border-b border-[#e5e7eb]">
              <td className="px-3 py-1.5 text-left text-[#4b5563] text-xs border-r border-[#e5e7eb] sticky left-0 bg-[#f0f4f8] z-40 w-[60px]">
                集計
              </td>
              <td className="px-3 py-1.5 text-left text-[#4b5563] text-xs border-r border-[#e5e7eb] sticky left-[60px] bg-[#f0f4f8] z-40 w-[160px]" style={{ boxShadow: '4px 0 6px -2px rgba(0,0,0,0.08)' }}>
              </td>
              {summaryData.map((summary) => (
                <td
                  key={summary.itemId}
                  className="px-3 py-1.5 text-center text-[#4b5563] text-[11px] border-r border-[#e5e7eb] bg-[#f0f4f8]"
                >
                  {summary.valueType === 'number' ? (
                    <div className="flex flex-col items-center">
                      <span className="text-[11px] font-bold text-[#1e3a5f]">{summary.numberHasValueCount}名</span>
                      <span className={`text-[10px] ${summary.numberBilledCount === summary.numberHasValueCount && summary.numberHasValueCount > 0 ? 'text-green-600' : 'text-orange-500'}`}>
                        計上 {summary.numberBilledCount}/{summary.numberHasValueCount}
                      </span>
                    </div>
                  ) : summary.valueType === 'text' ? (
                    <div className="flex flex-col items-center">
                      <span className="text-[11px] font-bold text-[#1e3a5f]">{summary.textHasValueCount}名</span>
                      <span className={`text-[10px] ${summary.textBilledCount === summary.textHasValueCount && summary.textHasValueCount > 0 ? 'text-green-600' : 'text-orange-500'}`}>
                        計上 {summary.textBilledCount}/{summary.textHasValueCount}
                      </span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center">
                      <span className="text-[11px] font-bold text-[#1e3a5f]">
                        {summary.billedCount}/{summary.totalStudents}
                      </span>
                      {summary.hasQuantityData && (
                        <span className="text-[10px] text-[#4b5563]">
                          計{summary.quantitySum}コマ
                        </span>
                      )}
                    </div>
                  )}
                </td>
              ))}
            </tr>
          </thead>
          <tbody>
            {students.map((student, idx) => {
              const rowBg = idx % 2 === 0 ? 'bg-white' : 'bg-[#f8fafc]';
              return (
                <tr
                  key={student.id}
                  className={`border-b border-[#e5e7eb] hover:bg-[#e8f0fe] ${rowBg}`}
                >
                  <td className={`px-3 py-2 text-xs text-[#4b5563] border-r border-[#e5e7eb] sticky left-0 ${rowBg} z-20 w-[60px]`}>
                    {GRADE_LABELS[student.grade] || student.grade}
                  </td>
                  <td
                    className={`px-3 py-2 text-xs text-[#1f2937] border-r border-[#e5e7eb] sticky left-[60px] ${rowBg} z-20 w-[160px] whitespace-nowrap ${
                      onStudentClick ? 'cursor-pointer hover:text-[#3b82f6]' : ''
                    }`}
                    style={{ boxShadow: '4px 0 6px -2px rgba(0,0,0,0.08)' }}
                    onClick={() => onStudentClick?.(student)}
                  >
                    {student.last_name} {student.first_name}
                  </td>
                  {items.map((item) => {
                    const key = `${student.id}-${item.id}`;
                    const billing = billingMap.get(key);
                    const valueType = item.value_type || 'check';
                    const isUpdating = updatingCells.has(key);
                    const canEditCell = !isTeacher;
                    const isEditingThis = editingCell?.studentId === student.id && editingCell?.itemId === item.id;

                    if (valueType === 'number') {
                      const hasValue = billing?.value_number != null;
                      const isBilled = billing?.is_billed === true;
                      const bgClass = hasValue && isBilled
                        ? 'bg-green-100'
                        : hasValue
                        ? 'bg-yellow-50'
                        : '';

                      return (
                        <td
                          key={item.id}
                          className={`px-1 py-1 text-center border-r border-[#e5e7eb] transition-colors relative ${bgClass} ${
                            isUpdating ? 'opacity-50' : ''
                          } ${canEditCell && onBillingChange && !isEditingThis ? 'cursor-pointer hover:bg-blue-50' : ''}`}
                          onClick={() => {
                            if (!isUpdating && !isEditingThis && canEditCell && onBillingChange) {
                              handleNumberCellClick(student.id, item.id, billing);
                            }
                          }}
                          title={hasValue ? `${billing?.value_number}（クリックで編集）` : 'クリックで入力'}
                        >
                          {isUpdating ? (
                            <span className="text-[#4b5563] text-xs">...</span>
                          ) : isEditingThis ? (
                            <input
                              type="number"
                              value={editingValue}
                              onChange={(e) => setEditingValue(e.target.value)}
                              onBlur={() => handleSaveEditedValue('number')}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') e.currentTarget.blur();
                                if (e.key === 'Escape') { setEditingCell(null); setEditingValue(''); }
                              }}
                              onClick={(e) => e.stopPropagation()}
                              autoFocus
                              className="w-full px-2 py-1 text-sm text-center border-2 border-blue-400 rounded focus:outline-none focus:ring-2 focus:ring-blue-400"
                            />
                          ) : (
                            <div className="flex flex-col items-center gap-0.5">
                              {/* 数値表示 */}
                              <span
                                className={`text-sm font-bold ${
                                  hasValue ? (isBilled ? 'text-green-700' : 'text-[#1e3a5f]') : 'text-gray-300'
                                }`}
                              >
                                {hasValue ? billing?.value_number : '-'}
                              </span>
                              {/* 計上ボタン */}
                              {canEditCell && onBillingChange && hasValue && (
                                <button
                                  className={`text-[11px] leading-none rounded-md px-2 py-0.5 font-medium transition-colors ${
                                    isBilled
                                      ? 'bg-green-500 text-white hover:bg-green-600'
                                      : 'bg-gray-200 text-gray-500 hover:bg-gray-300'
                                  }`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleChargedToggle(student.id, item.id, billing);
                                  }}
                                  title={isBilled ? '計上済（クリックで解除）' : '未計上（クリックで計上）'}
                                >
                                  {isBilled ? '✓ 計上' : '計上'}
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      );
                    }

                    if (valueType === 'text') {
                      const hasValue = billing?.value_text != null && billing.value_text !== '';
                      const isBilled = billing?.is_billed === true;
                      const bgClass = hasValue && isBilled
                        ? 'bg-green-100'
                        : hasValue
                        ? 'bg-yellow-50'
                        : '';

                      return (
                        <td
                          key={item.id}
                          className={`px-1 py-1 text-center border-r border-[#e5e7eb] transition-colors relative ${bgClass} ${
                            isUpdating ? 'opacity-50' : ''
                          } ${canEditCell && onBillingChange && !isEditingThis ? 'cursor-pointer hover:bg-blue-50' : ''}`}
                          onClick={() => {
                            if (!isUpdating && !isEditingThis && canEditCell && onBillingChange) {
                              handleTextCellClick(student.id, item.id, billing);
                            }
                          }}
                          title={hasValue ? `${billing?.value_text}（クリックで編集）` : 'クリックで入力'}
                        >
                          {isUpdating ? (
                            <span className="text-[#4b5563] text-xs">...</span>
                          ) : isEditingThis ? (
                            <input
                              type="text"
                              value={editingValue}
                              onChange={(e) => setEditingValue(e.target.value)}
                              onBlur={() => handleSaveEditedValue('text')}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') e.currentTarget.blur();
                                if (e.key === 'Escape') { setEditingCell(null); setEditingValue(''); }
                              }}
                              onClick={(e) => e.stopPropagation()}
                              autoFocus
                              className="w-full px-2 py-1 text-sm border-2 border-blue-400 rounded focus:outline-none focus:ring-2 focus:ring-blue-400"
                            />
                          ) : (
                            <div className="flex flex-col items-center gap-0.5">
                              {/* テキスト表示（複数行対応） */}
                              <span
                                className={`text-xs whitespace-pre-wrap break-all text-left leading-tight ${
                                  hasValue ? (isBilled ? 'text-green-700' : 'text-[#1e3a5f]') : 'text-gray-300'
                                }`}
                              >
                                {hasValue ? billing?.value_text : '-'}
                              </span>
                              {/* 計上ボタン */}
                              {canEditCell && onBillingChange && hasValue && (
                                <button
                                  className={`text-[11px] leading-none rounded-md px-2 py-0.5 font-medium transition-colors ${
                                    isBilled
                                      ? 'bg-green-500 text-white hover:bg-green-600'
                                      : 'bg-gray-200 text-gray-500 hover:bg-gray-300'
                                  }`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleChargedToggle(student.id, item.id, billing);
                                  }}
                                  title={isBilled ? '計上済（クリックで解除）' : '未計上（クリックで計上）'}
                                >
                                  {isBilled ? '✓ 計上' : '計上'}
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      );
                    }

                    // Default: check type
                    const hasQuantity = billing?.quantity != null && billing.quantity > 0;
                    const isBilled = billing?.is_billed === true || hasQuantity;

                    return (
                      <td
                        key={item.id}
                        className={`px-3 py-2 text-center border-r border-[#e5e7eb] transition-colors ${
                          isBilled ? 'bg-green-100' : ''
                        } ${
                          isUpdating
                            ? 'opacity-50'
                            : onBillingChange && canEditCell
                            ? 'cursor-pointer hover:bg-[#3b82f6]/10'
                            : 'cursor-default'
                        }`}
                        onClick={() =>
                          onBillingChange && !isUpdating && canEditCell && handleCellClick(student.id, item.id)
                        }
                        title={
                          isTeacher
                            ? '閲覧のみ'
                            : hasQuantity
                            ? `${billing?.quantity}コマ（クリックで解除）`
                            : isBilled
                            ? '請求済（クリックで解除）'
                            : '未請求（クリックで請求済に）'
                        }
                      >
                        {isUpdating ? (
                          <span className="text-[#4b5563]">...</span>
                        ) : hasQuantity ? (
                          <span className="text-sm font-semibold text-green-700">{billing?.quantity}</span>
                        ) : isBilled ? (
                          <span className="text-sm font-semibold text-green-700">✓</span>
                        ) : (
                          <span></span>
                        )}
                      </td>
                    );
                  })}
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
