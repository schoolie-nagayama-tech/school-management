'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Input, Select, Button } from '@/components/ui';
import type { School } from '@/types/database';
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
  const router = useRouter();
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
      alert('プレビューモードでは送信できません。');
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
      <div className="max-w-md mx-auto p-6">
        <div className="bg-green-50 border border-green-200 rounded-lg p-6 text-center">
          <div className="text-4xl mb-4">✓</div>
          <h2 className="text-xl font-bold text-green-800 mb-4">
            送信完了
          </h2>
          <p className="text-green-700 whitespace-pre-wrap text-sm">
            {settings.completion_message}
          </p>
          <button
            onClick={() => router.push(`/portal/${school.code}`)}
            className="mt-6 text-green-600 hover:underline text-sm"
          >
            ポータルに戻る
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto p-4">
      {/* ヘッダー */}
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={() => router.push(`/portal/${school.code}`)}
          className="text-[#4b5563] hover:text-[#1f2937]"
        >
          ← 戻る
        </button>
        <h1 className="text-xl font-bold text-[#1f2937]">お客様相談</h1>
        <div className="w-12"></div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {isPreview && (
          <div className="p-3 bg-amber-100 border border-amber-400 rounded-lg">
            <p className="text-sm text-amber-800 font-medium">＜プレビューモード＞ このページは管理者確認用です。実際の回答は送信されません。</p>
          </div>
        )}
        {/* 説明文 */}
        {settings.description && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-blue-800 whitespace-pre-wrap text-sm">
              {settings.description}
            </p>
          </div>
        )}

        {/* 基本情報 */}
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
              className={errors.email ? 'border-red-500' : ''}
            />
            {errors.email && (
              <p className="text-red-500 text-xs mt-1">{errors.email}</p>
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

        {/* 相談区分 */}
        <div>
          <label className="block text-sm font-medium mb-2 text-[#1f2937]">
            相談区分 <span className="text-red-500">*</span>
          </label>
          <div className="space-y-2">
            {settings.categories.map((cat) => (
              <label
                key={cat}
                className={`flex items-center p-3 border rounded-lg cursor-pointer transition-colors ${
                  selectedCategories.includes(cat)
                    ? 'border-[#3b82f6] bg-orange-50'
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
            <p className="text-red-500 text-xs mt-1">{errors.categories}</p>
          )}
        </div>

        {/* 相談内容 */}
        <div>
          <label className="block text-sm font-medium mb-1 text-[#1f2937]">
            相談内容 <span className="text-red-500">*</span>
          </label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="ご相談内容をご記入ください"
            rows={6}
            className={`w-full border border-[#e5e7eb] rounded-lg px-3 py-2 resize-y min-h-[120px] text-sm ${
              errors.content ? 'border-red-500' : ''
            }`}
          />
          <p className={`text-xs mt-1 ${
            content.length < 10 ? 'text-red-500' : 'text-[#4b5563]/60'
          }`}>
            {content.length}文字（10文字以上）
          </p>
          {errors.content && (
            <p className="text-red-500 text-xs mt-1">{errors.content}</p>
          )}
        </div>

        {/* エラーメッセージ */}
        {errorMessage && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-red-800 text-sm">{errorMessage}</p>
          </div>
        )}

        {/* 送信ボタン */}
        <Button
          type="submit"
          disabled={isSubmitting}
          className="w-full"
        >
          {isSubmitting ? '送信中...' : '送信する'}
        </Button>
      </form>
    </div>
  );
}
