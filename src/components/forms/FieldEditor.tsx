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

  // 選択肢が必要なフィールドタイプ
  const needsOptions = ['select', 'radio', 'checkbox'].includes(fieldType);

  useEffect(() => {
    if (field) {
      setFieldType(field.field_type);
      setLabel(field.label);
      setPlaceholder(field.placeholder || '');
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
  }, [field, isOpen]);

  const handleSave = () => {
    if (!label.trim()) {
      alert('ラベルを入力してください');
      return;
    }

    if (needsOptions && !optionsText.trim()) {
      alert('選択肢を入力してください（1行に1つずつ）');
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
      alert('項目の保存に失敗しました');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={field ? '項目を編集' : '項目を追加'}
    >
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-[#2a2a2a] mb-2">
            項目タイプ <span className="text-[#d9376e]">*</span>
          </label>
          <Select
            value={fieldType}
            onChange={(e) => setFieldType(e.target.value as FormFieldType)}
            disabled={isSubmitting}
          >
            {Object.entries(FORM_FIELD_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <label className="block text-sm font-medium text-[#2a2a2a] mb-2">
            ラベル <span className="text-[#d9376e]">*</span>
          </label>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="例: 希望日程"
            disabled={isSubmitting}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-[#2a2a2a] mb-2">
            プレースホルダー
          </label>
          <Input
            value={placeholder}
            onChange={(e) => setPlaceholder(e.target.value)}
            placeholder="例: 2024年10月15日"
            disabled={isSubmitting}
          />
        </div>

        {needsOptions && (
          <div>
            <label className="block text-sm font-medium text-[#2a2a2a] mb-2">
              選択肢 <span className="text-[#d9376e]">*</span>
              <span className="text-xs text-[#2a2a2a]/60 ml-2">（1行に1つずつ入力）</span>
            </label>
            <textarea
              value={optionsText}
              onChange={(e) => setOptionsText(e.target.value)}
              placeholder="会場A&#10;会場B&#10;会場C"
              rows={5}
              disabled={isSubmitting}
              className="w-full px-3 py-2 border border-[#0d0d0d] rounded-lg text-sm bg-[#fffffe] text-[#2a2a2a] focus:ring-2 focus:ring-[#ff8e3c] focus:border-[#ff8e3c] disabled:opacity-50"
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
            className="w-4 h-4 text-[#ff8e3c] border-[#0d0d0d] rounded focus:ring-[#ff8e3c]"
          />
          <label htmlFor="isRequired" className="text-sm text-[#2a2a2a]">
            必須項目
          </label>
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t border-[#0d0d0d]">
          <Button
            onClick={onClose}
            variant="secondary"
            disabled={isSubmitting}
          >
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
