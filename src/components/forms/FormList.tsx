'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui';
import { getForms, deleteForm, updateFormStatus, archiveForm, unarchiveForm } from '@/lib/api/forms';
import type { Form, FormStatus } from '@/types/database';
import { FORM_STATUS_LABELS } from '@/types/database';
import { FormLinkModal } from './FormLinkModal';
import { useConfirm } from '@/hooks/useConfirm';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';

interface FormListProps {
  onEditForm: (form: Form) => void;
  onViewResponses: (form: Form) => void;
  onRefresh: () => void;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function FormList({ onEditForm, onViewResponses: _onViewResponses, onRefresh }: FormListProps) {
  const router = useRouter();
  const { confirm, ConfirmDialog } = useConfirm();
  const [forms, setForms] = useState<Form[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);
  const [selectedFormForLink, setSelectedFormForLink] = useState<Form | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const fetchForms = async () => {
    setIsLoading(true);
    setErrorMessage('');
    try {
      const data = await getForms(undefined, showArchived);
      setForms(data);
    } catch (error) {
      console.error('Error fetching forms:', error);
      setErrorMessage(
        getUserErrorMessage(error, 'フォーム一覧の取得に失敗しました')
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchForms();
  }, [showArchived]);

  const handleDelete = async (id: string) => {
    if (!(await confirm({ title: '削除確認', description: 'このフォームを削除しますか？回答データも削除されます。', confirmLabel: '削除', variant: 'danger' }))) return;

    setIsSubmitting(true);
    setErrorMessage('');
    try {
      await deleteForm(id);
      await fetchForms();
      onRefresh();
    } catch (error) {
      console.error('Error deleting form:', error);
      setErrorMessage(
        getUserErrorMessage(error, 'フォームの削除に失敗しました')
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
        getUserErrorMessage(error, '状態の更新に失敗しました')
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleArchive = async (id: string) => {
    if (!(await confirm({ title: 'アーカイブ確認', description: 'このフォームをアーカイブしますか？このフォームから申し込んだ回答も自動でアーカイブされます。', confirmLabel: 'アーカイブ', variant: 'warning' }))) return;

    setIsSubmitting(true);
    setErrorMessage('');
    setSuccessMessage('');
    try {
      const result = await archiveForm(id);
      await fetchForms();
      onRefresh();
      setSuccessMessage(`アーカイブしました（回答${result.responsesArchived}件を含む）`);
    } catch (error) {
      console.error('Error archiving form:', error);
      setErrorMessage(
        getUserErrorMessage(error, 'フォームのアーカイブに失敗しました')
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUnarchive = async (id: string) => {
    setIsSubmitting(true);
    setErrorMessage('');
    setSuccessMessage('');
    try {
      const result = await unarchiveForm(id);
      await fetchForms();
      onRefresh();
      setSuccessMessage(`アーカイブを解除しました（回答${result.responsesUnarchived}件を含む）`);
    } catch (error) {
      console.error('Error unarchiving form:', error);
      setErrorMessage(
        getUserErrorMessage(error, 'フォームのアーカイブ解除に失敗しました')
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const getStatusBadgeClass = (status: FormStatus) => {
    switch (status) {
      case 'draft':
        return 'bg-[#f3f4f6] text-[#4b5563]';
      case 'published':
        return 'bg-[#3b82f6]/20 text-[#1f2937]';
      case 'closed':
        return 'bg-[#f3f4f6] text-[#4b5563]/60';
      default:
        return 'bg-[#f3f4f6] text-[#4b5563]';
    }
  };

  if (isLoading) {
    return (
      <div className="text-center py-8 text-[#4b5563]">読み込み中...</div>
    );
  }

  return (
    <div className="space-y-4">
      {errorMessage && (
        <div className="bg-[#ef4444]/20 text-[#ef4444] px-4 py-2 rounded border border-[#ef4444] text-sm">
          {errorMessage}
        </div>
      )}
      {successMessage && (
        <div className="bg-[#22c55e]/20 text-[#15803d] px-4 py-2 rounded border border-[#22c55e] text-sm">
          {successMessage}
        </div>
      )}

      {/* アーカイブ表示切り替え */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => setShowArchived(!showArchived)}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors duration-150 ${
            showArchived
              ? 'bg-[#3b82f6]/20 text-[#1f2937]'
              : 'bg-[#f3f4f6] text-[#4b5563] hover:bg-white'
          }`}
        >
          {showArchived ? 'アーカイブ済みを非表示' : 'アーカイブ済みを表示'}
        </button>
      </div>

      {forms.length === 0 ? (
        <div className="text-center py-8 text-[#4b5563]">
          フォームがありません。テンプレートから作成するか、新規作成してください。
        </div>
      ) : (
        <div className="space-y-2">
          {forms.map((form) => (
            <div
              key={form.id}
              className={`flex items-center justify-between p-4 rounded-lg border ${
                form.is_archived
                  ? 'bg-[#f3f4f6] border-[#e5e7eb]/30 opacity-60'
                  : 'bg-white border-[#e5e7eb]'
              }`}
            >
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-[#1f2937]">{form.title}</span>
                  <span
                    className={`px-2 py-1 text-xs rounded ${getStatusBadgeClass(form.status)}`}
                  >
                    {FORM_STATUS_LABELS[form.status]}
                  </span>
                </div>
                {form.description && (
                  <div className="text-sm text-[#4b5563]/60 mb-1">
                    {form.description}
                  </div>
                )}
                <div className="text-xs text-[#4b5563]/60">
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
                  onClick={() => window.open(`/forms/preview/${form.id}`, '_blank')}
                  variant="secondary"
                  size="sm"
                  disabled={isSubmitting}
                >
                  プレビュー
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
                  <>
                    <Button
                      onClick={() => handleStatusChange(form.id, 'draft')}
                      variant="secondary"
                      size="sm"
                      disabled={isSubmitting}
                    >
                      非公開
                    </Button>
                    <Button
                      onClick={() => handleStatusChange(form.id, 'closed')}
                      variant="secondary"
                      size="sm"
                      disabled={isSubmitting}
                    >
                      終了
                    </Button>
                  </>
                )}
                {form.status === 'closed' && (
                  <Button
                    onClick={() => handleStatusChange(form.id, 'draft')}
                    variant="secondary"
                    size="sm"
                    disabled={isSubmitting}
                  >
                    非公開に戻す
                  </Button>
                )}
                {form.is_archived ? (
                  <Button
                    onClick={() => handleUnarchive(form.id)}
                    variant="secondary"
                    size="sm"
                    disabled={isSubmitting}
                    title="アーカイブを解除して元に戻す"
                  >
                    元に戻す
                  </Button>
                ) : (
                  <Button
                    onClick={() => handleArchive(form.id)}
                    variant="secondary"
                    size="sm"
                    disabled={isSubmitting}
                  >
                    アーカイブ
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

      {ConfirmDialog}

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
