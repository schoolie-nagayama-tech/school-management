'use client';

import { useState, useEffect } from 'react';
import { Button, Loading } from '@/components/ui';
import { getFormTemplates, deleteFormTemplate, getFormTemplate } from '@/lib/api/forms';
import type { FormTemplate } from '@/types/database';
import { TemplateEditor } from './TemplateEditor';
import { useConfirm } from '@/hooks/useConfirm';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';

interface TemplateListProps {
  onSelectTemplate: (template: FormTemplate) => void;
  onRefresh: () => void;
}

export function TemplateList({ onSelectTemplate, onRefresh }: TemplateListProps) {
  const [templates, setTemplates] = useState<FormTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { confirm, ConfirmDialog } = useConfirm();

  const fetchTemplates = async () => {
    setIsLoading(true);
    setErrorMessage('');
    try {
      const data = await getFormTemplates();
      setTemplates(data);
    } catch (error) {
      console.error('Error fetching templates:', error);
      setErrorMessage(getUserErrorMessage(error, 'テンプレート一覧の取得に失敗しました'));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTemplates();
  }, []);

  const handleCreate = () => {
    setEditingTemplateId(null);
    setIsEditorOpen(true);
  };

  const handleEdit = (template: FormTemplate) => {
    setEditingTemplateId(template.id);
    setIsEditorOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (
      !(await confirm({
        title: '削除確認',
        description: 'このテンプレートを削除しますか？',
        confirmLabel: '削除',
        variant: 'danger',
      }))
    )
      return;

    setIsSubmitting(true);
    setErrorMessage('');
    try {
      await deleteFormTemplate(id);
      await fetchTemplates();
      onRefresh();
    } catch (error) {
      console.error('Error deleting template:', error);
      setErrorMessage(getUserErrorMessage(error, 'テンプレートの削除に失敗しました'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateForm = async (template: FormTemplate) => {
    try {
      const templateWithFields = await getFormTemplate(template.id);
      if (templateWithFields.fields.length === 0) {
        setErrorMessage('このテンプレートには項目がありません。先に項目を追加してください。');
        return;
      }
      onSelectTemplate(template);
    } catch (error) {
      console.error('Error loading template:', error);
      setErrorMessage('テンプレートの読み込みに失敗しました');
    }
  };

  const handleEditorSuccess = () => {
    fetchTemplates();
    onRefresh();
  };

  if (isLoading) {
    return <Loading size="md" />;
  }

  return (
    <>
      <div className="space-y-4">
        {errorMessage && (
          <div className="bg-[#ef4444]/20 text-[#ef4444] px-4 py-2 rounded border border-[#ef4444]">
            {errorMessage}
          </div>
        )}

        <div className="flex justify-between items-center">
          <h3 className="text-lg font-semibold text-[#1f2937]">テンプレート一覧</h3>
          <Button onClick={handleCreate} disabled={isSubmitting}>
            新規作成
          </Button>
        </div>

        {templates.length === 0 ? (
          <div className="text-center py-8 text-[#4b5563]">
            テンプレートがありません。新規作成ボタンからテンプレートを作成してください。
          </div>
        ) : (
          <div className="space-y-2">
            {templates.map((template) => (
              <div
                key={template.id}
                className="flex items-center justify-between p-4 bg-white rounded-lg border border-[#e5e7eb]"
              >
                <div className="flex-1">
                  <div className="font-medium text-[#1f2937]">{template.name}</div>
                  {template.description && (
                    <div className="text-sm text-[#4b5563]/60 mt-1">{template.description}</div>
                  )}
                  <div className="text-xs text-[#4b5563]/60 mt-1">
                    作成日: {new Date(template.created_at).toLocaleDateString('ja-JP')}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    onClick={() => handleCreateForm(template)}
                    variant="secondary"
                    size="sm"
                    disabled={isSubmitting}
                  >
                    複製してフォーム作成
                  </Button>
                  <Button
                    onClick={() => handleEdit(template)}
                    variant="secondary"
                    size="sm"
                    disabled={isSubmitting}
                  >
                    編集
                  </Button>
                  <Button
                    onClick={() => handleDelete(template.id)}
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
      </div>

      {ConfirmDialog}

      <TemplateEditor
        isOpen={isEditorOpen}
        onClose={() => {
          setIsEditorOpen(false);
          setEditingTemplateId(null);
        }}
        templateId={editingTemplateId}
        onSuccess={handleEditorSuccess}
      />
    </>
  );
}
