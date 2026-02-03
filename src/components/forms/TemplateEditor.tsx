'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button, Input, Modal } from '@/components/ui';
import {
  getFormTemplate,
  createFormTemplate,
  updateFormTemplate,
  createFormTemplateField,
  updateFormTemplateField,
  deleteFormTemplateField,
  reorderFormTemplateFields,
} from '@/lib/api/forms';
import { FieldEditor } from './FieldEditor';
import type {
  FormTemplateWithFields,
  FormTemplateField,
  FormFieldType,
} from '@/types/database';
import { FORM_FIELD_TYPE_LABELS } from '@/types/database';

interface TemplateEditorProps {
  isOpen: boolean;
  onClose: () => void;
  templateId?: string | null;
  onSuccess: () => void;
}

export function TemplateEditor({
  isOpen,
  onClose,
  templateId,
  onSuccess,
}: TemplateEditorProps) {
  const [template, setTemplate] = useState<FormTemplateWithFields | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [fields, setFields] = useState<FormTemplateField[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [isFieldEditorOpen, setIsFieldEditorOpen] = useState(false);
  const [editingField, setEditingField] = useState<FormTemplateField | null>(null);

  useEffect(() => {
    if (isOpen) {
      if (templateId) {
        loadTemplate();
      } else {
        // 新規作成
        setName('');
        setDescription('');
        setFields([]);
        setTemplate(null);
      }
    }
  }, [isOpen, templateId, loadTemplate]);

  const loadTemplate = useCallback(async () => {
    if (!templateId) return;
    setIsLoading(true);
    setErrorMessage('');
    try {
      const data = await getFormTemplate(templateId);
      setTemplate(data);
      setName(data.name);
      setDescription(data.description || '');
      setFields(data.fields);
    } catch (error) {
      console.error('Error loading template:', error);
      setErrorMessage(
        error instanceof Error ? error.message : 'テンプレートの読み込みに失敗しました'
      );
    } finally {
      setIsLoading(false);
    }
  }, [templateId]);

  useEffect(() => {
    if (isOpen) {
      if (templateId) {
        loadTemplate();
      } else {
        // 新規作成
        setName('');
        setDescription('');
        setFields([]);
        setTemplate(null);
      }
    }
  }, [isOpen, templateId, loadTemplate]);

  const handleSave = async () => {
    if (!name.trim()) {
      alert('テンプレート名を入力してください');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage('');
    try {
      if (templateId) {
        await updateFormTemplate(templateId, {
          name: name.trim(),
          description: description.trim() || null,
        });
      } else {
        const newTemplate = await createFormTemplate({
          name: name.trim(),
          description: description.trim() || null,
        });
        setTemplate(newTemplate);
        // 新規作成後は編集モードに
        if (newTemplate.id) {
          // リロードしてフィールドも取得
          await loadTemplate();
        }
      }
      onSuccess();
      onClose();
    } catch (error) {
      console.error('Error saving template:', error);
      setErrorMessage(
        error instanceof Error ? error.message : 'テンプレートの保存に失敗しました'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddField = () => {
    setEditingField(null);
    setIsFieldEditorOpen(true);
  };

  const handleEditField = (field: FormTemplateField) => {
    setEditingField(field);
    setIsFieldEditorOpen(true);
  };

  const handleSaveField = async (fieldData: {
    field_type: FormFieldType;
    label: string;
    placeholder?: string;
    options?: string[];
    is_required: boolean;
  }) => {
    if (!template?.id) {
      alert('先にテンプレートを保存してください');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage('');
    try {
      if (editingField) {
        await updateFormTemplateField(editingField.id, {
          ...fieldData,
          options: fieldData.options || null,
        });
      } else {
        await createFormTemplateField({
          template_id: template.id,
          ...fieldData,
          options: fieldData.options || null,
        });
      }
      await loadTemplate();
      setIsFieldEditorOpen(false);
      setEditingField(null);
    } catch (error) {
      console.error('Error saving field:', error);
      setErrorMessage(
        error instanceof Error ? error.message : '項目の保存に失敗しました'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteField = async (id: string) => {
    if (!confirm('この項目を削除しますか？')) return;

    setIsSubmitting(true);
    setErrorMessage('');
    try {
      await deleteFormTemplateField(id);
      await loadTemplate();
    } catch (error) {
      console.error('Error deleting field:', error);
      setErrorMessage(
        error instanceof Error ? error.message : '項目の削除に失敗しました'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleMoveField = async (field: FormTemplateField, direction: 'up' | 'down') => {
    const index = fields.findIndex((f) => f.id === field.id);
    if (direction === 'up' && index <= 0) return;
    if (direction === 'down' && index >= fields.length - 1) return;

    const newFields = [...fields];
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    [newFields[index], newFields[swapIndex]] = [newFields[swapIndex], newFields[index]];

    setIsSubmitting(true);
    setErrorMessage('');
    try {
      await reorderFormTemplateFields(
        template!.id,
        newFields.map((f) => f.id)
      );
      await loadTemplate();
    } catch (error) {
      console.error('Error reordering fields:', error);
      setErrorMessage(
        error instanceof Error ? error.message : '並び順の更新に失敗しました'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={templateId ? 'テンプレートを編集' : 'テンプレートを新規作成'}
      >
        <div className="space-y-4">
          {errorMessage && (
            <div className="bg-[#ef4444]/20 text-[#ef4444] px-4 py-2 rounded border border-[#ef4444]">
              {errorMessage}
            </div>
          )}

          {isLoading ? (
            <div className="text-center py-8 text-[#4b5563]">読み込み中...</div>
          ) : (
            <>
              <div>
                <label className="block text-sm font-medium text-[#4b5563] mb-2">
                  テンプレート名 <span className="text-[#ef4444]">*</span>
                </label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例: Vもぎ申込"
                  disabled={isSubmitting}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[#4b5563] mb-2">
                  説明文
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="テンプレートの説明を入力（任意）"
                  rows={3}
                  disabled={isSubmitting}
                  className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm bg-white text-[#4b5563] focus:ring-2 focus:ring-[#3b82f6] focus:border-[#3b82f6] disabled:opacity-50"
                />
              </div>

              {template && (
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="block text-sm font-medium text-[#4b5563]">
                      項目一覧
                    </label>
                    <Button onClick={handleAddField} size="sm" disabled={isSubmitting}>
                      項目を追加
                    </Button>
                  </div>

                  {fields.length === 0 ? (
                    <div className="text-center py-4 text-[#4b5563]/60 text-sm">
                      項目がありません。項目を追加してください。
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {fields.map((field, index) => (
                        <div
                          key={field.id}
                          className="flex items-center gap-2 p-3 bg-[#f3f4f6] rounded border border-[#e5e7eb]"
                        >
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-[#4b5563]/60">
                                {FORM_FIELD_TYPE_LABELS[field.field_type]}
                              </span>
                              <span className="text-[#4b5563] font-medium">
                                {field.label}
                              </span>
                              {field.is_required && (
                                <span className="text-xs text-[#ef4444]">必須</span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleMoveField(field, 'up')}
                              disabled={index === 0 || isSubmitting}
                              className="p-1.5 text-[#4b5563] hover:text-[#1f2937] disabled:opacity-50"
                              title="上に移動"
                            >
                              ↑
                            </button>
                            <button
                              onClick={() => handleMoveField(field, 'down')}
                              disabled={index === fields.length - 1 || isSubmitting}
                              className="p-1.5 text-[#4b5563] hover:text-[#1f2937] disabled:opacity-50"
                              title="下に移動"
                            >
                              ↓
                            </button>
                            <button
                              onClick={() => handleEditField(field)}
                              disabled={isSubmitting}
                              className="p-1.5 text-[#4b5563] hover:text-[#3b82f6] disabled:opacity-50"
                              title="編集"
                            >
                              ✏️
                            </button>
                            <button
                              onClick={() => handleDeleteField(field.id)}
                              disabled={isSubmitting}
                              className="p-1.5 text-[#4b5563] hover:text-[#ef4444] disabled:opacity-50"
                              title="削除"
                            >
                              🗑️
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-4 border-t border-[#e5e7eb]">
                <Button onClick={onClose} variant="secondary" disabled={isSubmitting}>
                  キャンセル
                </Button>
                <Button onClick={handleSave} disabled={isSubmitting || !name.trim()}>
                  保存
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>

      <FieldEditor
        isOpen={isFieldEditorOpen}
        onClose={() => {
          setIsFieldEditorOpen(false);
          setEditingField(null);
        }}
        onSave={handleSaveField}
        field={editingField}
      />
    </>
  );
}
