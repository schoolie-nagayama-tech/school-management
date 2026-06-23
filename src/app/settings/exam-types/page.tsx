'use client';

/**
 * 試験名マスタ設定ページ
 *
 * 教室ごとにテスト種別（中間テスト、期末テスト等）を管理する。
 * 進行表の目標設定・試験範囲で使用される。
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AdminLayout } from '@/components/layouts';
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Input,
  ToastContainer,
  Loading,
} from '@/components/ui';
import { useToast } from '@/hooks/useToast';
import { useConfirm } from '@/hooks/useConfirm';
import { useRequirePermission } from '@/hooks/usePermissions';
import { useAuth } from '@/contexts/AuthContext';
import AccessDenied from '@/components/AccessDenied';
import { ChevronLeft, Plus, Trash2, Pencil, Check, X } from 'lucide-react';
import { getExamTypes, createExamType, updateExamType, deleteExamType } from '@/lib/api/textbooks';
import { getSchools } from '@/lib/api/schools';
import type { School, ExamType } from '@/types/database';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';

export default function ExamTypesSettingsPage() {
  const { hasPermission, isLoading: permissionLoading } = useRequirePermission(
    (p) => p.canAccessSettings
  );
  const { toasts, removeToast, success, error: toastError } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const { schoolIds, selectedSchoolId: authSelectedSchoolId } = useAuth();

  const [schools, setSchools] = useState<School[]>([]);
  const [selectedSchoolId, setSelectedSchoolId] = useState<string | null>(null);
  const [examTypes, setExamTypes] = useState<ExamType[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // 新規追加
  const [newName, setNewName] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  // インライン編集
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  // 教室一覧を取得
  useEffect(() => {
    getSchools().then((list) => {
      const accessible = list.filter((s) => schoolIds.includes(s.id));
      setSchools(accessible);
      const initialId =
        authSelectedSchoolId &&
        authSelectedSchoolId !== 'all' &&
        schoolIds.includes(authSelectedSchoolId)
          ? authSelectedSchoolId
          : (accessible[0]?.id ?? null);
      setSelectedSchoolId(initialId);
    });
  }, [authSelectedSchoolId, schoolIds]);

  // 試験名を取得
  const fetchExamTypes = useCallback(async () => {
    if (!selectedSchoolId) return;
    setIsLoading(true);
    try {
      const data = await getExamTypes(selectedSchoolId);
      setExamTypes(data);
    } catch (e) {
      console.error(e);
      toastError('試験名マスタの取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [selectedSchoolId, toastError]);

  useEffect(() => {
    fetchExamTypes();
  }, [fetchExamTypes]);

  // 教室切り替え時にリセット
  useEffect(() => {
    setEditingId(null);
    setNewName('');
  }, [selectedSchoolId]);

  // 新規追加
  const handleAdd = async () => {
    if (!newName.trim() || !selectedSchoolId) return;
    setIsAdding(true);
    try {
      // sort_order は末尾
      const maxOrder =
        examTypes.length > 0 ? Math.max(...examTypes.map((e) => e.sort_order)) + 1 : 0;
      await createExamType({
        school_id: selectedSchoolId,
        name: newName.trim(),
        sort_order: maxOrder,
      });
      setNewName('');
      await fetchExamTypes();
      success('追加しました');
    } catch (e) {
      console.error(e);
      toastError(getUserErrorMessage(e, '追加に失敗しました'));
    } finally {
      setIsAdding(false);
    }
  };

  // 名前編集の保存
  const handleSaveEdit = async () => {
    if (!editingId || !editingName.trim()) return;
    try {
      await updateExamType(editingId, { name: editingName.trim() });
      setEditingId(null);
      await fetchExamTypes();
      success('更新しました');
    } catch (e) {
      console.error(e);
      toastError(getUserErrorMessage(e, '更新に失敗しました'));
    }
  };

  // 削除
  const handleDelete = async (item: ExamType) => {
    const confirmed = await confirm({
      title: '試験名を削除',
      description: `「${item.name}」を削除しますか？\nこの試験名を使用中の目標設定や試験範囲がある場合、削除できません。`,
      confirmLabel: '削除',
      variant: 'danger',
    });
    if (!confirmed) return;
    try {
      await deleteExamType(item.id);
      await fetchExamTypes();
      success('削除しました');
    } catch (e) {
      console.error(e);
      toastError(
        getUserErrorMessage(e, '削除に失敗しました。使用中のデータがある場合は削除できません。')
      );
    }
  };

  // 並び替え（上下移動）
  const handleMove = async (index: number, direction: 'up' | 'down') => {
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= examTypes.length) return;

    const a = examTypes[index];
    const b = examTypes[swapIndex];
    try {
      // sort_order を交換
      await Promise.all([
        updateExamType(a.id, { sort_order: b.sort_order }),
        updateExamType(b.id, { sort_order: a.sort_order }),
      ]);
      await fetchExamTypes();
    } catch (e) {
      console.error(e);
      toastError('並び替えに失敗しました');
    }
  };

  if (permissionLoading) {
    return (
      <AdminLayout>
        <Loading size="md" />
      </AdminLayout>
    );
  }
  if (!hasPermission) {
    return (
      <AdminLayout>
        <AccessDenied />
      </AdminLayout>
    );
  }

  return (
    <AdminLayout headerTitle="試験名マスタ">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <Link
          href="/settings"
          className="inline-flex items-center text-sm text-text-faint hover:text-text-body"
        >
          <ChevronLeft className="w-4 h-4 mr-1" />
          設定一覧に戻る
        </Link>

        <Card>
          <CardHeader>
            <CardTitle>試験名マスタ</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-text-body">
              進行表の目標設定・試験範囲で使用する試験名を管理します。教室ごとに設定できます。
            </p>

            {/* 教室選択 */}
            {schools.length > 1 && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-text-muted font-medium whitespace-nowrap">教室:</span>
                <select
                  value={selectedSchoolId ?? ''}
                  onChange={(e) => setSelectedSchoolId(e.target.value || null)}
                  className="flex-1 px-2 py-1.5 border border-border rounded-lg text-sm bg-surface-raised"
                >
                  {schools.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {schools.length === 1 && (
              <div className="text-sm text-text-body">
                教室: <span className="font-medium text-text-heading">{schools[0]?.name}</span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 一覧 */}
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="py-12">
                <Loading size="md" />
              </div>
            ) : examTypes.length === 0 ? (
              <div className="py-12 text-center text-sm text-text-faint">
                試験名が登録されていません
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {examTypes.map((item, index) => (
                  <li
                    key={item.id}
                    className="flex items-center gap-2 px-4 py-3 hover:bg-surface-hover transition-colors"
                  >
                    {/* 並び替えボタン */}
                    <div className="flex flex-col -my-1">
                      <button
                        onClick={() => handleMove(index, 'up')}
                        disabled={index === 0}
                        className="p-0.5 text-text-faint hover:text-text-body disabled:opacity-20 disabled:cursor-not-allowed"
                        title="上に移動"
                      >
                        <svg
                          className="w-3.5 h-3.5"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <path d="M18 15l-6-6-6 6" />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleMove(index, 'down')}
                        disabled={index === examTypes.length - 1}
                        className="p-0.5 text-text-faint hover:text-text-body disabled:opacity-20 disabled:cursor-not-allowed"
                        title="下に移動"
                      >
                        <svg
                          className="w-3.5 h-3.5"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <path d="M6 9l6 6 6-6" />
                        </svg>
                      </button>
                    </div>

                    {/* 名前（編集モード or 表示モード） */}
                    {editingId === item.id ? (
                      <div className="flex-1 flex items-center gap-2">
                        <Input
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveEdit();
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                          className="flex-1 h-8 text-sm"
                          autoFocus
                        />
                        <button
                          onClick={handleSaveEdit}
                          disabled={!editingName.trim()}
                          className="p-1.5 text-green-600 hover:bg-green-50 rounded disabled:opacity-40"
                          title="保存"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="p-1.5 text-text-faint hover:bg-surface-hover rounded"
                          title="キャンセル"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <span className="flex-1 text-sm text-text-heading">{item.name}</span>
                        <button
                          onClick={() => {
                            setEditingId(item.id);
                            setEditingName(item.name);
                          }}
                          className="p-1.5 text-text-faint hover:text-text-body hover:bg-surface-hover rounded"
                          title="名前を編集"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(item)}
                          className="p-1.5 text-text-faint hover:text-danger hover:bg-red-50 rounded"
                          title="削除"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {/* 新規追加フォーム */}
            <div className="flex items-center gap-2 px-4 py-3 border-t border-border bg-surface">
              <Plus className="w-4 h-4 text-text-faint flex-shrink-0" />
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAdd();
                }}
                placeholder="新しい試験名を入力（例: 中間テスト）"
                className="flex-1 h-8 text-sm"
                disabled={isAdding || !selectedSchoolId}
              />
              <Button
                onClick={handleAdd}
                disabled={!newName.trim() || isAdding || !selectedSchoolId}
                size="sm"
              >
                {isAdding ? '追加中...' : '追加'}
              </Button>
            </div>
          </CardContent>
        </Card>

        <ToastContainer toasts={toasts} onRemove={removeToast} />
        {ConfirmDialog}
      </div>
    </AdminLayout>
  );
}
