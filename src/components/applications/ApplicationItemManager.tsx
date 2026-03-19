'use client';

import { useState } from 'react';
import { ApplicationItem } from '@/types/database';
import {
  createApplicationItem,
  updateApplicationItem,
  hideApplicationItem,
  unhideApplicationItem,
  deleteApplicationItem,
} from '@/lib/api/applications';
import { Modal, Button, Input } from '@/components/ui';
import { useToast } from '@/hooks/useToast';
import { useConfirm } from '@/hooks/useConfirm';

interface ApplicationItemManagerProps {
  schoolId?: string;
  items: ApplicationItem[];
  showHidden: boolean;
  isOpen: boolean;
  onClose: () => void;
  onUpdated: () => void;
}

export function ApplicationItemManager({
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  schoolId: _schoolId,
  items,
  showHidden,
  isOpen,
  onClose,
  onUpdated,
}: ApplicationItemManagerProps) {
  // schoolId is available but not currently used
  const { success, error: toastError } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
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

    if (!_schoolId) {
      toastError('教室が選択されていません');
      return;
    }

    setIsProcessing(true);
    try {
      await createApplicationItem({ name: newItemName.trim() }, _schoolId);
      success('項目を追加しました');
      setNewItemName('');
      onUpdated();
    } catch (error) {
      console.error('Failed to create item:', error);
      toastError(
        error instanceof Error ? error.message : '追加に失敗しました'
      );
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
      await updateApplicationItem(id, { name: editingName.trim() });
      success('名前を変更しました');
      setEditingId(null);
      setEditingName('');
      onUpdated();
    } catch (error) {
      console.error('Failed to rename item:', error);
      toastError(
        error instanceof Error ? error.message : '変更に失敗しました'
      );
    } finally {
      setIsProcessing(false);
    }
  };

  // 非表示
  const handleHide = async (id: string) => {
    if (!(await confirm({ description: 'この項目を非表示にしますか？（申込データは保持されます）' }))) {
      return;
    }

    setIsProcessing(true);
    try {
      await hideApplicationItem(id);
      success('非表示にしました');
      onUpdated();
    } catch (error) {
      console.error('Failed to hide item:', error);
      toastError(
        error instanceof Error ? error.message : '非表示に失敗しました'
      );
    } finally {
      setIsProcessing(false);
    }
  };

  // 再表示
  const handleUnhide = async (id: string) => {
    setIsProcessing(true);
    try {
      await unhideApplicationItem(id);
      success('再表示しました');
      onUpdated();
    } catch (error) {
      console.error('Failed to unhide item:', error);
      toastError(
        error instanceof Error ? error.message : '再表示に失敗しました'
      );
    } finally {
      setIsProcessing(false);
    }
  };

  // 削除
  const handleDelete = async (id: string, name: string) => {
    if (
      !(await confirm({
        title: '削除確認',
        description: `「${name}」を削除しますか？\n\n⚠️ この項目に関連する全ての申込データも削除されます。この操作は取り消せません。`,
        confirmLabel: '削除',
        variant: 'danger',
      }))
    ) {
      return;
    }

    // 二重確認
    if (!(await confirm({ title: '削除確認', description: '本当に削除しますか？', confirmLabel: '削除', variant: 'danger' }))) {
      return;
    }

    setIsProcessing(true);
    try {
      await deleteApplicationItem(id);
      success('削除しました');
      onUpdated();
    } catch (error) {
      console.error('Failed to delete item:', error);
      toastError(
        error instanceof Error ? error.message : '削除に失敗しました'
      );
    } finally {
      setIsProcessing(false);
    }
  };

  // 編集開始
  const startEditing = (item: ApplicationItem) => {
    setEditingId(item.id);
    setEditingName(item.name);
  };

  // 編集キャンセル
  const cancelEditing = () => {
    setEditingId(null);
    setEditingName('');
  };

  // 表示する項目
  const visibleItems = showHidden ? items : items.filter((i) => !i.is_hidden);
  const hiddenItems = items.filter((i) => i.is_hidden);

  return (
    <>
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="申込項目の管理"
      size="lg"
    >
      <div className="space-y-6">
        {/* 新規追加 */}
        <div>
          <label className="block text-sm font-medium text-[#1f2937] mb-2">
            新しい項目を追加
          </label>
          <div className="flex gap-2">
            <Input
              type="text"
              value={newItemName}
              onChange={(e) => setNewItemName(e.target.value)}
              placeholder="例: 12月度 冬期講習"
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

        {/* 表示中の項目 */}
        <div>
          <h3 className="text-sm font-medium text-[#1f2937] mb-3">
            表示中の項目（{visibleItems.filter((i) => !i.is_hidden).length}件）
          </h3>
          <div className="space-y-2">
            {visibleItems
              .filter((i) => !i.is_hidden)
              .map((item) => (
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
                        <label className="flex items-center gap-2 text-sm text-[#4b5563]">
                          <input
                            type="checkbox"
                            checked={item.teacher_editable === true}
                            onChange={async (e) => {
                              setIsProcessing(true);
                              try {
                                await updateApplicationItem(item.id, { teacher_editable: e.target.checked });
                                success(e.target.checked ? '講師が編集可能に設定しました' : '講師の編集を無効にしました');
                                onUpdated();
                              } catch (error) {
                                console.error('Failed to update teacher_editable:', error);
                                toastError(
                                  error instanceof Error ? error.message : '設定の更新に失敗しました'
                                );
                              } finally {
                                setIsProcessing(false);
                              }
                            }}
                            disabled={isProcessing}
                            className="w-4 h-4 text-[#3b82f6] border-[#e5e7eb] rounded focus:ring-[#3b82f6]"
                          />
                          <span className="text-xs">講師が編集可能</span>
                        </label>
                        <label className="flex items-center gap-2 text-sm text-[#4b5563]">
                          <input
                            type="checkbox"
                            checked={item.manager_only === true}
                            onChange={async (e) => {
                              setIsProcessing(true);
                              try {
                                await updateApplicationItem(item.id, { manager_only: e.target.checked });
                                success(e.target.checked ? '室長以上のみ表示にしました' : '全員に表示にしました');
                                onUpdated();
                              } catch (error) {
                                console.error('Failed to update manager_only:', error);
                                toastError(
                                  error instanceof Error ? error.message : '設定の更新に失敗しました'
                                );
                              } finally {
                                setIsProcessing(false);
                              }
                            }}
                            disabled={isProcessing}
                            className="w-4 h-4 text-[#3b82f6] border-[#e5e7eb] rounded focus:ring-[#3b82f6]"
                          />
                          <span className="text-xs">室長以上のみ表示</span>
                        </label>
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
                          onClick={() => handleHide(item.id)}
                          className="text-sm text-[#4b5563] hover:text-[#4b5563]/60 transition-colors"
                          disabled={isProcessing}
                        >
                          非表示
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
            {visibleItems.filter((i) => !i.is_hidden).length === 0 && (
              <p className="text-[#4b5563]/60 text-sm py-4 text-center">
                表示中の項目がありません
              </p>
            )}
          </div>
        </div>

        {/* 非表示の項目 */}
        {hiddenItems.length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-[#1f2937] mb-3">
              非表示の項目（{hiddenItems.length}件）
            </h3>
            <div className="space-y-2">
              {hiddenItems.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between p-3 bg-[#f3f4f6] rounded-lg border border-[#e5e7eb] opacity-60"
                >
                  <span className="text-[#4b5563]">{item.name}</span>
                  <div className="flex gap-3">
                    <button
                      onClick={() => handleUnhide(item.id)}
                      className="text-sm text-[#4b5563] hover:text-[#3b82f6] transition-colors"
                      disabled={isProcessing}
                    >
                      再表示
                    </button>
                    <button
                      onClick={() => handleDelete(item.id, item.name)}
                      className="text-sm text-[#ef4444] hover:text-[#ef4444]/80 transition-colors"
                      disabled={isProcessing}
                    >
                      削除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
    {ConfirmDialog}
    </>
  );
}
