'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input, Select } from '@/components/ui';
import type { FormWithFields, FormField } from '@/types/database';
import { GRADE_LABELS } from '@/types/database';
import { submitFormResponse } from '@/lib/api/forms';

interface PublicFormRendererProps {
  form: FormWithFields;
  schoolCode: string;
  onSuccess?: () => void;
  isReadOnly?: boolean;
}

export function PublicFormRenderer({
  form,
  schoolCode,
  onSuccess,
  isReadOnly = false,
}: PublicFormRendererProps) {
  const router = useRouter();
  const [studentName, setStudentName] = useState('');
  const [grade, setGrade] = useState<number | ''>('');
  const [email, setEmail] = useState('');
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const submittingRef = useRef(false);

  const validateEmail = (email: string) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const validate = () => {
    const newErrors: Record<string, string> = {};

    if (!studentName.trim()) {
      newErrors.studentName = '生徒名を入力してください';
    }

    if (grade === '' || typeof grade !== 'number') {
      newErrors.grade = '学年を選択してください';
    }

    if (!email.trim()) {
      newErrors.email = 'メールアドレスを入力してください';
    } else if (!validateEmail(email)) {
      newErrors.email = '正しいメールアドレスを入力してください';
    }

    // フォーム項目のバリデーション
    form.fields.forEach((field) => {
      if (field.is_required) {
        const value = answers[field.id];
        if (!value || (Array.isArray(value) && value.length === 0)) {
          newErrors[field.id] = `${field.label}を入力してください`;
        }
      }
    });

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingRef.current) return;

    if (isReadOnly) {
      setErrorMessage('プレビューモードでは送信できません。実際のフォームページから送信してください。');
      return;
    }

    if (!validate()) {
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    try {

      await submitFormResponse(form.id, {
        student_name: studentName.trim(),
        grade: grade === '' ? null : Number(grade),
        email: email.trim() || null,
        answers,
      });
      if (onSuccess) {
        onSuccess();
      }
      router.push(`/portal/${schoolCode}/${form.slug}?submitted=true`);
    } catch (error) {
      console.error('Error submitting form:', error);
      setErrorMessage('送信に失敗しました。もう一度お試しください。');
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const handleFieldChange = (fieldId: string, value: string | string[]) => {
    setAnswers((prev) => ({
      ...prev,
      [fieldId]: value,
    }));
    // エラーをクリア
    if (errors[fieldId]) {
      setErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[fieldId];
        return newErrors;
      });
    }
  };

  const renderField = (field: FormField) => {
    const value = answers[field.id] || '';
    const fieldError = errors[field.id];

    switch (field.field_type) {
      case 'text':
        return (
          <div key={field.id}>
            <label className="block text-sm font-medium text-[#4b5563] mb-2">
              {field.label}
              {field.is_required && <span className="text-[#ef4444] ml-1">*</span>}
            </label>
            <Input
              value={typeof value === 'string' ? value : ''}
              onChange={(e) => handleFieldChange(field.id, e.target.value)}
              placeholder={('placeholder' in field && field.placeholder) ? String(field.placeholder) : ''}
              disabled={isSubmitting}
            />
            {fieldError && (
              <p className="text-sm text-[#ef4444] mt-1">{fieldError}</p>
            )}
          </div>
        );

      case 'textarea':
        return (
          <div key={field.id}>
            <label className="block text-sm font-medium text-[#4b5563] mb-2">
              {field.label}
              {field.is_required && <span className="text-[#ef4444] ml-1">*</span>}
            </label>
            <textarea
              value={typeof value === 'string' ? value : ''}
              onChange={(e) => handleFieldChange(field.id, e.target.value)}
              placeholder={('placeholder' in field && field.placeholder) ? String(field.placeholder) : ''}
              rows={4}
              disabled={isSubmitting}
              className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm bg-white text-[#4b5563] focus:ring-2 focus:ring-[#3b82f6] focus:border-[#3b82f6] disabled:opacity-50"
            />
            {fieldError && (
              <p className="text-sm text-[#ef4444] mt-1">{fieldError}</p>
            )}
          </div>
        );

      case 'select':
        const options = Array.isArray(field.options) ? field.options : [];
        return (
          <div key={field.id}>
            <label className="block text-sm font-medium text-[#4b5563] mb-2">
              {field.label}
              {field.is_required && <span className="text-[#ef4444] ml-1">*</span>}
            </label>
            <Select
              value={typeof value === 'string' ? value : ''}
              onChange={(e) => handleFieldChange(field.id, e.target.value)}
              disabled={isSubmitting}
              options={[
                { value: '', label: '選択してください' },
                ...options.map((opt) => ({ value: opt, label: opt })),
              ]}
            />
            {fieldError && (
              <p className="text-sm text-[#ef4444] mt-1">{fieldError}</p>
            )}
          </div>
        );

      case 'radio':
        const radioOptions = Array.isArray(field.options) ? field.options : [];
        return (
          <div key={field.id}>
            <label className="block text-sm font-medium text-[#4b5563] mb-2">
              {field.label}
              {field.is_required && <span className="text-[#ef4444] ml-1">*</span>}
            </label>
            <div className="space-y-2">
              {radioOptions.map((option, idx) => (
                <label
                  key={idx}
                  className="flex items-center gap-2 cursor-pointer"
                >
                  <input
                    type="radio"
                    name={field.id}
                    value={option}
                    checked={value === option}
                    onChange={(e) => handleFieldChange(field.id, e.target.value)}
                    disabled={isSubmitting}
                    className="w-4 h-4 text-[#3b82f6] border-[#e5e7eb] focus:ring-[#3b82f6]"
                  />
                  <span className="text-[#4b5563]">{option}</span>
                </label>
              ))}
            </div>
            {fieldError && (
              <p className="text-sm text-[#ef4444] mt-1">{fieldError}</p>
            )}
          </div>
        );

      case 'checkbox':
        const checkboxOptions = Array.isArray(field.options) ? field.options : [];
        const checkboxValue = Array.isArray(value) ? value : [];
        return (
          <div key={field.id}>
            <label className="block text-sm font-medium text-[#4b5563] mb-2">
              {field.label}
              {field.is_required && <span className="text-[#ef4444] ml-1">*</span>}
            </label>
            <div className="space-y-2">
              {checkboxOptions.map((option, idx) => (
                <label
                  key={idx}
                  className="flex items-center gap-2 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    value={option}
                    checked={checkboxValue.includes(option)}
                    onChange={(e) => {
                      const newValue = e.target.checked
                        ? [...checkboxValue, option]
                        : checkboxValue.filter((v) => v !== option);
                      handleFieldChange(field.id, newValue);
                    }}
                    disabled={isSubmitting}
                    className="w-4 h-4 text-[#3b82f6] border-[#e5e7eb] rounded focus:ring-[#3b82f6]"
                  />
                  <span className="text-[#4b5563]">{option}</span>
                </label>
              ))}
            </div>
            {fieldError && (
              <p className="text-sm text-[#ef4444] mt-1">{fieldError}</p>
            )}
          </div>
        );

      case 'date':
        return (
          <div key={field.id}>
            <label className="block text-sm font-medium text-[#4b5563] mb-2">
              {field.label}
              {field.is_required && <span className="text-[#ef4444] ml-1">*</span>}
            </label>
            <Input
              type="date"
              value={typeof value === 'string' ? value : ''}
              onChange={(e) => handleFieldChange(field.id, e.target.value)}
              disabled={isSubmitting}
            />
            {fieldError && (
              <p className="text-sm text-[#ef4444] mt-1">{fieldError}</p>
            )}
          </div>
        );

      case 'number':
        return (
          <div key={field.id}>
            <label className="block text-sm font-medium text-[#4b5563] mb-2">
              {field.label}
              {field.is_required && <span className="text-[#ef4444] ml-1">*</span>}
            </label>
            <Input
              type="number"
              value={typeof value === 'string' ? value : ''}
              onChange={(e) => handleFieldChange(field.id, e.target.value)}
              placeholder={('placeholder' in field && field.placeholder) ? String(field.placeholder) : ''}
              disabled={isSubmitting}
            />
            {fieldError && (
              <p className="text-sm text-[#ef4444] mt-1">{fieldError}</p>
            )}
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {errorMessage && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {errorMessage}
        </div>
      )}
      {/* 共通項目 */}
      <div className="space-y-4 bg-[#f3f4f6] p-4 rounded-lg border border-[#e5e7eb]">
        <h3 className="text-lg font-semibold text-[#1f2937] mb-4">基本情報</h3>

        <div>
          <label className="block text-sm font-medium text-[#4b5563] mb-2">
            生徒名 <span className="text-[#ef4444]">*</span>
          </label>
          <Input
            value={studentName}
            onChange={(e) => {
              setStudentName(e.target.value);
              if (errors.studentName) {
                setErrors((prev) => {
                  const newErrors = { ...prev };
                  delete newErrors.studentName;
                  return newErrors;
                });
              }
            }}
            placeholder="山田太郎"
            disabled={isSubmitting}
          />
          {errors.studentName && (
            <p className="text-sm text-[#ef4444] mt-1">{errors.studentName}</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-[#4b5563] mb-2">
            学年 <span className="text-[#ef4444]">*</span>
          </label>
          <Select
            value={grade === '' ? '' : String(grade)}
            onChange={(e) => {
              setGrade(e.target.value === '' ? '' : Number(e.target.value));
              if (errors.grade) {
                setErrors((prev) => {
                  const newErrors = { ...prev };
                  delete newErrors.grade;
                  return newErrors;
                });
              }
            }}
            disabled={isSubmitting}
            options={[
              { value: '', label: '選択してください' },
              ...Object.entries(GRADE_LABELS).map(([key, label]) => ({ value: key, label })),
            ]}
          />
          {errors.grade && (
            <p className="text-sm text-[#ef4444] mt-1">{errors.grade}</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-[#4b5563] mb-2">
            メールアドレス <span className="text-[#ef4444]">*</span>
          </label>
          <Input
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (errors.email) {
                setErrors((prev) => {
                  const newErrors = { ...prev };
                  delete newErrors.email;
                  return newErrors;
                });
              }
            }}
            placeholder="example@email.com"
            disabled={isSubmitting}
          />
          {errors.email && (
            <p className="text-sm text-[#ef4444] mt-1">{errors.email}</p>
          )}
        </div>
      </div>

      {/* フォーム固有の項目 */}
      {form.fields.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-[#1f2937]">回答項目</h3>
          {form.fields.map((field) => renderField(field))}
        </div>
      )}

      {/* 送信ボタン */}
      <div className="flex justify-center pt-6">
        <Button
          type="submit"
          size="lg"
          disabled={isSubmitting}
          className="min-h-[48px] px-8 text-lg"
        >
          {isSubmitting ? '送信中...' : '送信する'}
        </Button>
      </div>
    </form>
  );
}
