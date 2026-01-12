'use client';

import { useState } from 'react';
import { Input, Select } from '@/components/ui';
import type { School } from '@/types/database';
import type {
  MogiPeriod,
  MogiResponseData,
  DateVenueSelection,
} from '@/types/forms/mogi';
import { submitMogiResponse } from '@/lib/api/mogi';
import { GRADE_NAME_TO_NUMBER } from '@/types/forms/mogi';
import { DateVenueSelector } from './DateVenueSelector';
import { CancelAgreement } from './CancelAgreement';

interface MogiFormProps {
  school: School;
  period: MogiPeriod;
}

export function MogiForm({ school, period }: MogiFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // フォームデータ
  const [studentName, setStudentName] = useState('');
  const [selectedGrade, setSelectedGrade] = useState<string>('');
  const [email, setEmail] = useState('');
  const [selections, setSelections] = useState<DateVenueSelection[]>([]);
  const [cancelAgreed, setCancelAgreed] = useState(false);
  const [note, setNote] = useState('');

  // バリデーションエラー
  const [errors, setErrors] = useState<Record<string, string>>({});

  // 設定を取得
  const settings = period.settings;

  // デフォルト設定
  const grades = settings.grades || ['中3'];
  const dates = settings.dates || [];

  // バリデーション
  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!studentName.trim()) {
      newErrors.studentName = '生徒名を入力してください';
    }

    if (!selectedGrade) {
      newErrors.grade = '学年を選択してください';
    }

    if (!email.trim()) {
      newErrors.email = 'メールアドレスを入力してください';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      newErrors.email = '正しいメールアドレスを入力してください';
    }

    if (selections.length === 0) {
      newErrors.selections = '少なくとも1つの日程・会場を選択してください';
    }

    // 会場が選択されていない日程がないか確認
    for (const selection of selections) {
      if (!selection.venue_id) {
        newErrors.selections = 'すべての選択した日程で会場を選択してください';
        break;
      }
    }

    if (!cancelAgreed) {
      newErrors.cancelAgreed = 'キャンセル不可の同意が必要です';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // フォーム送信
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validate()) {
      return;
    }

    setIsSubmitting(true);
    setErrorMessage('');

    try {
      const gradeNumber = GRADE_NAME_TO_NUMBER[selectedGrade] || 9;

      const responseData: MogiResponseData = {
        selections,
        selection_count: selections.length,
        cancel_agreed: cancelAgreed,
        note: note.trim() || undefined,
      };

      await submitMogiResponse({
        school_id: school.id,
        period_key: period.period_key,
        student_name: studentName.trim(),
        grade: gradeNumber,
        email: email.trim(),
        response_data: responseData,
      });

      setIsSubmitted(true);
    } catch (error) {
      console.error('Error submitting mogi response:', error);
      setErrorMessage(
        error instanceof Error
          ? error.message
          : '申込の送信に失敗しました。もう一度お試しください。'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // フォームリセット
  const handleReset = () => {
    setStudentName('');
    setSelectedGrade('');
    setEmail('');
    setSelections([]);
    setCancelAgreed(false);
    setNote('');
    setErrors({});
    setErrorMessage('');
  };

  // 送信完了画面
  if (isSubmitted) {
    return (
      <div className="bg-[#fffffe] rounded-xl border border-[#0d0d0d] p-8 text-center">
        <div className="mb-6">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg
              className="w-8 h-8 text-green-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-[#0d0d0d] mb-4">
            お申込みありがとうございます
          </h2>
          <p className="text-[#2a2a2a] mb-4">
            受付完了メールを保護者様宛にお送りしました。
          </p>
          {settings.completion_message && (
            <div className="mt-6 p-4 bg-[#eff0f3] rounded-lg text-left">
              <p className="text-sm text-[#2a2a2a] whitespace-pre-line">
                {settings.completion_message}
              </p>
            </div>
          )}
        </div>
        <a
          href={`/portal/${school.code}`}
          className="inline-block px-6 py-3 bg-[#ff8e3c] text-[#0d0d0d] font-medium rounded-lg hover:bg-[#ff9e5c] transition-colors"
        >
          ポータルに戻る
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ヒーローセクション */}
      <div className="bg-gradient-to-r from-[#ff8e3c] to-[#ff9e5c] rounded-xl border border-[#0d0d0d] p-8 text-center">
        <h1 className="text-3xl font-bold text-[#0d0d0d] mb-4">
          {period.title}
        </h1>
        {settings.description && (
          <p className="text-[#2a2a2a] text-lg whitespace-pre-line">
            {settings.description}
          </p>
        )}
      </div>

      {/* フォーム */}
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* エラーメッセージ */}
        {errorMessage && (
          <div className="bg-[#d9376e]/10 border border-[#d9376e] rounded-lg p-4">
            <p className="text-sm text-[#d9376e]">{errorMessage}</p>
          </div>
        )}

        {/* セクション1: 基本情報 */}
        <div className="bg-[#fffffe] rounded-xl border border-[#0d0d0d] p-6">
          <h2 className="text-lg font-bold text-[#0d0d0d] mb-4">基本情報</h2>
          <div className="space-y-4">
            {/* 生徒名 */}
            <div>
              <label className="block text-sm font-medium text-[#0d0d0d] mb-2">
                生徒名
                <span className="text-[#d9376e] ml-1">*</span>
              </label>
              <Input
                type="text"
                value={studentName}
                onChange={(e) => setStudentName(e.target.value)}
                disabled={isSubmitting}
                placeholder="山田太郎"
                className={errors.studentName ? 'border-[#d9376e]' : ''}
              />
              {errors.studentName && (
                <p className="text-sm text-[#d9376e] mt-1">
                  {errors.studentName}
                </p>
              )}
            </div>

            {/* 学年 */}
            <div>
              <Select
                label="学年"
                value={selectedGrade}
                onChange={(e) => setSelectedGrade(e.target.value)}
                options={[
                  { value: '', label: '選択してください' },
                  ...grades.map((grade) => ({ value: grade, label: grade }))
                ]}
                error={errors.grade}
                required
                disabled={isSubmitting}
              />
            </div>

            {/* メールアドレス */}
            <div>
              <label className="block text-sm font-medium text-[#0d0d0d] mb-2">
                保護者メールアドレス
                <span className="text-[#d9376e] ml-1">*</span>
              </label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isSubmitting}
                placeholder="parent@example.com"
                className={errors.email ? 'border-[#d9376e]' : ''}
              />
              {errors.email && (
                <p className="text-sm text-[#d9376e] mt-1">{errors.email}</p>
              )}
            </div>
          </div>
        </div>

        {/* セクション2: 受験日程・会場選択 */}
        <div className="bg-[#fffffe] rounded-xl border border-[#0d0d0d] p-6">
          <h2 className="text-lg font-bold text-[#0d0d0d] mb-4">
            受験日程・会場選択
          </h2>
          <p className="text-sm text-[#2a2a2a] mb-4">
            受験する日程と会場を選択してください（複数選択可）
          </p>
          <DateVenueSelector
            dates={dates}
            selections={selections}
            onChange={setSelections}
            disabled={isSubmitting}
          />
          {errors.selections && (
            <p className="text-sm text-[#d9376e] mt-2">{errors.selections}</p>
          )}
        </div>

        {/* セクション3: キャンセル不可の同意 */}
        <div className="bg-[#fffffe] rounded-xl border border-[#0d0d0d] p-6">
          <h2 className="text-lg font-bold text-[#0d0d0d] mb-4">
            キャンセル不可の同意
          </h2>
          <CancelAgreement
            agreed={cancelAgreed}
            onChange={setCancelAgreed}
            disabled={isSubmitting}
            error={errors.cancelAgreed}
          />
        </div>

        {/* セクション4: 備考 */}
        <div className="bg-[#fffffe] rounded-xl border border-[#0d0d0d] p-6">
          <h2 className="text-lg font-bold text-[#0d0d0d] mb-4">備考</h2>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={isSubmitting}
            placeholder="例：特別な配慮が必要な場合など"
            rows={4}
            className="w-full px-3 py-2 border border-[#0d0d0d] rounded-lg text-sm bg-[#fffffe] text-[#2a2a2a] focus:outline-none focus:ring-2 focus:ring-[#ff8e3c] disabled:bg-[#eff0f3] disabled:cursor-not-allowed"
          />
        </div>

        {/* 送信ボタンエリア */}
        <div className="flex gap-4">
          <button
            type="button"
            onClick={handleReset}
            disabled={isSubmitting}
            className="flex-1 px-6 py-3 bg-[#eff0f3] text-[#2a2a2a] font-medium rounded-lg hover:bg-[#0d0d0d]/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            リセット
          </button>
          <button
            type="submit"
            disabled={isSubmitting || !cancelAgreed}
            className="flex-1 px-6 py-3 bg-[#ff8e3c] text-[#0d0d0d] font-medium rounded-lg hover:bg-[#ff9e5c] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? '送信中...' : '申し込む'}
          </button>
        </div>
      </form>
    </div>
  );
}
