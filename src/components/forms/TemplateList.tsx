'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui';
import {
  getFormTemplates,
  deleteFormTemplate,
  getFormTemplate,
} from '@/lib/api/forms';
import type { FormTemplate } from '@/types/database';
import { TemplateEditor } from './TemplateEditor';

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

  const fetchTemplates = async () => {
    setIsLoading(true);
    setErrorMessage('');
    try {
      const data = await getFormTemplates();
      setTemplates(data);
    } catch (error) {
      console.error('Error fetching templates:', error);
      setErrorMessage(
        error instanceof Error ? error.message : 'テンプレート一覧の取得に失敗しました'
      );
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
    if (!confirm('このテンプレートを削除しますか？')) return;

    setIsSubmitting(true);
    setErrorMessage('');
    try {
      await deleteFormTemplate(id);
      await fetchTemplates();
      onRefresh();
    } catch (error) {
      console.error('Error deleting template:', error);
      setErrorMessage(
        error instanceof Error ? error.message : 'テンプレートの削除に失敗しました'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateForm = async (template: FormTemplate) => {
    try {
      const templateWithFields = await getFormTemplate(template.id);
      if (templateWithFields.fields.length === 0) {
        alert('このテンプレートには項目がありません。先に項目を追加してください。');
        return;
      }
      onSelectTemplate(template);
    } catch (error) {
      console.error('Error loading template:', error);
      alert('テンプレートの読み込みに失敗しました');
    }
  };

  const handleEditorSuccess = () => {
    fetchTemplates();
    onRefresh();
  };

  if (isLoading) {
    return (
      <div className="text-center py-8 text-[#2a2a2a]">読み込み中...</div>
    );
  }

  return (
    <>
      <div className="space-y-4">
        {errorMessage && (
          <div className="bg-[#d9376e]/20 text-[#d9376e] px-4 py-2 rounded border border-[#d9376e]">
            {errorMessage}
          </div>
        )}

        <div className="flex justify-between items-center">
          <h3 className="text-lg font-semibold text-[#0d0d0d]">テンプレート一覧</h3>
          <Button onClick={handleCreate} disabled={isSubmitting}>
            新規作成
          </Button>
        </div>

        {templates.length === 0 ? (
          <div className="text-center py-8 text-[#2a2a2a]">
            テンプレートがありません。新規作成ボタンからテンプレートを作成してください。
          </div>
        ) : (
          <div className="space-y-2">
            {templates.map((template) => (
              <div
                key={template.id}
                className="flex items-center justify-between p-4 bg-[#fffffe] rounded-lg border border-[#0d0d0d]"
              >
                <div className="flex-1">
                  <div className="font-medium text-[#0d0d0d]">{template.name}</div>
                  {template.description && (
                    <div className="text-sm text-[#2a2a2a]/60 mt-1">
                      {template.description}
                    </div>
                  )}
                  <div className="text-xs text-[#2a2a2a]/60 mt-1">
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
