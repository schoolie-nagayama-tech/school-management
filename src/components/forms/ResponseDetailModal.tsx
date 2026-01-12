'use client';

import { useState, useEffect } from 'react';
import { Modal } from '@/components/ui';
import { getFormResponse, getForm } from '@/lib/api/forms';
import type { FormResponse, FormWithFields, FormField } from '@/types/database';
import { GRADE_LABELS } from '@/types/database';

interface ResponseDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  response: FormResponse | null;
  formId: string;
}

export function ResponseDetailModal({
  isOpen,
  onClose,
  response,
  formId,
}: ResponseDetailModalProps) {
  const [form, setForm] = useState<FormWithFields | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isOpen && formId) {
      loadForm();
    }
  }, [isOpen, formId]);

  const loadForm = async () => {
    setIsLoading(true);
    try {
      const data = await getForm(formId);
      setForm(data);
    } catch (error) {
      console.error('Error loading form:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (!response) return null;

  const answers = (response.answers as Record<string, unknown>) || {};
  const formatDateTime = (dateString: string) => {
    const date = new Date(dateString);
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
  };

  const getFieldLabel = (fieldId: string): string => {
    if (!form) return fieldId;
    const field = form.fields.find((f) => f.id === fieldId);
    return field?.label || fieldId;
  };

  const formatAnswer = (field: FormField | undefined, value: unknown): string => {
    if (value === null || value === undefined) return '-';
    if (Array.isArray(value)) return value.join(', ');
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="回答詳細">
      <div className="space-y-4">
        {isLoading ? (
          <div className="text-center py-8 text-[#2a2a2a]">読み込み中...</div>
        ) : (
          <>
            {/* 基本情報 */}
            <div className="bg-[#eff0f3] p-4 rounded-lg border border-[#0d0d0d]">
              <h3 className="font-semibold text-[#0d0d0d] mb-3">基本情報</h3>
              <div className="space-y-2 text-sm">
                <div>
                  <span className="text-[#2a2a2a]/60">回答日時:</span>{' '}
                  <span className="text-[#2a2a2a]">{formatDateTime(response.created_at)}</span>
                </div>
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
                <div>
                  <span className="text-[#2a2a2a]/60">メールアドレス:</span>{' '}
                  <span className="text-[#2a2a2a]">{response.email || '-'}</span>
                </div>
                {response.linked_student_id && (
                  <div>
                    <span className="text-[#2a2a2a]/60">紐付け状態:</span>{' '}
                    <span className="text-[#2a2a2a]">紐付け済み</span>
                    {response.linked_at && (
                      <span className="text-[#2a2a2a]/60 ml-2">
                        ({formatDateTime(response.linked_at)})
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* 回答内容 */}
            {form && form.fields.length > 0 && (
              <div>
                <h3 className="font-semibold text-[#0d0d0d] mb-3">回答内容</h3>
                <div className="space-y-3">
                  {form.fields.map((field) => {
                    const value = answers[field.id];
                    return (
                      <div
                        key={field.id}
                        className="bg-[#fffffe] p-3 rounded border border-[#0d0d0d]"
                      >
                        <div className="text-sm font-medium text-[#2a2a2a] mb-1">
                          {field.label}
                        </div>
                        <div className="text-[#2a2a2a]">
                          {formatAnswer(field, value)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex justify-end pt-4 border-t border-[#0d0d0d]">
              <button
                onClick={onClose}
                className="px-4 py-2 bg-[#eff0f3] text-[#2a2a2a] rounded-lg hover:bg-[#fffffe] transition-colors"
              >
                閉じる
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
