'use client';

import { useState, useEffect, useCallback } from 'react';
import { AdminLayout } from '@/components/layouts';
import { Button, Input, Label, Loading } from '@/components/ui';
import { ToastContainer } from '@/components/ui';
import { useToast } from '@/hooks/useToast';
import { useConfirm } from '@/hooks/useConfirm';
import type { TrainingMaster } from '@/types/database';
import {
  getTrainingMasters,
  createTrainingMaster,
  updateTrainingMaster,
  deleteTrainingMaster,
} from '@/lib/api/training-masters';

interface EditState {
  id: string | null;
  name: string;
  period_label: string;
  description: string;
  sort_order: number;
  is_active: boolean;
}

const EMPTY_EDIT: EditState = {
  id: null,
  name: '',
  period_label: '',
  description: '',
  sort_order: 0,
  is_active: true,
};

export default function TrainingMastersPage() {
  const { toasts, success, error: toastError, removeToast } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();

  const [items, setItems] = useState<TrainingMaster[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [edit, setEdit] = useState<EditState>(EMPTY_EDIT);
  const [saving, setSaving] = useState(false);

  const fetchItems = useCallback(async () => {
    try {
      const data = await getTrainingMasters(false);
      setItems(data);
    } catch (e) {
      toastError(e instanceof Error ? e.message : '取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [toastError]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const openCreate = () => {
    setEdit(EMPTY_EDIT);
    setDialogOpen(true);
  };

  const openEdit = (m: TrainingMaster) => {
    setEdit({
      id: m.id,
      name: m.name,
      period_label: m.period_label ?? '',
      description: m.description ?? '',
      sort_order: m.sort_order,
      is_active: m.is_active,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!edit.name.trim()) {
      toastError('研修名を入力してください');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: edit.name.trim(),
        period_label: edit.period_label.trim() || null,
        description: edit.description.trim() || null,
        sort_order: Number(edit.sort_order) || 0,
        is_active: edit.is_active,
      };
      if (edit.id) {
        const updated = await updateTrainingMaster(edit.id, payload);
        setItems((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
        success('更新しました');
      } else {
        const created = await createTrainingMaster(payload);
        setItems((prev) => [...prev, created].sort((a, b) => a.sort_order - b.sort_order));
        success('追加しました');
      }
      setDialogOpen(false);
    } catch (e) {
      toastError(e instanceof Error ? e.message : '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (m: TrainingMaster) => {
    try {
      const updated = await updateTrainingMaster(m.id, { is_active: !m.is_active });
      setItems((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
    } catch (e) {
      toastError(e instanceof Error ? e.message : '更新に失敗しました');
    }
  };

  const handleDelete = async (m: TrainingMaster) => {
    if (
      !(await confirm({
        title: '削除確認',
        description: `「${m.name}」を完全に削除しますか？\n（講師に紐づく履歴のマスタ参照はクリアされます）`,
        confirmLabel: '削除',
        variant: 'danger',
      }))
    ) {
      return;
    }
    try {
      await deleteTrainingMaster(m.id);
      setItems((prev) => prev.filter((x) => x.id !== m.id));
      success('削除しました');
    } catch (e) {
      toastError(e instanceof Error ? e.message : '削除に失敗しました');
    }
  };

  return (
    <AdminLayout
      headerTitle="研修マスタ管理"
      title="研修マスタ管理"
      actions={
        <button
          onClick={openCreate}
          className="px-4 py-2 text-sm font-medium text-white bg-ink rounded-lg hover:bg-ink/80 transition-colors duration-150"
        >
          + 新規作成
        </button>
      }
    >
      {loading ? (
        <Loading size="md" />
      ) : items.length === 0 ? (
        <div className="text-text-dangeraintenter py-16 text-gray-400">
          <p className="text-sm">研修マスタがまだありません</p>
          <button
            onClick={openCreate}
            className="mt-3 text-sm text-ink hover:underline transition-colors duration-150"
          >
            最初の研修を登録する
          </button>
        </div>
      ) : (
        <div className="bg-surface-raised rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-infoorderorder border-gray-200">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">研修名</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">期・ラベル</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">説明</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">順序</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">状態</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((m) => {
                const inactive = !m.is_active;
                return (
                  <tr key={m.id} className={`hover:bg-gray-50/50 transition-colors duration-150 ${inactive ? 'opacity-60' : ''}`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900">{m.name}</span>
                        {inactive && (
                          <span className="text-[10px] font-semibold text-gray-500 bg-gray-200 px-1.5 py-0.5 rounded">無効</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{m.period_label || '-'}</td>
                    <td className="px-4 py-3 text-sm text-gray-500 max-w-xs truncate">{m.description || '-'}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{m.sort_order}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded ${inactive ? 'bg-gray-100 text-gray-500' : 'bg-inkmerald-50 text-dangermerald-700'}`}>
                        {inactive ? '無効' : '有効'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-3">
                        <button onClick={() => openEdit(m)} className="text-xs text-ink hover:underline transition-colors duration-150">編集</button>
                        <button onClick={() => handleToggleActive(m)} className={`text-xs hover:underline transition-colors duration-150 ${inactive ? 'text-dangermerald-600' : 'text-text-headingmber-600'}`}>
                          {inactive ? '再有効化' : '無効化'}
                        </button>
                        <button onClick={() => handleDelete(m)} className="text-xs text-red-500 hover:underline transition-colors duration-150">削除</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 編集ダイアログ */}
      {dialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-surfacelack/40 p-4" onClick={() => setDialogOpen(false)}>
          <div
            className="bg-surface-raised rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-infoorderorder border-gray-200">
              <h3 className="text-text-text-mutedodyase font-semibold text-gray-900">
                {edit.id ? '研修マスタを編集' : '研修マスタを追加'}
              </h3>
            </div>
            <div className="px-6 py-4 space-y-3">
              <div>
                <Label htmlFor="tm-name" className="text-xs">
                  研修名 <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="tm-name"
                  value={edit.name}
                  onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                  placeholder="例: 新人研修 2026春"
                />
              </div>
              <div>
                <Label htmlFor="tm-period" className="text-xs">期・ラベル</Label>
                <Input
                  id="tm-period"
                  value={edit.period_label}
                  onChange={(e) => setEdit({ ...edit, period_label: e.target.value })}
                  placeholder="例: 2026年春期"
                />
              </div>
              <div>
                <Label htmlFor="tm-desc" className="text-xs">説明</Label>
                <Input
                  id="tm-desc"
                  value={edit.description}
                  onChange={(e) => setEdit({ ...edit, description: e.target.value })}
                  placeholder="任意"
                />
              </div>
              <div>
                <Label htmlFor="tm-sort" className="text-xs">表示順</Label>
                <Input
                  id="tm-sort"
                  type="number"
                  value={edit.sort_order}
                  onChange={(e) => setEdit({ ...edit, sort_order: Number(e.target.value) })}
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={edit.is_active}
                  onChange={(e) => setEdit({ ...edit, is_active: e.target.checked })}
                />
                有効にする
              </label>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
                キャンセル
              </Button>
              <Button onClick={handleSave} disabled={saving || !edit.name.trim()}>
                {saving ? '保存中…' : '保存'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {ConfirmDialog}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </AdminLayout>
  );
}
