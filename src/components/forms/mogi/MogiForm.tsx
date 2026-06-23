'use client';

import { useState, useRef } from 'react';
import { Input, Select } from '@/components/ui';
import type { School } from '@/types/database';
import { validateStudentName } from '@/lib/utils/validation';
import type { MogiPeriod, MogiResponseData, DateVenueSelection } from '@/types/forms/mogi';
import { submitMogiResponse } from '@/lib/api/mogi';
import { GRADE_NAME_TO_NUMBER, MOGI_REGION_FORM_TITLES } from '@/types/forms/mogi';
import { DateVenueSelector } from './DateVenueSelector';
import { CancelAgreement } from './CancelAgreement';
import {
  PortalFormHeader,
  PortalFormSection,
  PortalFormActions,
  PortalCompletionView,
  PortalErrorBanner,
  PortalPreviewBanner,
  usePortalFormDraft,
} from '@/components/forms/shared';

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

  // ドラフト自動保存
  const { clearDraft } = usePortalFormDraft({
    storageKey: `mogi:${school.id}:${period.period_key}`,
    enabled: !isPreview,
    value: { studentName, selectedGrade, email, selections, cancelAgreed },
    onRestore: (d) => {
      if (d.studentName) setStudentName(d.studentName);
      if (d.selectedGrade) setSelectedGrade(d.selectedGrade);
      if (d.email) setEmail(d.email);
      if (d.selections?.length) setSelections(d.selections);
      if (d.cancelAgreed) setCancelAgreed(d.cancelAgreed);
    },
  });

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

      clearDraft();
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
      <PortalCompletionView
        schoolCode={school.code ?? ''}
        completionMessage={settings.completion_message}
      />
    );
  }

  return (
    <div className="space-y-5">
      <PortalFormHeader
        eyebrow={MOGI_REGION_FORM_TITLES[settings.region ?? 'tokyo'].eyebrow}
        title={period.title || MOGI_REGION_FORM_TITLES[settings.region ?? 'tokyo'].title}
        description={settings.description}
      />

      <form onSubmit={handleSubmit} className="space-y-5">
        {isPreview && <PortalPreviewBanner />}
        {errorMessage && <PortalErrorBanner message={errorMessage} />}

        <PortalFormSection title="基本情報">
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
        </PortalFormSection>

        <PortalFormSection
          title="受験日程・会場選択"
          description="受験する日程と会場を選択してください（複数選択可・1日につき1種別まで）"
        >
          {(settings.region ?? 'tokyo') === 'tokyo' && (
            <div className="mb-4 p-3 bg-[#fff7ed] border border-[#fed7aa] rounded-lg text-sm text-[#9a3412]">
              <p className="font-semibold mb-1">会場選択についてのご注意</p>
              <p className="text-xs leading-relaxed">
                定員に達し次第、抽選で会場が決まります。抽選に漏れた場合は、進学研究会が近隣の別会場に割り振ります。
              </p>
            </div>
          )}
          <DateVenueSelector
            dates={dates}
            selections={selections}
            onChange={setSelections}
            disabled={isSubmitting}
          />
          {errors.selections && (
            <p className="text-xs text-[color:var(--primary-dark)] mt-3">{errors.selections}</p>
          )}
        </PortalFormSection>

        <PortalFormSection title="キャンセル不可の同意">
          <CancelAgreement
            agreed={cancelAgreed}
            onChange={setCancelAgreed}
            disabled={isSubmitting}
            error={errors.cancelAgreed}
            region={settings.region ?? 'tokyo'}
          />
        </PortalFormSection>

        <PortalFormActions
          onReset={handleReset}
          isSubmitting={isSubmitting}
          submitDisabled={!cancelAgreed}
        />
      </form>
    </div>
  );
}
