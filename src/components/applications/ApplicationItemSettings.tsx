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
import type { ApplicationItem, ApplicationItemInsert } from '@/types/database';

interface ApplicationItemSettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ApplicationItemSettings({ isOpen, onClose }: ApplicationItemSettingsProps) {
  const [items, setItems] = useState<ApplicationItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<ApplicationItem | null>(null);
  const [itemName, setItemName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 項目一覧を取得
  const fetchItems = async () => {
    setIsLoading(true);
    setErrorMessage('');
    try {
      const data = await getApplicationItems();
      setItems(data);
    } catch (error) {
      console.error('Error fetching application items:', error);
      setErrorMessage(
        error instanceof Error ? error.message : '項目一覧の取得に失敗しました'
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
    setIsEditModalOpen(true);
  };

  // 項目を編集
  const handleEdit = (item: ApplicationItem) => {
    setEditingItem(item);
    setItemName(item.name);
    setIsEditModalOpen(true);
  };

  // 項目を削除
  const handleDelete = async (id: string) => {
    if (!confirm('この項目を削除しますか？削除すると、関連する申込状況も削除されます。')) return;

    setIsSubmitting(true);
    setErrorMessage('');
    try {
      await deleteApplicationItem(id);
      await fetchItems();
    } catch (error) {
      console.error('Error deleting application item:', error);
      setErrorMessage(
        error instanceof Error ? error.message : '項目の削除に失敗しました'
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
      await updateApplicationItemSortOrder(updatedItems);
      await fetchItems();
    } catch (error) {
      console.error('Error updating sort order:', error);
      setErrorMessage(
        error instanceof Error ? error.message : '並び順の更新に失敗しました'
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
      await updateApplicationItemSortOrder(updatedItems);
      await fetchItems();
    } catch (error) {
      console.error('Error updating sort order:', error);
      setErrorMessage(
        error instanceof Error ? error.message : '並び順の更新に失敗しました'
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
        error instanceof Error ? error.message : '状態の更新に失敗しました'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // 編集モーダルの保存
  const handleSave = async () => {
    if (!itemName.trim()) {
      alert('項目名を入力してください');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage('');
    try {
      if (editingItem) {
        await updateApplicationItem(editingItem.id, { name: itemName.trim() });
      } else {
        await createApplicationItem({ name: itemName.trim() });
      }
      setIsEditModalOpen(false);
      setItemName('');
      setEditingItem(null);
      await fetchItems();
    } catch (error) {
      console.error('Error saving application item:', error);
      setErrorMessage(
        error instanceof Error ? error.message : '項目の保存に失敗しました'
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
            <div className="bg-[#d9376e]/20 text-[#d9376e] px-4 py-2 rounded border border-[#d9376e]">
              {errorMessage}
            </div>
          )}

          <div className="flex justify-between items-center">
            <h3 className="text-lg font-semibold text-[#0d0d0d]">項目一覧</h3>
            <Button onClick={handleAdd} disabled={isSubmitting}>
              新規追加
            </Button>
          </div>

          {isLoading ? (
            <div className="text-center py-8 text-[#2a2a2a]">読み込み中...</div>
          ) : items.length === 0 ? (
            <div className="text-center py-8 text-[#2a2a2a]">
              項目がありません。新規追加ボタンから項目を追加してください。
            </div>
          ) : (
            <div className="space-y-2">
              {items.map((item, index) => (
                <div
                  key={item.id}
                  className="flex items-center gap-2 p-3 bg-[#eff0f3] rounded border border-[#0d0d0d]"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-[#2a2a2a] cursor-pointer hover:text-[#ff8e3c] ${
                          !item.is_active ? 'line-through opacity-50' : ''
                        }`}
                        onClick={() => handleEdit(item)}
                      >
                        {item.name}
                      </span>
                      {!item.is_active && (
                        <span className="text-xs text-[#2a2a2a]/60">(非表示)</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleMoveUp(item)}
                      disabled={index === 0 || isSubmitting}
                      className="px-2 py-1 text-[#2a2a2a] hover:bg-[#ff8e3c]/20 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                      title="上に移動"
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => handleMoveDown(item)}
                      disabled={index === items.length - 1 || isSubmitting}
                      className="px-2 py-1 text-[#2a2a2a] hover:bg-[#ff8e3c]/20 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                      title="下に移動"
                    >
                      ↓
                    </button>
                    <button
                      onClick={() => handleToggleActive(item)}
                      disabled={isSubmitting}
                      className={`px-3 py-1 text-sm rounded border ${
                        item.is_active
                          ? 'bg-[#ff8e3c]/20 text-[#0d0d0d] border-[#0d0d0d]'
                          : 'bg-[#eff0f3] text-[#2a2a2a] border-[#0d0d0d]'
                      }`}
                      title={item.is_active ? '非表示にする' : '表示する'}
                    >
                      {item.is_active ? '表示中' : '非表示'}
                    </button>
                    <button
                      onClick={() => handleDelete(item.id)}
                      disabled={isSubmitting}
                      className="px-3 py-1 text-sm bg-[#d9376e] text-white rounded hover:bg-[#d9376e]/80 disabled:opacity-50"
                      title="削除"
                    >
                      削除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-4 border-t border-[#0d0d0d]">
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
            <label className="block text-sm font-medium text-[#2a2a2a] mb-2">
              項目名
            </label>
            <Input
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
              placeholder="例: 期末テスト結果入力"
              disabled={isSubmitting}
            />
          </div>

          {errorMessage && (
            <div className="bg-[#d9376e]/20 text-[#d9376e] px-4 py-2 rounded border border-[#d9376e]">
              {errorMessage}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-4 border-t border-[#0d0d0d]">
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
    </>
  );
}
