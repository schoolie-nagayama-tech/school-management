'use client';

import { useState, useRef } from 'react';
import { Input, Select } from '@/components/ui';
import type { School } from '@/types/database';
import { validateStudentName } from '@/lib/utils/validation';
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
  isPreview?: boolean;
}

export function MogiForm({ school, period, isPreview }: MogiFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // フォームデータ
  const [studentName, setStudentName] = useState('');
  const [selectedGrade, setSelectedGrade] = useState<string>('');
  const [email, setEmail] = useState('');
  const [selections, setSelections] = useState<DateVenueSelection[]>([]);
  const [cancelAgreed, setCancelAgreed] = useState(false);

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

    const nameError = validateStudentName(studentName);
    if (nameError) {
      newErrors.studentName = nameError;
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
      const gradeNumber = GRADE_NAME_TO_NUMBER[selectedGrade] || 9;

      const responseData: MogiResponseData = {
        selections,
        selection_count: selections.length,
        cancel_agreed: cancelAgreed,
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
      submittingRef.current = false;
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
    setErrors({});
    setErrorMessage('');
  };

  // 送信完了画面
  if (isSubmitted) {
    return (
      <div className="bg-white rounded-2xl border border-[#e5e7eb] p-8 sm:p-10 text-center">
        <div className="mb-6">
          <div className="w-14 h-14 rounded-full bg-[color:var(--primary-subtle)] ring-1 ring-[color:var(--primary)]/20 flex items-center justify-center mx-auto mb-6">
            <svg
              className="w-7 h-7 text-[color:var(--primary)]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-[22px] font-bold text-[#1a1a1a] mb-3 tracking-tight">
            お申込みありがとうございます
          </h2>
          <p className="text-sm text-[#4b5563] leading-relaxed">
            受付完了メールを保護者様宛にお送りしました。
          </p>
          {settings.completion_message && (
            <div className="mt-6 p-4 bg-[#f8f8f8] rounded-lg text-left border border-[#e5e7eb]">
              <p className="text-sm text-[#4b5563] whitespace-pre-line leading-relaxed">
                {settings.completion_message}
              </p>
            </div>
          )}
        </div>
        <a
          href={`/portal/${school.code}`}
          className="inline-block px-6 py-3 bg-[color:var(--primary)] text-white font-semibold rounded-lg hover:bg-[color:var(--primary-dark)] transition-colors"
        >
          ポータルに戻る
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* ヘッダー（青グラデ撤廃・エディトリアル寄り） */}
      <header className="pt-2 pb-1">
        <p className="text-[11px] font-semibold tracking-[0.18em] text-[color:var(--primary)] uppercase mb-2">
          Vもぎ 申込
        </p>
        <h1 className="text-[26px] sm:text-[28px] font-bold text-[#1a1a1a] leading-tight tracking-tight">
          {period.title}
        </h1>
        <div className="mt-3 h-[2px] w-10 bg-[color:var(--primary)] rounded-full" />
        {settings.description && (
          <p className="mt-4 text-[13.5px] text-[#4b5563] leading-relaxed whitespace-pre-line">
            {settings.description}
          </p>
        )}
      </header>

      {/* フォーム */}
      <form onSubmit={handleSubmit} className="space-y-5">
        {isPreview && (
          <div className="p-3 bg-amber-50 border border-amber-300 rounded-lg">
            <p className="text-xs text-amber-900 font-medium">
              ＜プレビューモード＞ 管理者確認用です。実際の回答は送信されません。
            </p>
          </div>
        )}
        {errorMessage && (
          <div
            role="alert"
            className="bg-[color:var(--primary-subtle)] border border-[color:var(--primary)]/30 rounded-lg p-4"
          >
            <p className="text-sm text-[color:var(--primary-dark)]">{errorMessage}</p>
          </div>
        )}

        {/* セクション1: 基本情報 */}
        <section className="bg-white rounded-2xl border border-[#e5e7eb] p-5 sm:p-6">
          <SectionHeading number="01" title="基本情報" />
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[#1a1a1a] mb-2">
                生徒名 <span className="text-[color:var(--primary)] ml-0.5">*</span>
              </label>
              <Input
                type="text"
                value={studentName}
                onChange={(e) => setStudentName(e.target.value)}
                disabled={isSubmitting}
                placeholder="山田太郎"
                className={errors.studentName ? 'border-[color:var(--primary)]' : ''}
              />
              {errors.studentName && (
                <p className="text-xs text-[color:var(--primary-dark)] mt-1.5">
                  {errors.studentName}
                </p>
              )}
            </div>

            <div>
              <Select
                label="学年"
                value={selectedGrade}
                onChange={(e) => setSelectedGrade(e.target.value)}
                options={[
                  { value: '', label: '選択してください' },
                  ...grades.map((grade) => ({ value: grade, label: grade })),
                ]}
                error={errors.grade}
                required
                disabled={isSubmitting}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#1a1a1a] mb-2">
                保護者メールアドレス <span className="text-[color:var(--primary)] ml-0.5">*</span>
              </label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isSubmitting}
                placeholder="parent@example.com"
                className={errors.email ? 'border-[color:var(--primary)]' : ''}
              />
              {errors.email && (
                <p className="text-xs text-[color:var(--primary-dark)] mt-1.5">{errors.email}</p>
              )}
            </div>
          </div>
        </section>

        {/* セクション2: 日程・会場 */}
        <section className="bg-white rounded-2xl border border-[#e5e7eb] p-5 sm:p-6">
          <SectionHeading number="02" title="受験日程・会場選択" />
          <p className="text-xs text-[#6b7280] mb-4 -mt-2">
            受験する日程と会場を選択してください（複数選択可）
          </p>
          <DateVenueSelector
            dates={dates}
            selections={selections}
            onChange={setSelections}
            disabled={isSubmitting}
          />
          {errors.selections && (
            <p className="text-xs text-[color:var(--primary-dark)] mt-3">{errors.selections}</p>
          )}
        </section>

        {/* セクション3: 同意 */}
        <section className="bg-white rounded-2xl border border-[#e5e7eb] p-5 sm:p-6">
          <SectionHeading number="03" title="キャンセル不可の同意" />
          <CancelAgreement
            agreed={cancelAgreed}
            onChange={setCancelAgreed}
            disabled={isSubmitting}
            error={errors.cancelAgreed}
          />
        </section>

        {/* 送信ボタン */}
        <div className="flex gap-3 pt-1">
          <button
            type="button"
            onClick={handleReset}
            disabled={isSubmitting}
            className="px-5 py-3 text-sm text-[#4b5563] font-medium rounded-lg border border-[#e5e7eb] hover:bg-[#f8f8f8] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            リセット
          </button>
          <button
            type="submit"
            disabled={isSubmitting || !cancelAgreed}
            className="flex-1 px-6 py-3 bg-[color:var(--primary)] text-white font-semibold rounded-lg hover:bg-[color:var(--primary-dark)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
          >
            {isSubmitting ? '送信中...' : '申し込む'}
          </button>
        </div>
      </form>
    </div>
  );
}

function SectionHeading({ number, title }: { number: string; title: string }) {
  return (
    <div className="flex items-baseline gap-3 mb-5">
      <span className="font-mono text-[11px] text-[color:var(--primary)] font-semibold tracking-widest">
        {number}
      </span>
      <h2 className="text-[15px] font-bold text-[#1a1a1a] tracking-tight">{title}</h2>
    </div>
  );
}
