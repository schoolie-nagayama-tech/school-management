'use client';

import { useState } from 'react';
import type { BillingItem } from '@/types/database';
import { ChevronDown } from 'lucide-react';
import { BILLING_SOURCE_TYPE_LABELS } from '@/types/database';
import {
  createBillingItem,
  updateBillingItem,
  deleteBillingItem,
} from '@/lib/api/billing';
import { Button, Input } from '@/components/ui';
import { useToast } from '@/hooks/useToast';
import { useConfirm } from '@/hooks/useConfirm';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';

interface BillingItemAccordionProps {
  schoolId?: string | string[];
  periodId: string;
  items: BillingItem[];
  onUpdated: () => void;
}

export function BillingItemAccordion({
  schoolId: _schoolId,
  periodId,
  items,
  onUpdated,
}: BillingItemAccordionProps) {
  const { success, error: toastError } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const [isOpen, setIsOpen] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  // 新規追加
  const handleAdd = async () => {
    if (!newItemName.trim()) {
      toastError('項目名を入力してください');
      return;
    }

    if (!_schoolId || (Array.isArray(_schoolId) && _schoolId.length === 0)) {
      toastError('教室が選択されていません');
      return;
    }

    setIsProcessing(true);
    try {
      await createBillingItem(
        {
          billing_period_id: periodId,
          name: newItemName.trim(),
        },
        _schoolId
      );
      success('項目を追加しました');
      setNewItemName('');
      onUpdated();
    } catch (error) {
      console.error('Failed to create billing item:', error);
      toastError(getUserErrorMessage(error, '追加に失敗しました'));
    } finally {
      setIsProcessing(false);
    }
  };

  // 名前変更
  const handleRename = async (id: string) => {
    if (!editingName.trim()) {
      toastError('項目名を入力してください');
      return;
    }

    setIsProcessing(true);
    try {
      await updateBillingItem(id, { name: editingName.trim() });
      success('名前を変更しました');
      setEditingId(null);
      setEditingName('');
      onUpdated();
    } catch (error) {
      console.error('Failed to rename billing item:', error);
      toastError(getUserErrorMessage(error, '変更に失敗しました'));
    } finally {
      setIsProcessing(false);
    }
  };

  // 削除
  const handleDelete = async (id: string, name: string) => {
    if (
      !(await confirm({
        title: '削除確認',
        description: `「${name}」を削除しますか？\n\nこの項目に関連する全ての請求データも削除されます。この操作は取り消せません。`,
        confirmLabel: '削除',
        variant: 'danger',
      }))
    ) {
      return;
    }

    if (!(await confirm({ title: '削除確認', description: '本当に削除しますか？', confirmLabel: '削除', variant: 'danger' }))) {
      return;
    }

    setIsProcessing(true);
    try {
      await deleteBillingItem(id);
      success('削除しました');
      onUpdated();
    } catch (error) {
      console.error('Failed to delete billing item:', error);
      toastError(getUserErrorMessage(error, '削除に失敗しました'));
    } finally {
      setIsProcessing(false);
    }
  };

  // 編集開始
  const startEditing = (item: BillingItem) => {
    setEditingId(item.id);
    setEditingName(item.name);
  };

  // 編集キャンセル
  const cancelEditing = () => {
    setEditingId(null);
    setEditingName('');
  };

  const activeItems = items.filter((i) => i.is_active);

  return (
    <div className="mb-6 bg-white rounded-xl border border-[#e5e7eb] overflow-hidden">
      {/* アコーディオンヘッダー */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-3 bg-[#f3f4f6] hover:bg-[#f3f4f6]/80 transition-colors"
      >
        <span className="text-sm font-semibold text-[#1f2937]">項目管理</span>
        <ChevronDown className={`w-5 h-5 text-[#4b5563] transition-[transform] duration-150 ease-out ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* アコーディオンコンテンツ — CSS grid trick でスムーズに開閉 */}
      <div
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: isOpen ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
        <div className="p-4 space-y-6 border-t border-[#e5e7eb]">
          {/* 新規追加 */}
          <div>
            <label className="block text-sm font-medium text-[#1f2937] mb-2">
              新しい請求項目を追加
            </label>
            <div className="flex gap-2">
              <Input
                type="text"
                value={newItemName}
                onChange={(e) => setNewItemName(e.target.value)}
                placeholder="例: 教材費"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAdd();
                }}
                disabled={isProcessing}
              />
              <Button onClick={handleAdd} disabled={isProcessing || !newItemName.trim()}>
                追加
              </Button>
            </div>
          </div>

          {/* 項目一覧 */}
          <div>
            <h3 className="text-sm font-medium text-[#1f2937] mb-3">
              請求項目（{activeItems.length}件）
            </h3>
            <div className="space-y-2">
              {activeItems.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between p-3 bg-[#f3f4f6] rounded-lg border border-[#e5e7eb]"
                >
                  {editingId === item.id ? (
                    <div className="flex-1 flex gap-2">
                      <Input
                        type="text"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        className="flex-1"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleRename(item.id);
                          if (e.key === 'Escape') cancelEditing();
                        }}
                      />
                      <Button
                        onClick={() => handleRename(item.id)}
                        size="sm"
                        disabled={isProcessing || !editingName.trim()}
                      >
                        保存
                      </Button>
                      <Button
                        onClick={cancelEditing}
                        variant="secondary"
                        size="sm"
                      >
                        キャンセル
                      </Button>
                    </div>
                  ) : (
                    <>
                      <div className="flex-1 flex items-center gap-3">
                        <span className="font-medium text-[#1f2937]">{item.name}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                          item.source_type === 'free'
                            ? 'bg-gray-200 text-gray-600'
                            : item.source_type === 'form_charged'
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-amber-100 text-amber-700'
                        }`}>
                          {BILLING_SOURCE_TYPE_LABELS[item.source_type] || item.source_type}
                        </span>
                      </div>
                      <div className="flex gap-3">
                        <button
                          onClick={() => startEditing(item)}
                          className="text-sm text-[#4b5563] hover:text-[#3b82f6] transition-colors"
                          disabled={isProcessing}
                        >
                          名前変更
                        </button>
                        <button
                          onClick={() => handleDelete(item.id, item.name)}
                          className="text-sm text-[#ef4444] hover:text-[#ef4444]/80 transition-colors"
                          disabled={isProcessing}
                        >
                          削除
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
              {activeItems.length === 0 && (
                <p className="text-[#4b5563]/60 text-sm py-4 text-center">
                  請求項目がありません
                </p>
              )}
            </div>
          </div>
        </div>
        </div>
      </div>
      {ConfirmDialog}
    </div>
  );
}
