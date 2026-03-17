'use client';

import { useState } from 'react';
import { ApplicationItem, ApplicationColumnType } from '@/types/database';
import {
  createApplicationItem,
  updateApplicationItem,
  hideApplicationItem,
  unhideApplicationItem,
  deleteApplicationItem,
} from '@/lib/api/applications';
import { Button, Input } from '@/components/ui';
import { useToast } from '@/hooks/useToast';

interface ApplicationItemAccordionProps {
  schoolId?: string;
  items: ApplicationItem[];
  showHidden: boolean;
  onUpdated: () => void;
}

export function ApplicationItemAccordion({
  schoolId: _schoolId,
  items,
  showHidden,
  onUpdated,
}: ApplicationItemAccordionProps) {
  const { success, error: toastError } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [newItemColumnType, setNewItemColumnType] = useState<ApplicationColumnType>('check');
  const [newItemDueDate, setNewItemDueDate] = useState<string>('');
  const [newItemManagerOnly, setNewItemManagerOnly] = useState(false);
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
      await createApplicationItem(
        {
          name: newItemName.trim(),
          column_type: newItemColumnType,
          due_date: newItemDueDate || null,
          manager_only: newItemManagerOnly,
        },
        _schoolId
      );
      success('項目を追加しました');
      setNewItemName('');
      setNewItemColumnType('check');
      setNewItemDueDate('');
      setNewItemManagerOnly(false);
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
    if (!window.confirm('この項目を非表示にしますか？\n（申込データは保持されます）')) {
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
      !window.confirm(
        `「${name}」を削除しますか？\n\n⚠️ この項目に関連する全ての申込データも削除されます。\nこの操作は取り消せません。`
      )
    ) {
      return;
    }

    // 二重確認
    if (!window.confirm('本当に削除しますか？')) {
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
    <div className="mb-6 bg-white rounded-xl border border-[#e5e7eb] overflow-hidden">
      {/* アコーディオンヘッダー */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-3 bg-[#f3f4f6] hover:bg-[#f3f4f6]/80 transition-colors"
      >
        <span className="text-sm font-semibold text-[#1f2937]">項目管理</span>
        <svg
          className={`w-5 h-5 text-[#4b5563] transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {/* アコーディオンコンテンツ */}
      {isOpen && (
        <div className="p-4 space-y-6 border-t border-[#e5e7eb]">
          {/* 新規追加 */}
          <div>
            <label className="block text-sm font-medium text-[#1f2937] mb-2">
              新しい項目を追加
            </label>
            <div className="flex flex-col gap-2">
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
              <div className="flex flex-wrap items-center gap-3">
                <select
                  value={newItemColumnType}
                  onChange={(e) => setNewItemColumnType(e.target.value as ApplicationColumnType)}
                  className="px-3 py-2 text-sm border border-[#e5e7eb] rounded-lg bg-white text-[#1f2937] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]"
                  disabled={isProcessing}
                >
                  <option value="check">チェック</option>
                  <option value="number">数値</option>
                  <option value="date">日付</option>
                </select>
                <input
                  type="date"
                  value={newItemDueDate}
                  onChange={(e) => setNewItemDueDate(e.target.value)}
                  className="px-3 py-2 text-sm border border-[#e5e7eb] rounded-lg bg-white text-[#1f2937] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]"
                  disabled={isProcessing}
                  placeholder="期日（任意）"
                />
                <label className="flex items-center gap-2 text-sm text-[#4b5563]">
                  <input
                    type="checkbox"
                    checked={newItemManagerOnly}
                    onChange={(e) => setNewItemManagerOnly(e.target.checked)}
                    className="w-4 h-4 text-[#3b82f6] border-[#e5e7eb] rounded focus:ring-[#3b82f6]"
                    disabled={isProcessing}
                  />
                  <span>室長以上のみ表示（講師には非表示）</span>
                </label>
              </div>
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
      )}
    </div>
  );
}
