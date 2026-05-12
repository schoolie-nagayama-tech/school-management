'use client';

import { useMemo, useState, useEffect } from 'react';
import { Button, Modal, InlineLoading } from '@/components/ui';
import { bulkUpdateGrades, getStudents } from '@/lib/api/students';
import type { Student } from '@/types/database';
import { GRADE_LABELS } from '@/types/database';
import { useConfirm } from '@/hooks/useConfirm';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';

function getGradeCategory(grade: number): 'elementary' | 'middle' | 'high' {
  if (grade <= 6) return 'elementary';
  if (grade <= 9) return 'middle';
  return 'high';
}

interface BulkGradeUpdateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  schoolIds: string[];
}

export function BulkGradeUpdateModal({
  isOpen,
  onClose,
  onSuccess,
  schoolIds,
}: BulkGradeUpdateModalProps) {
  const { confirm, ConfirmDialog } = useConfirm();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [students, setStudents] = useState<Student[]>([]);
  const [isLoadingStudents, setIsLoadingStudents] = useState(false);

  useEffect(() => {
    if (isOpen && schoolIds.length > 0) {
      setIsLoadingStudents(true);
      getStudents(undefined, schoolIds)
        .then((data) => setStudents(data))
        .catch(() => setStudents([]))
        .finally(() => setIsLoadingStudents(false));
    }
  }, [isOpen, schoolIds]);

  const { categoryChange, sameCategory, categoryChangeStudents } = useMemo(() => {
    const categoryChangeList: Array<{
      student: Student;
      oldGrade: number;
      newGrade: number;
      oldLabel: string;
      newLabel: string;
    }> = [];
    let sameCount = 0;

    for (const s of students) {
      if (s.status !== 'active') continue;
      const newGrade = Math.min(s.grade + 1, 13);
      if (s.grade === 13) continue;
      const oldCat = getGradeCategory(s.grade);
      const newCat = getGradeCategory(newGrade);
      if (oldCat !== newCat) {
        categoryChangeList.push({
          student: s,
          oldGrade: s.grade,
          newGrade,
          oldLabel: GRADE_LABELS[s.grade] ?? `学年${s.grade}`,
          newLabel: GRADE_LABELS[newGrade] ?? `学年${newGrade}`,
        });
      } else {
        sameCount++;
      }
    }

    return {
      categoryChange: categoryChangeList.length,
      sameCategory: sameCount,
      categoryChangeStudents: categoryChangeList,
    };
  }, [students]);

  const totalCount = categoryChange + sameCategory;

  const handleExecute = async () => {
    if (totalCount === 0) return;
    const confirmed = await confirm({
      title: '一括学年更新',
      description: `${totalCount}名の生徒の学年を一括更新します。カテゴリが変わる生徒（${categoryChange}名）は受講科目・テキストがリセットされます。この操作は取り消せません。実行しますか？`,
      confirmLabel: '実行',
      variant: 'danger',
    });
    if (!confirmed) return;

    setIsSubmitting(true);
    setErrorMessage('');
    try {
      await bulkUpdateGrades(schoolIds);
      onSuccess();
      onClose();
    } catch (error) {
      console.error('Bulk grade update error:', error);
      setErrorMessage(
        getUserErrorMessage(error, '学年の一括更新に失敗しました')
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="一括学年更新"
      size="lg"
    >
      <div className="space-y-6">
        {isLoadingStudents && (
          <InlineLoading label="生徒一覧を取得中..." />
        )}
        {errorMessage && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {errorMessage}
          </div>
        )}

        <div className="text-sm text-[#4b5563]">
          <p>
            選択中の教室の在籍中生徒 <strong>{totalCount}名</strong> の学年を1つ上げます。
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="p-4 rounded-lg border border-amber-200 bg-amber-50">
            <p className="text-xs font-medium text-amber-800 uppercase tracking-wider">
              カテゴリが変わる生徒
            </p>
            <p className="mt-1 text-2xl font-bold text-amber-900">
              {categoryChange}名
            </p>
            <p className="mt-1 text-xs text-amber-700">
              受講科目・テキスト・通塾日程の科目がリセットされます
            </p>
          </div>
          <div className="p-4 rounded-lg border border-gray-200 bg-gray-50">
            <p className="text-xs font-medium text-gray-600 uppercase tracking-wider">
              同じカテゴリ内
            </p>
            <p className="mt-1 text-2xl font-bold text-gray-900">
              {sameCategory}名
            </p>
            <p className="mt-1 text-xs text-gray-600">
              引き継ぎあり（そのまま）
            </p>
          </div>
        </div>

        {categoryChangeStudents.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-[#1f2937] mb-2">
              カテゴリが変わる生徒一覧（{categoryChangeStudents.length}名）
            </h3>
            <div className="max-h-48 overflow-y-auto border border-amber-200 rounded-lg">
              <ul className="divide-y divide-amber-100">
                {categoryChangeStudents.map(({ student, oldLabel, newLabel }) => (
                  <li
                    key={student.id}
                    className="px-4 py-2 flex items-center justify-between bg-amber-50/50 hover:bg-amber-50 transition-colors duration-150"
                  >
                    <span className="font-medium text-[#1f2937]">
                      {student.last_name} {student.first_name}
                    </span>
                    <span className="text-sm text-amber-800 font-mono">
                      {oldLabel} → {newLabel}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-3 pt-4 border-t border-[#e5e7eb]">
          <Button type="button" variant="secondary" onClick={onClose}>
            キャンセル
          </Button>
          <Button
            type="button"
            onClick={handleExecute}
            isLoading={isSubmitting}
            disabled={totalCount === 0 || isLoadingStudents}
          >
            一括更新する
          </Button>
        </div>
      </div>
      {ConfirmDialog}
    </Modal>
  );
}
