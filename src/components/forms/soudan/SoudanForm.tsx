'use client';

import { useState, useRef } from 'react';
import { Input, Select } from '@/components/ui';
import {
  PortalFormHeader,
  PortalFormSection,
  PortalFormActions,
  PortalCompletionView,
  PortalErrorBanner,
  PortalPreviewBanner,
  usePortalFormDraft,
} from '@/components/forms/shared';
import type { School } from '@/types/database';
import { validateStudentName } from '@/lib/utils/validation';
import type {
  SoudanPeriod,
  SoudanResponseData,
} from '@/types/forms/soudan';
import { submitSoudanResponse } from '@/lib/api/soudan';
import { SOUDAN_GRADE_NAME_TO_NUMBER } from '@/types/forms/soudan';

interface SoudanFormProps {
  school: School;
  period: SoudanPeriod;
  isPreview?: boolean;
}

const GRADES = ['小1', '小2', '小3', '小4', '小5', '小6', '中1', '中2', '中3', '高1', '高2', '高3'];

export function SoudanForm({ school, period, isPreview }: SoudanFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // フォームデータ
  const [studentName, setStudentName] = useState('');
  const [selectedGrade, setSelectedGrade] = useState<string>('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [content, setContent] = useState('');

  // バリデーションエラー
  const [errors, setErrors] = useState<Record<string, string>>({});

  // 設定を取得
  const settings = period.settings;

  // ドラフト自動保存
  const { clearDraft } = usePortalFormDraft({
    storageKey: `soudan:${school.id}:${period.period_key}`,
    enabled: !isPreview,
    value: { studentName, selectedGrade, email, phone, selectedCategories, content },
    onRestore: (d) => {
      if (d.studentName) setStudentName(d.studentName);
      if (d.selectedGrade) setSelectedGrade(d.selectedGrade);
      if (d.email) setEmail(d.email);
      if (d.phone) setPhone(d.phone);
      if (d.selectedCategories?.length) setSelectedCategories(d.selectedCategories);
      if (d.content) setContent(d.content);
    },
  });

  // 学年を数値に変換
  const gradeToNumber = (gradeStr: string): number | undefined => {
    if (!gradeStr) return undefined;
    return SOUDAN_GRADE_NAME_TO_NUMBER[gradeStr] || undefined;
  };

  // 相談区分の選択切り替え
  const toggleCategory = (category: string) => {
    setSelectedCategories((prev) =>
      prev.includes(category)
        ? prev.filter((c) => c !== category)
        : [...prev, category]
    );
  };

  // バリデーション
  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    // メールアドレスが入力されている場合は形式チェック
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      newErrors.email = '正しいメールアドレスを入力してください';
    }

    if (selectedCategories.length === 0) {
      newErrors.categories = '相談区分を1つ以上選択してください';
    }

    // 生徒名は任意だが、入力された場合はメールアドレス等でないことをチェック
    if (studentName.trim()) {
      const nameError = validateStudentName(studentName);
      if (nameError && nameError !== '生徒名を入力してください') {
        newErrors.studentName = nameError;
      }
    }

    if (content.trim().length < 10) {
      newErrors.content = '相談内容を10文字以上入力してください';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // フォーム送信
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingRef.current) return;
    if (isPreview) {
      setErrorMessage('プレビューモードでは送信できません。');
      return;
    }
    if (!validate()) {
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    setErrorMessage('');

    try {
      const gradeNumber = gradeToNumber(selectedGrade);

      const responseData: SoudanResponseData = {
        categories: selectedCategories,
        content: content.trim(),
        phone: phone.trim() || undefined,
        student_name: studentName.trim() || undefined,
        grade: gradeNumber,
        email: email.trim() || undefined,
      };

      await submitSoudanResponse({
        school_id: school.id,
        period_key: period.period_key,
        student_name: studentName.trim() || '',
        grade: gradeNumber || 0,
        email: email.trim() || '',
        response_data: responseData,
      });

      clearDraft();
      setIsSubmitted(true);
    } catch (error) {
      console.error('Failed to submit:', error);
      setErrorMessage(
        error instanceof Error
          ? error.message
          : '送信に失敗しました。もう一度お試しください。'
      );
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  // 送信完了画面
  if (isSubmitted) {
    return (
      <PortalCompletionView
        schoolCode={school.code ?? ''}
        title="送信完了"
        completionMessage={settings.completion_message}
      />
    );
  }

  return (
    <div className="space-y-5">
      <PortalFormHeader
        eyebrow="お客様相談"
        title={period.title || 'お客様相談'}
        description={settings.description}
      />

      <form onSubmit={handleSubmit} className="space-y-5">
        {isPreview && <PortalPreviewBanner />}

        <PortalFormSection title="基本情報">
        <div className="space-y-4">
          {/* 生徒名 */}
          <div>
            <label className="block text-sm font-medium mb-1 text-[#1f2937]">
              生徒名
            </label>
            <Input
              type="text"
              value={studentName}
              onChange={(e) => setStudentName(e.target.value)}
              placeholder="例：山田 太郎"
            />
          </div>

          {/* 学年 */}
          <div>
            <label className="block text-sm font-medium mb-1 text-[#1f2937]">
              学年
            </label>
            <Select
              value={selectedGrade}
              onChange={(e) => setSelectedGrade(e.target.value)}
              options={[
                { value: '', label: '選択してください' },
                ...GRADES.map((g) => ({ value: g, label: g })),
              ]}
            />
          </div>

          {/* メールアドレス */}
          <div>
            <label className="block text-sm font-medium mb-1 text-[#1f2937]">
              メールアドレス
            </label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="example@email.com"
              className={errors.email ? 'border-[color:var(--primary)]' : ''}
            />
            {errors.email && (
              <p className="text-[color:var(--primary)] text-xs mt-1">{errors.email}</p>
            )}
          </div>

          {/* 電話番号 */}
          <div>
            <label className="block text-sm font-medium mb-1 text-[#1f2937]">
              電話番号
            </label>
            <Input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="090-1234-5678"
            />
          </div>
        </div>
        </PortalFormSection>

        <PortalFormSection title="相談区分">
          <div className="space-y-2">
            {settings.categories.map((cat) => (
              <label
                key={cat}
                className={`flex items-center p-3 border rounded-lg cursor-pointer transition-colors ${
                  selectedCategories.includes(cat)
                    ? 'border-[color:var(--primary)] bg-[color:var(--primary-subtle)]'
                    : 'border-gray-300 hover:bg-gray-50'
                }`}
              >
                <input
                  type="checkbox"
                  checked={selectedCategories.includes(cat)}
                  onChange={() => toggleCategory(cat)}
                  className="mr-3"
                />
                <span className="text-[#1f2937]">{cat}</span>
              </label>
            ))}
          </div>
          {errors.categories && (
            <p className="text-[color:var(--primary)] text-xs mt-1">{errors.categories}</p>
          )}
        </PortalFormSection>

        <PortalFormSection title="相談内容">
          <div>
            <label className="sr-only">
              相談内容 <span className="text-[color:var(--primary)]">*</span>
            </label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="ご相談内容をご記入ください"
            rows={6}
            className={`w-full border border-[#e5e7eb] rounded-lg px-3 py-2 resize-y min-h-[120px] text-sm ${
              errors.content ? 'border-[color:var(--primary)]' : ''
            }`}
          />
          <p className={`text-xs mt-1 ${
            content.length < 10 ? 'text-[color:var(--primary)]' : 'text-[#4b5563]/60'
          }`}>
            {content.length}文字（10文字以上）
          </p>
          {errors.content && (
            <p className="text-[color:var(--primary)] text-xs mt-1">{errors.content}</p>
          )}
          </div>
        </PortalFormSection>

        {errorMessage && <PortalErrorBanner message={errorMessage} />}

        <PortalFormActions isSubmitting={isSubmitting} submitLabel="送信する" />
      </form>
    </div>
  );
}
