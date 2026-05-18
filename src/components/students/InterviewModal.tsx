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
  
  // フォーム状態
  const [interviewDate, setInterviewDate] = useState(
    interview?.interview_date || new Date().toISOString().split('T')[0]
  );
  const [interviewType, setInterviewType] = useState<InterviewType>(
    interview?.interview_type || 'parent_interview'
  );
  const [title, setTitle] = useState(interview?.title || '');
  const [content, setContent] = useState(interview?.content || '');
  const [isSaving, setIsSaving] = useState(false);

  // 編集時は初期値を設定
  useEffect(() => {
    if (interview) {
      setInterviewDate(interview.interview_date);
      setInterviewType(interview.interview_type);
      setTitle(interview.title || '');
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
      minHeight="80vh"
    >
      <div className="flex flex-col h-full max-h-[calc(90vh-120px)]">
        {/* スクロール可能なコンテンツエリア */}
        <div className="flex-1 overflow-y-auto space-y-6 pr-2 -mr-2">
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
            <label className="block text-sm font-medium text-[#1f2937] mb-3">
              種別 <span className="text-[#ef4444]">*</span>
            </label>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {INTERVIEW_TYPES.map((type) => (
                <label
                  key={type}
                  className={`flex items-center justify-center px-3 py-2 rounded-lg border cursor-pointer transition-colors duration-150 ${
                    interviewType === type
                      ? type === 'task'
                        ? 'bg-[#ef4444] text-white border-[#ef4444] font-medium'
                        : 'bg-[#3b82f6] text-white border-[#e5e7eb] font-medium'
                      : 'bg-white text-[#4b5563] border-[#e5e7eb] hover:bg-[#f3f4f6]'
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
                  <span className="text-sm text-center">{INTERVIEW_TYPE_LABELS[type]}</span>
                </label>
              ))}
            </div>
            {interviewType === 'task' && (
              <p className="text-xs text-[#ef4444] mt-2">
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
            <label className="block text-sm font-medium text-[#1f2937] mb-3">
              内容 <span className="text-[#ef4444]">*</span>
            </label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="面談・電話の内容を記録してください"
              rows={12}
              disabled={isSaving}
              className="w-full px-4 py-3 border border-[#e5e7eb] rounded-lg text-sm bg-white text-[#4b5563] focus:outline-none focus:ring-2 focus:ring-[#3b82f6] disabled:bg-[#f3f4f6] disabled:cursor-not-allowed resize-y min-h-[200px]"
              required
            />
            <p className="text-xs text-[#4b5563]/60 mt-2">
              ※ テキストエリアの右下をドラッグしてサイズを調整できます
            </p>
          </div>
        </div>

        {/* 固定フッター（ボタン） */}
        <div className="flex justify-end gap-3 pt-6 border-t border-[#e5e7eb] mt-6 shrink-0">
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
