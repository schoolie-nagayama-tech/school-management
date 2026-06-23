'use client';

import { useState, useEffect } from 'react';
import { Button, Input, Modal, Select } from '@/components/ui';
import type { FormFieldType, FormTemplateField, FormField } from '@/types/database';
import { FORM_FIELD_TYPE_LABELS } from '@/types/database';

interface FieldEditorProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (field: {
    field_type: FormFieldType;
    label: string;
    placeholder?: string;
    options?: string[];
    is_required: boolean;
  }) => void;
  field?: FormTemplateField | FormField | null;
}

export function FieldEditor({ isOpen, onClose, onSave, field }: FieldEditorProps) {
  const [fieldType, setFieldType] = useState<FormFieldType>('text');
  const [label, setLabel] = useState('');
  const [placeholder, setPlaceholder] = useState('');
  const [isRequired, setIsRequired] = useState(false);
  const [optionsText, setOptionsText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // 選択肢が必要なフィールドタイプ
  const needsOptions = ['select', 'radio', 'checkbox'].includes(fieldType);

  useEffect(() => {
    if (field) {
      setFieldType(field.field_type);
      setLabel(field.label);
      setPlaceholder('placeholder' in field && field.placeholder ? String(field.placeholder) : '');
      setIsRequired(field.is_required);
      if (field.options && Array.isArray(field.options)) {
        setOptionsText((field.options as string[]).join('\n'));
      } else {
        setOptionsText('');
      }
    } else {
      // 新規作成時はリセット
      setFieldType('text');
      setLabel('');
      setPlaceholder('');
      setIsRequired(false);
      setOptionsText('');
    }
    setErrorMessage('');
  }, [field, isOpen]);

  const handleSave = () => {
    setErrorMessage('');
    if (!label.trim()) {
      setErrorMessage('ラベルを入力してください');
      return;
    }

    if (needsOptions && !optionsText.trim()) {
      setErrorMessage('選択肢を入力してください（1行に1つずつ）');
      return;
    }

    const options = needsOptions
      ? optionsText
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0)
      : undefined;

    setIsSubmitting(true);
    try {
      onSave({
        field_type: fieldType,
        label: label.trim(),
        placeholder: placeholder.trim() || undefined,
        options,
        is_required: isRequired,
      });
      onClose();
    } catch (error) {
      console.error('Error saving field:', error);
      setErrorMessage('項目の保存に失敗しました');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={field ? '項目を編集' : '項目を追加'}>
      <div className="space-y-4">
        {errorMessage && (
          <div className="bg-[#ef4444]/20 text-[#ef4444] px-4 py-2 rounded border border-[#ef4444] text-sm">
            {errorMessage}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-[#4b5563] mb-2">
            項目タイプ <span className="text-[#ef4444]">*</span>
          </label>
          <Select
            value={fieldType}
            onChange={(e) => setFieldType(e.target.value as FormFieldType)}
            disabled={isSubmitting}
            options={Object.entries(FORM_FIELD_TYPE_LABELS).map(([value, label]) => ({
              value,
              label,
            }))}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-[#4b5563] mb-2">
            ラベル <span className="text-[#ef4444]">*</span>
          </label>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="例: 希望日程"
            disabled={isSubmitting}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-[#4b5563] mb-2">プレースホルダー</label>
          <Input
            value={placeholder}
            onChange={(e) => setPlaceholder(e.target.value)}
            placeholder="例: 2024年10月15日"
            disabled={isSubmitting}
          />
        </div>

        {needsOptions && (
          <div>
            <label className="block text-sm font-medium text-[#4b5563] mb-2">
              選択肢 <span className="text-[#ef4444]">*</span>
              <span className="text-xs text-[#4b5563]/60 ml-2">（1行に1つずつ入力）</span>
            </label>
            <textarea
              value={optionsText}
              onChange={(e) => setOptionsText(e.target.value)}
              placeholder="会場A&#10;会場B&#10;会場C"
              rows={5}
              disabled={isSubmitting}
              className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm bg-white text-[#4b5563] focus:ring-2 focus:ring-[#3b82f6] focus:border-[#3b82f6] disabled:opacity-50"
            />
          </div>
        )}

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="isRequired"
            checked={isRequired}
            onChange={(e) => setIsRequired(e.target.checked)}
            disabled={isSubmitting}
            className="w-4 h-4 text-[#3b82f6] border-[#e5e7eb] rounded focus:ring-[#3b82f6]"
          />
          <label htmlFor="isRequired" className="text-sm text-[#4b5563]">
            必須項目
          </label>
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t border-[#e5e7eb]">
          <Button onClick={onClose} variant="secondary" disabled={isSubmitting}>
            キャンセル
          </Button>
          <Button onClick={handleSave} disabled={isSubmitting || !label.trim()}>
            保存
          </Button>
        </div>
      </div>
    </Modal>
  );
}
