'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui';
import { getForms, deleteForm, updateFormStatus } from '@/lib/api/forms';
import type { Form, FormStatus } from '@/types/database';
import { FORM_STATUS_LABELS } from '@/types/database';
import { FormLinkModal } from './FormLinkModal';

interface FormListProps {
  onEditForm: (form: Form) => void;
  onViewResponses: (form: Form) => void;
  onRefresh: () => void;
}

export function FormList({ onEditForm, onViewResponses: _onViewResponses, onRefresh }: FormListProps) {
  const router = useRouter();
  const [forms, setForms] = useState<Form[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);
  const [selectedFormForLink, setSelectedFormForLink] = useState<Form | null>(null);

  const fetchForms = async () => {
    setIsLoading(true);
    setErrorMessage('');
    try {
      const data = await getForms();
      setForms(data);
    } catch (error) {
      console.error('Error fetching forms:', error);
      setErrorMessage(
        error instanceof Error ? error.message : 'フォーム一覧の取得に失敗しました'
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchForms();
  }, []);

  const handleDelete = async (id: string) => {
    if (!confirm('このフォームを削除しますか？回答データも削除されます。')) return;

    setIsSubmitting(true);
    setErrorMessage('');
    try {
      await deleteForm(id);
      await fetchForms();
      onRefresh();
    } catch (error) {
      console.error('Error deleting form:', error);
      setErrorMessage(
        error instanceof Error ? error.message : 'フォームの削除に失敗しました'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStatusChange = async (id: string, status: FormStatus) => {
    setIsSubmitting(true);
    setErrorMessage('');
    try {
      await updateFormStatus(id, status);
      await fetchForms();
      onRefresh();
    } catch (error) {
      console.error('Error updating form status:', error);
      setErrorMessage(
        error instanceof Error ? error.message : '状態の更新に失敗しました'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const getStatusBadgeClass = (status: FormStatus) => {
    switch (status) {
      case 'draft':
        return 'bg-[#eff0f3] text-[#2a2a2a]';
      case 'published':
        return 'bg-[#ff8e3c]/20 text-[#0d0d0d]';
      case 'closed':
        return 'bg-[#eff0f3] text-[#2a2a2a]/60';
      default:
        return 'bg-[#eff0f3] text-[#2a2a2a]';
    }
  };

  if (isLoading) {
    return (
      <div className="text-center py-8 text-[#2a2a2a]">読み込み中...</div>
    );
  }

  return (
    <div className="space-y-4">
      {errorMessage && (
        <div className="bg-[#d9376e]/20 text-[#d9376e] px-4 py-2 rounded border border-[#d9376e]">
          {errorMessage}
        </div>
      )}

      {forms.length === 0 ? (
        <div className="text-center py-8 text-[#2a2a2a]">
          フォームがありません。テンプレートから作成するか、新規作成してください。
        </div>
      ) : (
        <div className="space-y-2">
          {forms.map((form) => (
            <div
              key={form.id}
              className="flex items-center justify-between p-4 bg-[#fffffe] rounded-lg border border-[#0d0d0d]"
            >
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-[#0d0d0d]">{form.title}</span>
                  <span
                    className={`px-2 py-1 text-xs rounded ${getStatusBadgeClass(form.status)}`}
                  >
                    {FORM_STATUS_LABELS[form.status]}
                  </span>
                </div>
                {form.description && (
                  <div className="text-sm text-[#2a2a2a]/60 mb-1">
                    {form.description}
                  </div>
                )}
                <div className="text-xs text-[#2a2a2a]/60">
                  {form.publish_start && form.publish_end
                    ? `公開期間: ${new Date(form.publish_start).toLocaleDateString('ja-JP')} ～ ${new Date(form.publish_end).toLocaleDateString('ja-JP')}`
                    : form.publish_start
                    ? `公開開始: ${new Date(form.publish_start).toLocaleDateString('ja-JP')}`
                    : '公開期間未設定'}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  onClick={() => onEditForm(form)}
                  variant="secondary"
                  size="sm"
                  disabled={isSubmitting}
                >
                  編集
                </Button>
                <Button
                  onClick={() => router.push(`/forms/responses/${form.id}`)}
                  variant="secondary"
                  size="sm"
                  disabled={isSubmitting}
                >
                  回答一覧
                </Button>
                <Button
                  onClick={() => {
                    setSelectedFormForLink(form);
                    setIsLinkModalOpen(true);
                  }}
                  variant="secondary"
                  size="sm"
                  disabled={isSubmitting}
                >
                  リンク取得
                </Button>
                <Button
                  onClick={() => router.push(`/forms/preview/${form.id}`)}
                  variant="secondary"
                  size="sm"
                  disabled={isSubmitting}
                >
                  確認
                </Button>
                {form.status === 'draft' && (
                  <Button
                    onClick={() => handleStatusChange(form.id, 'published')}
                    size="sm"
                    disabled={isSubmitting}
                  >
                    公開
                  </Button>
                )}
                {form.status === 'published' && (
                  <Button
                    onClick={() => handleStatusChange(form.id, 'closed')}
                    variant="secondary"
                    size="sm"
                    disabled={isSubmitting}
                  >
                    終了
                  </Button>
                )}
                <Button
                  onClick={() => handleDelete(form.id)}
                  variant="danger"
                  size="sm"
                  disabled={isSubmitting}
                >
                  削除
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <FormLinkModal
        isOpen={isLinkModalOpen}
        onClose={() => {
          setIsLinkModalOpen(false);
          setSelectedFormForLink(null);
        }}
        form={selectedFormForLink}
      />
    </div>
  );
}
