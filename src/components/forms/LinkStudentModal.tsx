'use client';

import { useState } from 'react';
import { Modal, Button } from '@/components/ui';
import type { FormResponse, Student } from '@/types/database';
import { GRADE_LABELS } from '@/types/database';
import { linkResponseToStudent } from '@/lib/api/form-responses';

interface LinkStudentModalProps {
  isOpen: boolean;
  onClose: () => void;
  response: FormResponse | null;
  students: Student[];
  onSuccess: () => void;
}

export function LinkStudentModal({
  isOpen,
  onClose,
  response,
  students,
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
        error instanceof Error ? error.message : '紐付けに失敗しました'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="申込状況を更新"
    >
      <div className="space-y-4">
        {/* 回答者情報 */}
        <div className="bg-[#eff0f3] p-4 rounded-lg border border-[#0d0d0d]">
          <h3 className="font-semibold text-[#0d0d0d] mb-2">回答者情報</h3>
          <div className="text-sm text-[#2a2a2a] space-y-1">
            <div>
              <span className="text-[#2a2a2a]/60">生徒名:</span>{' '}
              <span className="text-[#2a2a2a]">{response.student_name}</span>
            </div>
            <div>
              <span className="text-[#2a2a2a]/60">学年:</span>{' '}
              <span className="text-[#2a2a2a]">
                {response.grade ? GRADE_LABELS[response.grade] : '-'}
              </span>
            </div>
          </div>
        </div>

        {/* エラー表示 */}
        {error && (
          <div className="bg-[#d9376e]/20 text-[#d9376e] px-4 py-2 rounded border border-[#d9376e]">
            {error}
          </div>
        )}

        {/* 生徒選択 */}
        <div>
          <label className="block text-sm font-medium text-[#2a2a2a] mb-2">
            同じ学年の生徒を選択 <span className="text-[#d9376e]">*</span>
          </label>
          {students.length === 0 ? (
            <div className="text-center py-8 text-[#2a2a2a]/60">
              同じ学年の生徒が登録されていません
            </div>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto border border-[#0d0d0d] rounded-lg p-2">
              {students.map((student) => (
                <label
                  key={student.id}
                  className="flex items-center gap-3 p-3 hover:bg-[#eff0f3] rounded cursor-pointer"
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
                    className="w-4 h-4 text-[#ff8e3c] border-[#0d0d0d] focus:ring-[#ff8e3c]"
                  />
                  <div className="flex-1">
                    <div className="text-[#0d0d0d] font-medium">
                      {student.last_name} {student.first_name}
                    </div>
                    <div className="text-sm text-[#2a2a2a]/60">
                      {student.student_code || 'コード未設定'}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* ボタン */}
        <div className="flex justify-end gap-2 pt-4 border-t border-[#0d0d0d]">
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
