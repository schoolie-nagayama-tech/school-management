'use client';

import { useState, useEffect } from 'react';
import { Button, Input, Modal } from '@/components/ui';
import {
  getApplicationItems,
  createApplicationItem,
  updateApplicationItem,
  deleteApplicationItem,
  updateApplicationItemSortOrder,
} from '@/lib/api/applications';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/useToast';
import type { ApplicationItem, ApplicationColumnType } from '@/types/database';
import { useConfirm } from '@/hooks/useConfirm';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';

interface ApplicationItemSettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ApplicationItemSettings({ isOpen, onClose }: ApplicationItemSettingsProps) {
  const { getSelectedSchoolIds } = useAuth();
  const { error: toastError } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const [items, setItems] = useState<ApplicationItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<ApplicationItem | null>(null);
  const [itemName, setItemName] = useState('');
  const [itemColumnType, setItemColumnType] = useState<ApplicationColumnType>('check');
  const [itemDueDate, setItemDueDate] = useState<string>('');
  const [itemManagerOnly, setItemManagerOnly] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 項目一覧を取得
  const fetchItems = async () => {
    setIsLoading(true);
    setErrorMessage('');
    try {
      const schoolIds = getSelectedSchoolIds();
      if (schoolIds.length === 0) {
        setErrorMessage('教室が選択されていません');
        setIsLoading(false);
        return;
      }
      const data = await getApplicationItems(schoolIds);
      setItems(data);
    } catch (error) {
      console.error('Error fetching application items:', error);
      setErrorMessage(
        getUserErrorMessage(error, '項目一覧の取得に失敗しました')
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchItems();
    }
  }, [isOpen]);

  // 項目を追加
  const handleAdd = () => {
    setEditingItem(null);
    setItemName('');
    setItemColumnType('check');
    setItemDueDate('');
    setItemManagerOnly(false);
    setIsEditModalOpen(true);
  };

  // 項目を編集
  const handleEdit = (item: ApplicationItem) => {
    setEditingItem(item);
    setItemName(item.name);
    setItemDueDate(item.due_date || '');
    setIsEditModalOpen(true);
  };

