'use client';

import { useState, useEffect } from 'react';
import { StudentInterview, InterviewType, INTERVIEW_TYPE_LABELS } from '@/types/database';
import { createInterview, updateInterview } from '@/lib/api/interviews';
import { Modal, Button, Input } from '@/components/ui';
import { useToast } from '@/hooks/useToast';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';

interface InterviewModalProps {
  studentId: string;
  schoolId: string;
  interview: StudentInterview | null;  // nullなら新規作成
  onClose: () => void;
  onSaved: () => void;
}

const INTERVIEW_TYPES: InterviewType[] = [
  'parent_interview',
  'phone',
  'student_interview',
  'casual',
  'enrollment',
  'task',
  'other',
];

export function InterviewModal({ studentId, schoolId, interview, onClose, onSaved }: InterviewModalProps) {
  const isEditing = !!interview;
  const { success, error: toastError } = useToast();

  const [interviewDate, setInterviewDate] = useState(
    interview?.interview_date || new Date().toISOString().split('T')[0]
  );
  const [interviewType, setInterviewType] = useState<InterviewType>(
    interview?.interview_type || 'parent_interview'
  );
  const [title, setTitle] = useState(interview?.title || '');
  const [content, setContent] = useState(interview?.content || '');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (interview) {
      setInterviewDate(interview.interview_date);
      setInterviewType(interview.interview_type);
      setTitle(interview.title || '');
      setContent(interview.content);
    }
  }, [interview]);

  const handleSave = async () => {
    if (!interviewDate) {
      toastError('日付を入力してください');
      return;
    }
    if (!content.trim()) {
      toastError('内容を入力してください');
      return;
    }

    setIsSaving(true);
    try {
      const input = {
        interview_date: interviewDate,
        interview_type: interviewType,
        title: title.trim() || null,
        content: content.trim(),
      };

      if (isEditing) {
        await updateInterview(interview.id, input);
        success('更新しました');
      } else {
        await createInterview(schoolId, studentId, input);
        success('記録を追加しました');
      }
      onSaved();
    } catch (error) {
      console.error('Failed to save:', error);
      toastError(
        getUserErrorMessage(error, '保存に失敗しました')
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={isEditing ? '面談記録を編集' : '面談記録を追加'}
      size="lg"
    >
      <div className="space-y-5">
        {/* 日付 */}
        <Input
          label="日付"
          type="date"
          value={interviewDate}
          onChange={(e) => setInterviewDate(e.target.value)}
          required
          disabled={isSaving}
        />

        {/* 種別 */}
        <div>
          <label className="block text-sm font-medium text-text-heading mb-2">
            種別 <span className="text-danger">*</span>
          </label>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {INTERVIEW_TYPES.map((type) => {
              const isSelected = interviewType === type;
              const isTask = type === 'task';
              return (
                <label
                  key={type}
                  className={`flex items-center justify-center px-3 py-2 rounded-lg border text-sm cursor-pointer transition-colors duration-150 ${
                    isSelected
                      ? isTask
                        ? 'bg-danger text-white border-danger font-medium'
                        : 'bg-primary text-white border-primary font-medium'
                      : 'bg-surface-raised text-text-body border-border hover:bg-surface-hover'
                  }`}
                >
                  <input
                    type="radio"
                    name="interviewType"
                    value={type}
                    checked={isSelected}
                    onChange={(e) => setInterviewType(e.target.value as InterviewType)}
                    className="sr-only"
                    disabled={isSaving}
                  />
                  <span className="text-center">{INTERVIEW_TYPE_LABELS[type]}</span>
                </label>
              );
            })}
          </div>
          {interviewType === 'task' && (
            <p className="text-xs text-danger mt-2">
              ※ タスクは生徒一覧画面のトップにアラート表示されます
            </p>
          )}
        </div>

        {/* タイトル */}
        <Input
          label="タイトル"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="例: 山田太郎 保護者面談"
          disabled={isSaving}
        />

        {/* 内容 */}
        <div>
          <label className="block text-sm font-medium text-text-heading mb-1">
            内容 <span className="text-danger">*</span>
          </label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="面談・電話の内容を記録してください"
            rows={10}
            disabled={isSaving}
            className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface-raised text-text-body placeholder-text-faint focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary disabled:bg-surface disabled:text-text-faint disabled:cursor-not-allowed resize-y min-h-[180px] transition-colors duration-150"
            required
          />
        </div>

        {/* フッターボタン */}
        <div className="flex justify-end gap-3 pt-4 border-t border-border">
          <Button variant="secondary" onClick={onClose} disabled={isSaving}>
            キャンセル
          </Button>
          <Button onClick={handleSave} isLoading={isSaving} disabled={isSaving}>
            {isSaving ? '保存中...' : '保存'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
