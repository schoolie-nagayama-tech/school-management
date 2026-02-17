'use client';

import { useState, useEffect } from 'react';
import { Button, Input, Modal } from '@/components/ui';
import {
  getSubjects,
  createSubject,
  updateSubject,
  deleteSubject,
  updateSubjectSortOrders,
} from '@/lib/api/subjects';
import type { Subject, SubjectInsert } from '@/types/database';
import { GRADE_CATEGORY_LABELS } from '@/types/database';

interface SubjectSettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

type GradeCategory = 'elementary' | 'middle' | 'high';

export function SubjectSettings({ isOpen, onClose }: SubjectSettingsProps) {
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
        error instanceof Error ? error.message : '科目一覧の取得に失敗しました'
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
    if (!confirm('この科目を削除しますか？')) return;

    setIsSubmitting(true);
    setErrorMessage('');
    try {
      await deleteSubject(id);
      await fetchSubjects();
    } catch (error) {
      console.error('Error deleting subject:', error);
      setErrorMessage(
        error instanceof Error ? error.message : '科目の削除に失敗しました'
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
              <div className="animate-spin h-8 w-8 border-4 border-[#1e3a5f] border-t-transparent rounded-full"></div>
            </div>
          ) : (
            <div className="space-y-2">
              {currentSubjects.length === 0 ? (
                <p className="text-sm text-[#4b5563] text-center py-8">
                  科目が登録されていません
                </p>
              ) : (
                currentSubjects.map((subject, index) => (
                  <div
                    key={subject.id}
                    className="flex items-center gap-3 p-3 bg-[#f3f4f6] rounded-lg hover:bg-white transition-colors border border-[#e5e7eb]"
                  >
                    <div className="flex-1">
                      <p className="text-sm font-medium text-[#1f2937]">{subject.name}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleMoveUp(subject)}
                        disabled={index === 0 || isSubmitting}
                        className="p-1.5 text-[#4b5563] hover:text-[#1f2937] disabled:opacity-50 disabled:cursor-not-allowed"
                        title="上に移動"
                      >
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M5 15l7-7 7 7"
                          />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleMoveDown(subject)}
                        disabled={index === currentSubjects.length - 1 || isSubmitting}
                        className="p-1.5 text-[#4b5563] hover:text-[#1f2937] disabled:opacity-50 disabled:cursor-not-allowed"
                        title="下に移動"
                      >
                        <svg
                          className="w-4 h-4"
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
                      <button
                        onClick={() => handleEdit(subject)}
                        disabled={isSubmitting}
                        className="p-1.5 text-[#4b5563] hover:text-[#3b82f6] disabled:opacity-50"
                        title="編集"
                      >
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                          />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleDelete(subject.id)}
                        disabled={isSubmitting}
                        className="p-1.5 text-[#4b5563] hover:text-[#ef4444] disabled:opacity-50"
                        title="削除"
                      >
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                          />
                        </svg>
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
              <svg
                className="w-4 h-4 mr-2"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 4v16m8-8H4"
                />
              </svg>
              科目を追加
            </Button>
          </div>
        </div>
      </Modal>

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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setName(subject?.name || '');
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
        await updateSubject(subject.id, { name: name.trim() });
      } else {
        // 新規作成
        const currentSubjects = await getSubjects(gradeCategory);
        const newSubject: SubjectInsert = {
          name: name.trim(),
          grade_category: gradeCategory,
          sort_order: currentSubjects.length,
        };
        await createSubject(newSubject);
      }
      onSuccess();
    } catch (error) {
      console.error('Error saving subject:', error);
      setError(
        error instanceof Error ? error.message : '科目の保存に失敗しました'
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
