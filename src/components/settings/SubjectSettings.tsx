'use client';

import { useState, useEffect } from 'react';
import { Button, Input, Modal, Spinner } from '@/components/ui';
import { ChevronDown, ChevronUp, Pencil, Trash2, Plus } from 'lucide-react';
import {
  getSubjects,
  createSubject,
  updateSubject,
  deleteSubject,
  updateSubjectSortOrders,
} from '@/lib/api/subjects';
import type { Subject, SubjectInsert } from '@/types/database';
import { GRADE_CATEGORY_LABELS } from '@/types/database';
import { useConfirm } from '@/hooks/useConfirm';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';

interface SubjectSettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

type GradeCategory = 'elementary' | 'middle' | 'high';

export function SubjectSettings({ isOpen, onClose }: SubjectSettingsProps) {
  const { confirm, ConfirmDialog } = useConfirm();
  const [activeTab, setActiveTab] = useState<GradeCategory>('elementary');
  const [subjects, setSubjects] = useState<Record<GradeCategory, Subject[]>>({
    elementary: [],
    middle: [],
    high: [],
  });
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingSubject, setEditingSubject] = useState<Subject | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 科目一覧を取得
  const fetchSubjects = async () => {
    setIsLoading(true);
    setErrorMessage('');
    try {
      const [elementary, middle, high] = await Promise.all([
        getSubjects('elementary'),
        getSubjects('middle'),
        getSubjects('high'),
      ]);
      setSubjects({ elementary, middle, high });
    } catch (error) {
      console.error('Error fetching subjects:', error);
      setErrorMessage(
        getUserErrorMessage(error, '科目一覧の取得に失敗しました')
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchSubjects();
    }
  }, [isOpen]);

  // 科目を追加
  const handleAdd = () => {
    setEditingSubject(null);
    setIsEditModalOpen(true);
  };

  // 科目を編集
  const handleEdit = (subject: Subject) => {
    setEditingSubject(subject);
    setIsEditModalOpen(true);
  };

  // 科目を削除
  const handleDelete = async (id: string) => {
    if (!(await confirm({ title: '削除確認', description: 'この科目を削除しますか？', confirmLabel: '削除', variant: 'danger' }))) return;

    setIsSubmitting(true);
    setErrorMessage('');
    try {
      await deleteSubject(id);
      await fetchSubjects();
    } catch (error) {
      console.error('Error deleting subject:', error);
      setErrorMessage(
        getUserErrorMessage(error, '科目の削除に失敗しました')
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // 並び順を変更（上に移動）
  const handleMoveUp = async (subject: Subject) => {
    const currentSubjects = subjects[activeTab];
    const index = currentSubjects.findIndex((s) => s.id === subject.id);
    if (index <= 0) return;

    const newOrder = [...currentSubjects];
    [newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]];

    const updates = newOrder.map((s, i) => ({
      id: s.id,
      sort_order: i,
    }));

    setIsSubmitting(true);
    try {
      await updateSubjectSortOrders(updates);
      await fetchSubjects();
    } catch (error) {
      console.error('Error updating sort order:', error);
      setErrorMessage('並び順の更新に失敗しました');
    } finally {
      setIsSubmitting(false);
    }
  };

  // 並び順を変更（下に移動）
  const handleMoveDown = async (subject: Subject) => {
    const currentSubjects = subjects[activeTab];
    const index = currentSubjects.findIndex((s) => s.id === subject.id);
    if (index >= currentSubjects.length - 1) return;

    const newOrder = [...currentSubjects];
    [newOrder[index], newOrder[index + 1]] = [newOrder[index + 1], newOrder[index]];

    const updates = newOrder.map((s, i) => ({
      id: s.id,
      sort_order: i,
    }));

    setIsSubmitting(true);
    try {
      await updateSubjectSortOrders(updates);
      await fetchSubjects();
    } catch (error) {
      console.error('Error updating sort order:', error);
      setErrorMessage('並び順の更新に失敗しました');
    } finally {
      setIsSubmitting(false);
    }
  };

  const currentSubjects = subjects[activeTab];

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title="科目設定" size="lg">
        <div className="space-y-6">
          {/* エラーメッセージ */}
          {errorMessage && (
            <div className="p-4 bg-[#ef4444]/10 border border-[#ef4444] rounded-lg">
              <p className="text-sm text-[#ef4444]">{errorMessage}</p>
            </div>
          )}

          {/* タブ */}
          <div className="border-b border-[#e5e7eb]">
            <nav className="flex space-x-4">
              {(['elementary', 'middle', 'high'] as GradeCategory[]).map((category) => (
                <button
                  key={category}
                  onClick={() => setActiveTab(category)}
                  className={`
                    py-2 px-4 text-sm font-medium border-b-2 transition-colors
                    ${
                      activeTab === category
                        ? 'border-[#3b82f6] text-[#1f2937]'
                        : 'border-transparent text-[#4b5563] hover:text-[#1f2937] hover:border-[#e5e7eb]'
                    }
                  `}
                >
                  {GRADE_CATEGORY_LABELS[category]}
                </button>
              ))}
            </nav>
          </div>

          {/* 科目一覧 */}
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Spinner size="md" />
            </div>
          ) : (
            <div className="space-y-2">
              {currentSubjects.length === 0 ? (
                <p className="text-sm text-[#4b5563] text-center py-8">
                  科目が登録されていません。下の「科目を追加」ボタンから追加してください。
                </p>
              ) : (
                currentSubjects.map((subject, index) => (
                  <div
                    key={subject.id}
                    className="flex items-center gap-3 p-3 bg-[#f3f4f6] rounded-lg hover:bg-white transition-colors border border-[#e5e7eb]"
                  >
                    <div className="flex-1 flex items-center gap-2">
                      <p className="text-sm font-medium text-[#1f2937]">{subject.name}</p>
                      {subject.duration_minutes === 45 && (
                        <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 text-xs rounded font-medium">
                          45分
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleMoveUp(subject)}
                        disabled={index === 0 || isSubmitting}
                        className="p-1.5 text-[#4b5563] hover:text-[#1f2937] disabled:opacity-50 disabled:cursor-not-allowed"
                        title="上に移動"
                      >
                        <ChevronUp className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleMoveDown(subject)}
                        disabled={index === currentSubjects.length - 1 || isSubmitting}
                        className="p-1.5 text-[#4b5563] hover:text-[#1f2937] disabled:opacity-50 disabled:cursor-not-allowed"
                        title="下に移動"
                      >
                        <ChevronDown className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleEdit(subject)}
                        disabled={isSubmitting}
                        className="p-1.5 text-[#4b5563] hover:text-[#3b82f6] disabled:opacity-50"
                        title="編集"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(subject.id)}
                        disabled={isSubmitting}
                        className="p-1.5 text-[#4b5563] hover:text-[#ef4444] disabled:opacity-50"
                        title="削除"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* 追加ボタン */}
          <div className="flex justify-end pt-4 border-t border-[#e5e7eb]">
            <Button onClick={handleAdd} disabled={isSubmitting}>
              <Plus className="w-4 h-4 mr-2" />
              科目を追加
            </Button>
          </div>
        </div>
      </Modal>

      {ConfirmDialog}

      {/* 編集モーダル */}
      <SubjectEditModal
        isOpen={isEditModalOpen}
        subject={editingSubject}
        gradeCategory={activeTab}
        onClose={() => {
          setIsEditModalOpen(false);
          setEditingSubject(null);
        }}
        onSuccess={() => {
          setIsEditModalOpen(false);
          setEditingSubject(null);
          fetchSubjects();
        }}
      />
    </>
  );
}

// 科目編集モーダル
interface SubjectEditModalProps {
  isOpen: boolean;
  subject: Subject | null;
  gradeCategory: GradeCategory;
  onClose: () => void;
  onSuccess: () => void;
}

function SubjectEditModal({
  isOpen,
  subject,
  gradeCategory,
  onClose,
  onSuccess,
}: SubjectEditModalProps) {
  const [name, setName] = useState('');
  const [durationMinutes, setDurationMinutes] = useState<45 | 90>(90);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setName(subject?.name || '');
      setDurationMinutes((subject?.duration_minutes as 45 | 90) ?? 90);
      setError('');
    }
  }, [isOpen, subject]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!name.trim()) {
      setError('科目名を入力してください');
      return;
    }

    setIsSubmitting(true);
    try {
      if (subject) {
        // 更新
        await updateSubject(subject.id, { name: name.trim(), duration_minutes: durationMinutes });
      } else {
        // 新規作成
        const currentSubjects = await getSubjects(gradeCategory);
        const newSubject: SubjectInsert = {
          name: name.trim(),
          grade_category: gradeCategory,
          sort_order: currentSubjects.length,
          duration_minutes: durationMinutes,
        };
        await createSubject(newSubject);
      }
      onSuccess();
    } catch (error) {
      console.error('Error saving subject:', error);
      setError(
        getUserErrorMessage(error, '科目の保存に失敗しました')
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={subject ? '科目の編集' : '科目の追加'}
      size="sm"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-[#ef4444]/10 border border-[#ef4444] rounded-lg">
            <p className="text-sm text-[#ef4444]">{error}</p>
          </div>
        )}

        <Input
          label="科目名"
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={error}
          placeholder="例: 数学"
          required
          autoFocus
        />

        {/* 授業時間 */}
        <div>
          <label className="block text-sm font-medium text-[#1f2937] mb-2">授業時間</label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setDurationMinutes(90)}
              className={`flex-1 py-2 text-sm font-medium rounded-lg border transition-colors ${
                durationMinutes === 90
                  ? 'bg-[#1e3a5f] text-white border-[#1e3a5f]'
                  : 'bg-white text-[#4b5563] border-[#e5e7eb] hover:border-[#1e3a5f]'
              }`}
            >
              90分
            </button>
            <button
              type="button"
              onClick={() => setDurationMinutes(45)}
              className={`flex-1 py-2 text-sm font-medium rounded-lg border transition-colors ${
                durationMinutes === 45
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-[#4b5563] border-[#e5e7eb] hover:border-blue-600'
              }`}
            >
              45分
            </button>
          </div>
          <p className="text-xs text-[#6b7280] mt-1">
            {durationMinutes === 45
              ? '主に小4以下の授業で使用します'
              : '通常の90分授業です'}
          </p>
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t border-[#e5e7eb]">
          <Button type="button" variant="secondary" onClick={onClose}>
            キャンセル
          </Button>
          <Button type="submit" isLoading={isSubmitting}>
            {subject ? '更新する' : '追加する'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
