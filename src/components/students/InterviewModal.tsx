'use client';

import { useState, useEffect } from 'react';
import { StudentInterview, InterviewType, INTERVIEW_TYPE_LABELS } from '@/types/database';
import { createInterview, updateInterview } from '@/lib/api/interviews';
import { Modal, Button, Input } from '@/components/ui';
import { useToast } from '@/hooks/useToast';

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
  
  // フォーム状態
  const [interviewDate, setInterviewDate] = useState(
    interview?.interview_date || new Date().toISOString().split('T')[0]
  );
  const [interviewType, setInterviewType] = useState<InterviewType>(
    interview?.interview_type || 'parent_interview'
  );
  const [content, setContent] = useState(interview?.content || '');
  const [isSaving, setIsSaving] = useState(false);

  // 編集時は初期値を設定
  useEffect(() => {
    if (interview) {
      setInterviewDate(interview.interview_date);
      setInterviewType(interview.interview_type);
      setContent(interview.content);
    }
  }, [interview]);

  // 保存処理
  const handleSave = async () => {
    // バリデーション
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
        error instanceof Error ? error.message : '保存に失敗しました'
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
      size="md"
    >
      <div className="space-y-4">
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
          <label className="block text-sm font-medium text-[#0d0d0d] mb-2">
            種別 <span className="text-[#d9376e]">*</span>
          </label>
          <div className="grid grid-cols-3 gap-2">
            {INTERVIEW_TYPES.map((type) => (
              <label
                key={type}
                className={`flex items-center justify-center px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                  interviewType === type
                    ? type === 'task'
                      ? 'bg-[#d9376e] text-white border-[#d9376e] font-medium'
                      : 'bg-[#ff8e3c] text-[#0d0d0d] border-[#0d0d0d] font-medium'
                    : 'bg-[#fffffe] text-[#2a2a2a] border-[#0d0d0d] hover:bg-[#eff0f3]'
                }`}
              >
                <input
                  type="radio"
                  name="interviewType"
                  value={type}
                  checked={interviewType === type}
                  onChange={(e) => setInterviewType(e.target.value as InterviewType)}
                  className="sr-only"
                  disabled={isSaving}
                />
                <span className="text-xs text-center">{INTERVIEW_TYPE_LABELS[type]}</span>
              </label>
            ))}
          </div>
          {interviewType === 'task' && (
            <p className="text-xs text-[#d9376e] mt-2">
              ※ タスクは生徒一覧画面のトップにアラート表示されます
            </p>
          )}
        </div>

        {/* 内容 */}
        <div>
          <label className="block text-sm font-medium text-[#0d0d0d] mb-2">
            内容 <span className="text-[#d9376e]">*</span>
          </label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="面談・電話の内容を記録してください"
            rows={8}
            disabled={isSaving}
            className="w-full px-3 py-2 border border-[#0d0d0d] rounded-lg text-sm bg-[#fffffe] text-[#2a2a2a] focus:outline-none focus:ring-2 focus:ring-[#ff8e3c] disabled:bg-[#eff0f3] disabled:cursor-not-allowed resize-none"
            required
          />
        </div>

        {/* ボタン */}
        <div className="flex justify-end gap-3 pt-4 border-t border-[#0d0d0d]">
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
