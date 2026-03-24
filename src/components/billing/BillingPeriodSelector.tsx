'use client';

import { useState } from 'react';
import type { BillingPeriod } from '@/types/database';
import { Button, Input } from '@/components/ui';
import {
  createBillingPeriod,
  updateBillingPeriod,
  deleteBillingPeriod,
} from '@/lib/api/billing';
import { useToast } from '@/hooks/useToast';
import { useConfirm } from '@/hooks/useConfirm';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';

interface BillingPeriodSelectorProps {
  periods: BillingPeriod[];
  selectedPeriodId: string | null;
  onSelect: (periodId: string | null) => void;
  schoolId: string | null;
  onUpdated: () => void;
  canEdit: boolean;
}

export function BillingPeriodSelector({
  periods,
  selectedPeriodId,
  onSelect,
  schoolId,
  onUpdated,
  canEdit,
}: BillingPeriodSelectorProps) {
  const { success, error: toastError } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const [isCreating, setIsCreating] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [newName, setNewName] = useState('');
  const [newStartDate, setNewStartDate] = useState('');
  const [newEndDate, setNewEndDate] = useState('');
  const [editName, setEditName] = useState('');
  const [editStartDate, setEditStartDate] = useState('');
  const [editEndDate, setEditEndDate] = useState('');

  const selectedPeriod = periods.find((p) => p.id === selectedPeriodId);

  const handleCreate = async () => {
    if (!newName.trim() || !newStartDate || !newEndDate) {
      toastError('期間名、開始日、終了日を入力してください');
      return;
    }
    if (!schoolId) {
      toastError('教室が選択されていません');
      return;
    }

    setIsProcessing(true);
    try {
      const created = await createBillingPeriod(
        { name: newName.trim(), start_date: newStartDate, end_date: newEndDate },
        schoolId
      );
      success('請求期間を作成しました');
      setIsCreating(false);
      setNewName('');
      setNewStartDate('');
      setNewEndDate('');
      onUpdated();
      onSelect(created.id);
    } catch (error) {
      toastError(getUserErrorMessage(error, '作成に失敗しました'));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleEdit = async () => {
    if (!selectedPeriodId || !editName.trim() || !editStartDate || !editEndDate) {
      toastError('期間名、開始日、終了日を入力してください');
      return;
    }

    setIsProcessing(true);
    try {
      await updateBillingPeriod(selectedPeriodId, {
        name: editName.trim(),
        start_date: editStartDate,
        end_date: editEndDate,
      });
      success('請求期間を更新しました');
      setIsEditing(false);
      onUpdated();
    } catch (error) {
      toastError(getUserErrorMessage(error, '更新に失敗しました'));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedPeriodId || !selectedPeriod) return;

    if (
      !(await confirm({
        title: '削除確認',
        description: `「${selectedPeriod.name}」を削除しますか？\n\n関連する全ての請求項目・請求データも削除されます。この操作は取り消せません。`,
        confirmLabel: '削除',
        variant: 'danger',
      }))
    ) {
      return;
    }

    setIsProcessing(true);
    try {
      await deleteBillingPeriod(selectedPeriodId);
      success('請求期間を削除しました');
      onSelect(null);
      onUpdated();
    } catch (error) {
      toastError(getUserErrorMessage(error, '削除に失敗しました'));
    } finally {
      setIsProcessing(false);
    }
  };

  const startEditing = () => {
    if (!selectedPeriod) return;
    setEditName(selectedPeriod.name);
    setEditStartDate(selectedPeriod.start_date);
    setEditEndDate(selectedPeriod.end_date);
    setIsEditing(true);
    setIsCreating(false);
  };

  const formatDateRange = (period: BillingPeriod) => {
    const start = new Date(period.start_date).toLocaleDateString('ja-JP');
    const end = new Date(period.end_date).toLocaleDateString('ja-JP');
    return `${start} - ${end}`;
  };

  return (
    <div className="bg-white border border-[#e5e7eb] rounded-lg p-4 mb-6">
      <div className="flex flex-wrap gap-4 items-end">
        {/* 期間選択 */}
        <div className="flex-1 min-w-[250px]">
          <label className="block text-sm font-medium text-[#1f2937] mb-1">
            請求期間
          </label>
          <select
            value={selectedPeriodId || ''}
            onChange={(e) => {
              onSelect(e.target.value || null);
              setIsEditing(false);
              setIsCreating(false);
            }}
            className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm bg-white text-[#1f2937] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]"
          >
            <option value="">-- 期間を選択 --</option>
            {periods.map((period) => (
              <option key={period.id} value={period.id}>
                {period.name} ({formatDateRange(period)})
              </option>
            ))}
          </select>
        </div>

        {/* 操作ボタン */}
        {canEdit && (
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => {
                setIsCreating(true);
                setIsEditing(false);
              }}
              disabled={isProcessing}
            >
              + 新規期間
            </Button>
            {selectedPeriod && (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={startEditing}
                  disabled={isProcessing}
                >
                  編集
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={handleDelete}
                  disabled={isProcessing}
                >
                  削除
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      {/* 新規作成フォーム */}
      {isCreating && canEdit && (
        <div className="mt-4 p-4 bg-[#f3f4f6] rounded-lg border border-[#e5e7eb]">
          <h3 className="text-sm font-semibold text-[#1f2937] mb-3">新規期間の作成</h3>
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[150px]">
              <label className="block text-xs text-[#4b5563] mb-1">期間名</label>
              <Input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="例: 2026年4月請求"
                disabled={isProcessing}
              />
            </div>
            <div className="w-40">
              <label className="block text-xs text-[#4b5563] mb-1">開始日</label>
              <Input
                type="date"
                value={newStartDate}
                onChange={(e) => setNewStartDate(e.target.value)}
                disabled={isProcessing}
              />
            </div>
            <div className="w-40">
              <label className="block text-xs text-[#4b5563] mb-1">終了日</label>
              <Input
                type="date"
                value={newEndDate}
                onChange={(e) => setNewEndDate(e.target.value)}
                disabled={isProcessing}
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleCreate} disabled={isProcessing || !newName.trim() || !newStartDate || !newEndDate}>
                作成
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setIsCreating(false);
                  setNewName('');
                  setNewStartDate('');
                  setNewEndDate('');
                }}
              >
                キャンセル
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 編集フォーム */}
      {isEditing && canEdit && selectedPeriod && (
        <div className="mt-4 p-4 bg-[#f3f4f6] rounded-lg border border-[#e5e7eb]">
          <h3 className="text-sm font-semibold text-[#1f2937] mb-3">期間の編集</h3>
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[150px]">
              <label className="block text-xs text-[#4b5563] mb-1">期間名</label>
              <Input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                disabled={isProcessing}
              />
            </div>
            <div className="w-40">
              <label className="block text-xs text-[#4b5563] mb-1">開始日</label>
              <Input
                type="date"
                value={editStartDate}
                onChange={(e) => setEditStartDate(e.target.value)}
                disabled={isProcessing}
              />
            </div>
            <div className="w-40">
              <label className="block text-xs text-[#4b5563] mb-1">終了日</label>
              <Input
                type="date"
                value={editEndDate}
                onChange={(e) => setEditEndDate(e.target.value)}
                disabled={isProcessing}
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleEdit} disabled={isProcessing || !editName.trim() || !editStartDate || !editEndDate}>
                保存
              </Button>
              <Button variant="secondary" onClick={() => setIsEditing(false)}>
                キャンセル
              </Button>
            </div>
          </div>
        </div>
      )}

      {ConfirmDialog}
    </div>
  );
}