  // 項目を削除
  const handleDelete = async (id: string) => {
    if (!(await confirm({ title: '削除確認', description: 'この項目を削除しますか？削除すると、関連する申込状況も削除されます。', confirmLabel: '削除', variant: 'danger' }))) return;

    setIsSubmitting(true);
    setErrorMessage('');
    try {
      await deleteApplicationItem(id);
      await fetchItems();
    } catch (error) {
      console.error('Error deleting application item:', error);
      setErrorMessage(
        getUserErrorMessage(error, '項目の削除に失敗しました')
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // 並び順を変更（上に移動）
  const handleMoveUp = async (item: ApplicationItem) => {
    const index = items.findIndex((i) => i.id === item.id);
    if (index <= 0) return;

    const newOrder = [...items];
    [newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]];

    const updatedItems = newOrder.map((i, idx) => ({
      id: i.id,
      sort_order: idx,
    }));

    setIsSubmitting(true);
    setErrorMessage('');
    try {
      const schoolIds = getSelectedSchoolIds();
      if (schoolIds.length === 0) {
        setErrorMessage('教室が選択されていません');
        setIsSubmitting(false);
        return;
      }
      await updateApplicationItemSortOrder(updatedItems, schoolIds);
      await fetchItems();
    } catch (error) {
      console.error('Error updating sort order:', error);
      setErrorMessage(
        getUserErrorMessage(error, '並び順の更新に失敗しました')
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // 並び順を変更（下に移動）
  const handleMoveDown = async (item: ApplicationItem) => {
    const index = items.findIndex((i) => i.id === item.id);
    if (index >= items.length - 1) return;

    const newOrder = [...items];
    [newOrder[index], newOrder[index + 1]] = [newOrder[index + 1], newOrder[index]];

    const updatedItems = newOrder.map((i, idx) => ({
      id: i.id,
      sort_order: idx,
    }));

    setIsSubmitting(true);
    setErrorMessage('');
    try {
      const schoolIds = getSelectedSchoolIds();
      if (schoolIds.length === 0) {
        setErrorMessage('教室が選択されていません');
        setIsSubmitting(false);
        return;
      }
      await updateApplicationItemSortOrder(updatedItems, schoolIds);
      await fetchItems();
    } catch (error) {
      console.error('Error updating sort order:', error);
      setErrorMessage(
        getUserErrorMessage(error, '並び順の更新に失敗しました')
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // 有効/無効を切り替え
  const handleToggleActive = async (item: ApplicationItem) => {
    setIsSubmitting(true);
    setErrorMessage('');
    try {
      await updateApplicationItem(item.id, { is_active: !item.is_active });
      await fetchItems();
    } catch (error) {
      console.error('Error toggling active status:', error);
      setErrorMessage(
        getUserErrorMessage(error, '状態の更新に失敗しました')
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // 編集モーダルの保存
  const handleSave = async () => {
    if (!itemName.trim()) {
      toastError('項目名を入力してください');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage('');
    try {
      if (editingItem) {
        await updateApplicationItem(editingItem.id, { name: itemName.trim(), due_date: itemDueDate || null });
      } else {
        const schoolIds = getSelectedSchoolIds();
        if (schoolIds.length === 0) {
          setErrorMessage('教室が選択されていません');
          return;
        }
        // 複数教室が選択されている場合は最初の教室を使用
        await createApplicationItem(
          {
            name: itemName.trim(),
            column_type: itemColumnType,
            due_date: itemDueDate || null,
            manager_only: itemManagerOnly,
          },
          schoolIds[0]
        );
      }
      setIsEditModalOpen(false);
      setItemName('');
      setEditingItem(null);
      await fetchItems();
    } catch (error) {
      console.error('Error saving application item:', error);
      setErrorMessage(
        getUserErrorMessage(error, '項目の保存に失敗しました')
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title="申込項目設定">
        <div className="space-y-4">
          {errorMessage && (
            <div className="bg-[#ef4444]/20 text-[#ef4444] px-4 py-2 rounded border border-[#ef4444]">
              {errorMessage}
            </div>
          )}

          <div className="flex justify-between items-center">
            <h3 className="text-lg font-semibold text-[#1f2937]">項目一覧</h3>
            <Button onClick={handleAdd} disabled={isSubmitting}>
              新規追加
            </Button>
          </div>

          {isLoading ? (
            <div className="text-center py-8 text-[#4b5563]">読み込み中...</div>
          ) : items.length === 0 ? (
            <div className="text-center py-8 text-[#4b5563]">
              項目がありません。新規追加ボタンから項目を追加してください。
            </div>
          ) : (
            <div className="space-y-2">
              {items.map((item, index) => (
                <div
                  key={item.id}
                  className="flex items-center gap-2 p-3 bg-[#f3f4f6] rounded border border-[#e5e7eb]"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-[#4b5563] cursor-pointer hover:text-[#3b82f6] ${
                          !item.is_active ? 'line-through opacity-50' : ''
                        }`}
                        onClick={() => handleEdit(item)}
                      >
                        {item.name}
                      </span>
                      {!item.is_active && (
                        <span className="text-xs text-[#4b5563]/60">(非表示)</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleMoveUp(item)}
                      disabled={index === 0 || isSubmitting}
                      className="px-2 py-1 text-[#4b5563] hover:bg-[#3b82f6]/20 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                      title="上に移動"
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => handleMoveDown(item)}
                      disabled={index === items.length - 1 || isSubmitting}
                      className="px-2 py-1 text-[#4b5563] hover:bg-[#3b82f6]/20 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                      title="下に移動"
                    >
                      ↓
                    </button>
                    <button
                      onClick={() => handleToggleActive(item)}
                      disabled={isSubmitting}
                      className={`px-3 py-1 text-sm rounded border ${
                        item.is_active
                          ? 'bg-[#3b82f6]/20 text-[#1f2937] border-[#e5e7eb]'
                          : 'bg-[#f3f4f6] text-[#4b5563] border-[#e5e7eb]'
                      }`}
                      title={item.is_active ? '非表示にする' : '表示する'}
                    >
                      {item.is_active ? '表示中' : '非表示'}
                    </button>
                    <button
                      onClick={() => handleDelete(item.id)}
                      disabled={isSubmitting}
                      className="px-3 py-1 text-sm bg-[#ef4444] text-white rounded hover:bg-[#ef4444]/80 disabled:opacity-50"
                      title="削除"
                    >
                      削除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-4 border-t border-[#e5e7eb]">
            <Button onClick={onClose} variant="secondary" disabled={isSubmitting}>
              閉じる
            </Button>
          </div>
        </div>
      </Modal>

      {/* 編集モーダル */}
      <Modal
        isOpen={isEditModalOpen}
        onClose={() => {
          setIsEditModalOpen(false);
          setItemName('');
          setEditingItem(null);
        }}
        title={editingItem ? '項目を編集' : '項目を追加'}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-[#4b5563] mb-2">
              項目名
            </label>
            <Input
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
              placeholder="例: 期末テスト結果入力"
              disabled={isSubmitting}
            />
          </div>

          {/* 期日は新規・編集ともに表示、カラムタイプ・室長のみ表示は新規のみ */}
          <div>
            <label className="block text-sm font-medium text-[#4b5563] mb-2">
              期日（任意）
            </label>
            <input
              type="date"
              value={itemDueDate}
              onChange={(e) => setItemDueDate(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-[#e5e7eb] rounded-lg bg-white text-[#1f2937] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]"
              disabled={isSubmitting}
            />
          </div>
          {!editingItem && (
            <>
              <div>
                <label className="block text-sm font-medium text-[#4b5563] mb-2">
                  カラムタイプ
                </label>
                <select
                  value={itemColumnType}
                  onChange={(e) => setItemColumnType(e.target.value as ApplicationColumnType)}
                  className="w-full px-3 py-2 text-sm border border-[#e5e7eb] rounded-lg bg-white text-[#1f2937] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]"
                  disabled={isSubmitting}
                >
                  <option value="check">チェック</option>
                  <option value="number">数値</option>
                  <option value="date">日付</option>
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm text-[#4b5563]">
                <input
                  type="checkbox"
                  checked={itemManagerOnly}
                  onChange={(e) => setItemManagerOnly(e.target.checked)}
                  className="w-4 h-4 text-[#3b82f6] border-[#e5e7eb] rounded focus:ring-[#3b82f6]"
                  disabled={isSubmitting}
                />
                <span>室長以上のみ表示（講師には非表示）</span>
              </label>
            </>
          )}

          {errorMessage && (
            <div className="bg-[#ef4444]/20 text-[#ef4444] px-4 py-2 rounded border border-[#ef4444]">
              {errorMessage}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-4 border-t border-[#e5e7eb]">
            <Button
              onClick={() => {
                setIsEditModalOpen(false);
                setItemName('');
                setEditingItem(null);
              }}
              variant="secondary"
              disabled={isSubmitting}
            >
              キャンセル
            </Button>
            <Button onClick={handleSave} disabled={isSubmitting || !itemName.trim()}>
              保存
            </Button>
          </div>
        </div>
      </Modal>

      {ConfirmDialog}
    </>
  );
}
