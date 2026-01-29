'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button, Input, Modal, Select } from '@/components/ui';
import {
  getForm,
  createFormFromTemplate,
  createForm,
  updateForm,
  createFormField,
  updateFormField,
  deleteFormField,
  reorderFormFields,
  archiveForm,
  unarchiveForm,
} from '@/lib/api/forms';
import { getApplicationItems } from '@/lib/api/applications';
import { FieldEditor } from './FieldEditor';
import type {
  Form,
  FormWithFields,
  FormField,
  FormFieldType,
  FormTemplate,
  ApplicationItem,
} from '@/types/database';
import { FORM_FIELD_TYPE_LABELS, FORM_STATUS_LABELS } from '@/types/database';

interface FormEditorProps {
  isOpen: boolean;
  onClose: () => void;
  formId?: string | null;
  template?: FormTemplate | null;
  onSuccess: () => void;
}

export function FormEditor({
  isOpen,
  onClose,
  formId,
  template,
  onSuccess,
}: FormEditorProps) {
  const [form, setForm] = useState<FormWithFields | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [slug, setSlug] = useState('');
  const [status, setStatus] = useState<'draft' | 'published' | 'closed'>('draft');
  const [publishStart, setPublishStart] = useState('');
  const [publishEnd, setPublishEnd] = useState('');
  const [completionMessage, setCompletionMessage] = useState('');
  const [linkedApplicationItemId, setLinkedApplicationItemId] = useState<string>('');
  const [fields, setFields] = useState<FormField[]>([]);
  const [applicationItems, setApplicationItems] = useState<ApplicationItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [isFieldEditorOpen, setIsFieldEditorOpen] = useState(false);
  const [editingField, setEditingField] = useState<FormField | null>(null);
  const [isArchiving, setIsArchiving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadApplicationItems();
      if (formId) {
        loadForm();
      } else if (template) {
        // テンプレートから作成
        setTitle(`${template.name}（${new Date().toLocaleDateString('ja-JP')}）`);
        setSlug(
          template.name
            .toLowerCase()
            .replace(/\s+/g, '-')
            .replace(/[^a-z0-9-]/g, '') +
            '-' +
            new Date().toISOString().split('T')[0].replace(/-/g, '')
        );
        setDescription(template.description || '');
        setFields([]);
        setForm(null);
      } else {
        // 新規作成
        setTitle('');
        setDescription('');
        setSlug('');
        setStatus('draft');
        setPublishStart('');
        setPublishEnd('');
        setCompletionMessage('');
        setLinkedApplicationItemId('');
        setFields([]);
        setForm(null);
      }
    }
  }, [isOpen, formId, template, loadApplicationItems, loadForm]);

  const loadApplicationItems = useCallback(async () => {
    try {
      const items = await getApplicationItems();
      setApplicationItems(items);
    } catch (error) {
      console.error('Error loading application items:', error);
    }
  }, []);

  const loadForm = useCallback(async () => {
    if (!formId) return;
    setIsLoading(true);
    setErrorMessage('');
    try {
      const data = await getForm(formId);
      setForm(data);
      setTitle(data.title);
      setDescription(data.description || '');
      setSlug(data.slug);
      setStatus(data.status);
      setPublishStart(data.publish_start ? new Date(data.publish_start).toISOString().slice(0, 16) : '');
      setPublishEnd(data.publish_end ? new Date(data.publish_end).toISOString().slice(0, 16) : '');
      setCompletionMessage(data.completion_message || '');
      setLinkedApplicationItemId(data.linked_application_item_id || '');
      setFields(data.fields);
    } catch (error) {
      console.error('Error loading form:', error);
      setErrorMessage(
        error instanceof Error ? error.message : 'フォームの読み込みに失敗しました'
      );
    } finally {
      setIsLoading(false);
    }
  }, [formId]);

  useEffect(() => {
    if (isOpen) {
      loadApplicationItems();
      if (formId) {
        loadForm();
      } else if (template) {
        // テンプレートから作成
        setTitle(`${template.name}（${new Date().toLocaleDateString('ja-JP')}）`);
        setSlug(
          template.name
            .toLowerCase()
            .replace(/\s+/g, '-')
            .replace(/[^a-z0-9-]/g, '') +
            '-' +
            new Date().toISOString().split('T')[0].replace(/-/g, '')
        );
        setDescription(template.description || '');
        setFields([]);
        setForm(null);
      } else {
        // 新規作成
        setTitle('');
        setDescription('');
        setSlug('');
        setStatus('draft');
        setPublishStart('');
        setPublishEnd('');
        setCompletionMessage('');
        setLinkedApplicationItemId('');
        setFields([]);
        setForm(null);
      }
    }
  }, [isOpen, formId, template, loadApplicationItems, loadForm]);

  const handleSave = async () => {
    if (!title.trim()) {
      alert('フォームタイトルを入力してください');
      return;
    }
    if (!slug.trim()) {
      alert('URLスラッグを入力してください');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage('');
    try {
      let savedForm: Form;
      if (formId) {
        savedForm = await updateForm(formId, {
          title: title.trim(),
          description: description.trim() || null,
          slug: slug.trim(),
          status,
          publish_start: publishStart ? new Date(publishStart).toISOString() : null,
          publish_end: publishEnd ? new Date(publishEnd).toISOString() : null,
          completion_message: completionMessage.trim() || null,
          linked_application_item_id: linkedApplicationItemId || null,
        });
      } else if (template) {
        const formWithFields = await createFormFromTemplate(template.id, {
          title: title.trim(),
          description: description.trim() || null,
          slug: slug.trim(),
          status,
          publish_start: publishStart ? new Date(publishStart).toISOString() : null,
          publish_end: publishEnd ? new Date(publishEnd).toISOString() : null,
          completion_message: completionMessage.trim() || null,
          linked_application_item_id: linkedApplicationItemId || null,
        });
        savedForm = formWithFields;
        setForm(formWithFields);
        setFields(formWithFields.fields);
      } else {
        savedForm = await createForm({
          title: title.trim(),
          description: description.trim() || null,
          slug: slug.trim(),
          status,
          publish_start: publishStart ? new Date(publishStart).toISOString() : null,
          publish_end: publishEnd ? new Date(publishEnd).toISOString() : null,
          completion_message: completionMessage.trim() || null,
          linked_application_item_id: linkedApplicationItemId || null,
        });
        // 新規作成後はフォームを読み込んでフィールドも取得
        const formWithFields = await getForm(savedForm.id);
        setForm(formWithFields);
        setFields(formWithFields.fields);
      }
      onSuccess();
      onClose();
    } catch (error) {
      console.error('Error saving form:', error);
      setErrorMessage(
        error instanceof Error ? error.message : 'フォームの保存に失敗しました'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddField = () => {
    if (!formId && !form) {
      alert('先にフォームを保存してください');
      return;
    }
    setEditingField(null);
    setIsFieldEditorOpen(true);
  };

  const handleEditField = (field: FormField) => {
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
    const targetFormId = formId || form?.id;
    if (!targetFormId) {
      alert('先にフォームを保存してください');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage('');
    try {
      if (editingField) {
        await updateFormField(editingField.id, {
          ...fieldData,
          options: fieldData.options || null,
        });
      } else {
        await createFormField({
          form_id: targetFormId,
          ...fieldData,
          options: fieldData.options || null,
        });
      }
      // フォームを再読み込み
      const formWithFields = await getForm(targetFormId);
      setForm(formWithFields);
      setFields(formWithFields.fields);
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

    const targetFormId = formId || form?.id;
    if (!targetFormId) return;

    setIsSubmitting(true);
    setErrorMessage('');
    try {
      await deleteFormField(id);
      // フォームを再読み込み
      const formWithFields = await getForm(targetFormId);
      setForm(formWithFields);
      setFields(formWithFields.fields);
    } catch (error) {
      console.error('Error deleting field:', error);
      setErrorMessage(
        error instanceof Error ? error.message : '項目の削除に失敗しました'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleMoveField = async (field: FormField, direction: 'up' | 'down') => {
    const index = fields.findIndex((f) => f.id === field.id);
    if (direction === 'up' && index <= 0) return;
    if (direction === 'down' && index >= fields.length - 1) return;

    const newFields = [...fields];
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    [newFields[index], newFields[swapIndex]] = [newFields[swapIndex], newFields[index]];

    const targetFormId = formId || form?.id;
    if (!targetFormId) return;

    setIsSubmitting(true);
    setErrorMessage('');
    try {
      await reorderFormFields(
        targetFormId,
        newFields.map((f) => f.id)
      );
      // フォームを再読み込み
      const formWithFields = await getForm(targetFormId);
      setForm(formWithFields);
      setFields(formWithFields.fields);
    } catch (error) {
      console.error('Error reordering fields:', error);
      setErrorMessage(
        error instanceof Error ? error.message : '並び順の更新に失敗しました'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const currentFields = fields;

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={
          formId
            ? 'フォームを編集'
            : template
            ? 'テンプレートからフォームを作成'
            : 'フォームを新規作成'
        }
      >
        <div className="space-y-4 max-h-[80vh] overflow-y-auto">
          {errorMessage && (
            <div className="bg-[#d9376e]/20 text-[#d9376e] px-4 py-2 rounded border border-[#d9376e]">
              {errorMessage}
            </div>
          )}

          {isLoading ? (
            <div className="text-center py-8 text-[#2a2a2a]">読み込み中...</div>
          ) : (
            <>
              <div>
                <label className="block text-sm font-medium text-[#2a2a2a] mb-2">
                  フォームタイトル <span className="text-[#d9376e]">*</span>
                </label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="例: Vもぎ申込（10月）"
                  disabled={isSubmitting}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[#2a2a2a] mb-2">
                  URLスラッグ <span className="text-[#d9376e]">*</span>
                </label>
                <Input
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder="例: v-mogi-2024-10"
                  disabled={isSubmitting}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[#2a2a2a] mb-2">
                  説明文
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="フォームの説明を入力（任意）"
                  rows={3}
                  disabled={isSubmitting}
                  className="w-full px-3 py-2 border border-[#0d0d0d] rounded-lg text-sm bg-[#fffffe] text-[#2a2a2a] focus:ring-2 focus:ring-[#ff8e3c] focus:border-[#ff8e3c] disabled:opacity-50"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[#2a2a2a] mb-2">
                  状態
                </label>
                <Select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as typeof status)}
                  disabled={isSubmitting}
                >
                  {Object.entries(FORM_STATUS_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
                <p className="mt-1 text-xs text-[#2a2a2a]/60">
                  「下書き」は非公開、「公開済み」は公開中、「終了」は公開終了です
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[#2a2a2a] mb-2">
                    公開開始日時
                  </label>
                  <Input
                    type="datetime-local"
                    value={publishStart}
                    onChange={(e) => setPublishStart(e.target.value)}
                    disabled={isSubmitting}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#2a2a2a] mb-2">
                    公開終了日時
                  </label>
                  <Input
                    type="datetime-local"
                    value={publishEnd}
                    onChange={(e) => setPublishEnd(e.target.value)}
                    disabled={isSubmitting}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-[#2a2a2a] mb-2">
                  送信完了メッセージ
                </label>
                <textarea
                  value={completionMessage}
                  onChange={(e) => setCompletionMessage(e.target.value)}
                  placeholder="送信完了後に表示するメッセージ"
                  rows={3}
                  disabled={isSubmitting}
                  className="w-full px-3 py-2 border border-[#0d0d0d] rounded-lg text-sm bg-[#fffffe] text-[#2a2a2a] focus:ring-2 focus:ring-[#ff8e3c] focus:border-[#ff8e3c] disabled:opacity-50"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[#2a2a2a] mb-2">
                  紐付ける申込状況項目
                </label>
                <Select
                  value={linkedApplicationItemId}
                  onChange={(e) => setLinkedApplicationItemId(e.target.value)}
                  disabled={isSubmitting}
                >
                  <option value="">なし</option>
                  {applicationItems.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </Select>
              </div>

              {(formId || form) && (
                <div>
                  <div className="mb-2">
                    <div className="text-sm font-medium text-[#2a2a2a] mb-2">
                      共通項目（編集不可）
                    </div>
                    <div className="text-xs text-[#2a2a2a]/60 mb-2">
                      生徒名、学年、メールアドレスはすべてのフォームに含まれます
                    </div>
                  </div>

                  <div className="flex justify-between items-center mb-2">
                    <label className="block text-sm font-medium text-[#2a2a2a]">
                      カスタム項目
                    </label>
                    <Button onClick={handleAddField} size="sm" disabled={isSubmitting}>
                      項目を追加
                    </Button>
                  </div>

                  {currentFields.length === 0 ? (
                    <div className="text-center py-4 text-[#2a2a2a]/60 text-sm">
                      カスタム項目がありません。項目を追加してください。
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {currentFields.map((field, index) => (
                        <div
                          key={field.id}
                          className="flex items-center gap-2 p-3 bg-[#eff0f3] rounded border border-[#0d0d0d]"
                        >
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-[#2a2a2a]/60">
                                {FORM_FIELD_TYPE_LABELS[field.field_type]}
                              </span>
                              <span className="text-[#2a2a2a] font-medium">
                                {field.label}
                              </span>
                              {field.is_required && (
                                <span className="text-xs text-[#d9376e]">必須</span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleMoveField(field, 'up')}
                              disabled={index === 0 || isSubmitting}
                              className="p-1.5 text-[#2a2a2a] hover:text-[#0d0d0d] disabled:opacity-50"
                              title="上に移動"
                            >
                              ↑
                            </button>
                            <button
                              onClick={() => handleMoveField(field, 'down')}
                              disabled={index === currentFields.length - 1 || isSubmitting}
                              className="p-1.5 text-[#2a2a2a] hover:text-[#0d0d0d] disabled:opacity-50"
                              title="下に移動"
                            >
                              ↓
                            </button>
                            <button
                              onClick={() => handleEditField(field)}
                              disabled={isSubmitting}
                              className="p-1.5 text-[#2a2a2a] hover:text-[#ff8e3c] disabled:opacity-50"
                              title="編集"
                            >
                              ✏️
                            </button>
                            <button
                              onClick={() => handleDeleteField(field.id)}
                              disabled={isSubmitting}
                              className="p-1.5 text-[#2a2a2a] hover:text-[#d9376e] disabled:opacity-50"
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

              {(formId || form) && (
                <div className="pt-4 border-t border-[#0d0d0d]">
                  <div className="mb-4">
                    <h3 className="text-sm font-medium text-[#0d0d0d] mb-2">アーカイブ</h3>
                    <p className="text-xs text-[#2a2a2a]/60 mb-3">
                      フォームをアーカイブすると、ポータルから非表示になります。このフォームから申し込んだ回答も自動でアーカイブされます。
                    </p>
                    {form?.is_archived ? (
                      <Button
                        onClick={async () => {
                          if (!formId && !form?.id) return;
                          if (!confirm('このフォームのアーカイブを解除しますか？')) return;
                          
                          setIsArchiving(true);
                          setErrorMessage('');
                          try {
                            const result = await unarchiveForm(formId || form!.id);
                            await loadForm();
                            alert(`アーカイブを解除しました（回答${result.responsesUnarchived}件を含む）`);
                          } catch (error) {
                            console.error('Error unarchiving form:', error);
                            setErrorMessage(
                              error instanceof Error ? error.message : 'アーカイブ解除に失敗しました'
                            );
                          } finally {
                            setIsArchiving(false);
                          }
                        }}
                        variant="secondary"
                        size="sm"
                        disabled={isArchiving || isSubmitting}
                      >
                        {isArchiving ? '処理中...' : 'アーカイブ解除'}
                      </Button>
                    ) : (
                      <Button
                        onClick={async () => {
                          if (!formId && !form?.id) return;
                          if (!confirm('このフォームをアーカイブしますか？\n\nこのフォームから申し込んだ回答も自動でアーカイブされます。')) return;
                          
                          setIsArchiving(true);
                          setErrorMessage('');
                          try {
                            const result = await archiveForm(formId || form!.id);
                            await loadForm();
                            alert(`アーカイブしました（回答${result.responsesArchived}件を含む）`);
                          } catch (error) {
                            console.error('Error archiving form:', error);
                            setErrorMessage(
                              error instanceof Error ? error.message : 'アーカイブに失敗しました'
                            );
                          } finally {
                            setIsArchiving(false);
                          }
                        }}
                        variant="secondary"
                        size="sm"
                        disabled={isArchiving || isSubmitting}
                      >
                        {isArchiving ? '処理中...' : 'アーカイブ'}
                      </Button>
                    )}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-4 border-t border-[#0d0d0d]">
                <Button onClick={onClose} variant="secondary" disabled={isSubmitting || isArchiving}>
                  キャンセル
                </Button>
                <Button onClick={handleSave} disabled={isSubmitting || isArchiving || !title.trim() || !slug.trim()}>
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
