'use client';

import { useState } from 'react';
import { Modal, Button, InlineLoading } from '@/components/ui';
import type { FormResponse, Student } from '@/types/database';
import { GRADE_LABELS } from '@/types/database';
import { linkResponseToStudent } from '@/lib/api/form-responses';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';

interface LinkStudentModalProps {
  isOpen: boolean;
  onClose: () => void;
  response: FormResponse | null;
  students: Student[];
  isLoadingStudents?: boolean;
  onSuccess: () => void;
}

export function LinkStudentModal({
  isOpen,
  onClose,
  response,
  students,
  isLoadingStudents = false,
  onSuccess,
}: LinkStudentModalProps) {
  const [selectedStudentId, setSelectedStudentId] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (!response) return null;

  const handleSubmit = async () => {
    if (!selectedStudentId) {
      setError('生徒を選択してください');
      return;
    }

    setIsSubmitting(true);
    setError('');
    try {
      await linkResponseToStudent(response.id, selectedStudentId);
      onSuccess();
    } catch (error) {
      console.error('Error linking response:', error);
      setError(
        getUserErrorMessage(error, '紐付けに失敗しました')
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="生徒への紐付け"
    >
      <div className="space-y-4">
        {/* 回答者情報 */}
        <div className="bg-[#f3f4f6] p-4 rounded-lg border border-[#e5e7eb]">
          <h3 className="font-semibold text-[#1f2937] mb-2">回答者情報</h3>
          <div className="text-sm text-[#4b5563] space-y-1">
            <div>
              <span className="text-[#4b5563]/60">生徒名:</span>{' '}
              <span className="text-[#4b5563]">{response.student_name}</span>
            </div>
            <div>
              <span className="text-[#4b5563]/60">学年:</span>{' '}
              <span className="text-[#4b5563]">
                {response.grade ? GRADE_LABELS[response.grade] : '-'}
              </span>
            </div>
          </div>
        </div>

        {/* エラー表示 */}
        {error && (
          <div className="bg-[#ef4444]/20 text-[#ef4444] px-4 py-2 rounded border border-[#ef4444]">
            {error}
          </div>
        )}

        {/* 生徒選択 */}
        <div>
          <label className="block text-sm font-medium text-[#4b5563] mb-2">
            同じ学年の生徒を選択 <span className="text-[#ef4444]">*</span>
          </label>
          {isLoadingStudents ? (
            <div className="py-8">
              <InlineLoading label="生徒一覧を読み込み中..." />
            </div>
          ) : students.length === 0 ? (
            <div className="text-center py-8 text-[#4b5563]/60">
              同じ学年の生徒が登録されていません
            </div>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto border border-[#e5e7eb] rounded-lg p-2">
              {students.map((student) => (
                <label
                  key={student.id}
                  className="flex items-center gap-3 p-3 hover:bg-[#f3f4f6] rounded cursor-pointer transition-colors duration-150"
                >
                  <input
                    type="radio"
                    name="student"
                    value={student.id}
                    checked={selectedStudentId === student.id}
                    onChange={(e) => {
                      setSelectedStudentId(e.target.value);
                      setError('');
                    }}
                    disabled={isSubmitting}
                    className="w-4 h-4 text-[#3b82f6] border-[#e5e7eb] focus:ring-[#3b82f6]"
                  />
                  <div className="flex-1">
                    <div className="text-[#1f2937] font-medium">
                      {student.last_name} {student.first_name}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* ボタン */}
        <div className="flex justify-end gap-2 pt-4 border-t border-[#e5e7eb]">
          <Button onClick={onClose} variant="secondary" disabled={isSubmitting}>
            キャンセル
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting || !selectedStudentId || students.length === 0}
          >
            {isSubmitting ? '更新中...' : '更新'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
