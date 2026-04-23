'use client';

import { useState, useRef } from 'react';
import { Input, Select } from '@/components/ui';
import type { School } from '@/types/database';
import { validateStudentName } from '@/lib/utils/validation';
import type {
  MoshiPeriod,
  MoshiResponseData,
} from '@/types/forms/moshi';
import { submitMoshiResponse } from '@/lib/api/moshi';
import { MOSHI_GRADE_NAME_TO_NUMBER } from '@/types/forms/moshi';
import {
  PortalFormHeader,
  PortalFormSection,
  PortalFormActions,
  PortalCompletionView,
  PortalErrorBanner,
  PortalPreviewBanner,
  usePortalFormDraft,
} from '@/components/forms/shared';

interface MoshiFormProps {
  school: School;
  period: MoshiPeriod;
  isPreview?: boolean;
}

type ExamType = 'regular' | 'furikae';

export function MoshiForm({ school, period, isPreview }: MoshiFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // フォームデータ
  const [studentName, setStudentName] = useState('');
  const [selectedGrade, setSelectedGrade] = useState<string>('');
  const [email, setEmail] = useState('');
  const [examType, setExamType] = useState<ExamType | ''>('');
  const [furikaeDate, setFurikaeDate] = useState('');
  const [furikaeTime, setFurikaeTime] = useState('');

  // バリデーションエラー
  const [errors, setErrors] = useState<Record<string, string>>({});

  // 設定を取得
  const settings = period.settings;

  // ドラフト自動保存
  const { clearDraft } = usePortalFormDraft({
    storageKey: `moshi:${school.id}:${period.period_key}`,
    enabled: !isPreview,
    value: { studentName, selectedGrade, email, examType, furikaeDate, furikaeTime },
    onRestore: (d) => {
      if (d.studentName) setStudentName(d.studentName);
      if (d.selectedGrade) setSelectedGrade(d.selectedGrade);
      if (d.email) setEmail(d.email);
      if (d.examType) setExamType(d.examType);
      if (d.furikaeDate) setFurikaeDate(d.furikaeDate);
      if (d.furikaeTime) setFurikaeTime(d.furikaeTime);
    },
  });

  // 受験日が土曜日かどうか
  const examDayOfWeek = settings.exam_date ? new Date(settings.exam_date).getDay() : -1;
  const isExamOnSaturday = examDayOfWeek === 6;

  // 日付から曜日を取得
  const getDayOfWeek = (dateStr: string): string => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return ['日', '月', '火', '水', '木', '金', '土'][date.getDay()];
  };

  // 日付ラベルを生成
  const formatDateLabel = (dateStr: string): string => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const dayOfWeek = getDayOfWeek(dateStr);
    return `${month}月${day}日（${dayOfWeek}）`;
  };

  // 平日チェック
  const isWeekday = (dateStr: string): boolean => {
    if (!dateStr) return false;
    const date = new Date(dateStr);
    const day = date.getDay();
    return day >= 1 && day <= 5; // 月〜金
  };

  // 時間選択肢
  const timeOptions = [
    '14:00', '14:30', '15:00', '15:30', '16:00', '16:30',
    '17:00', '17:30', '18:00', '18:30', '19:00'
  ];

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

    if (!examType) {
      newErrors.examType = '受験方法を選択してください';
    }

    if (examType === 'furikae') {
      if (!furikaeDate) {
        newErrors.furikaeDate = '振替希望日を入力してください';
      } else {
        // 土曜日試験の場合、受験当日（同じ日）のみ時間変更として許可
        const isExamDay = isExamOnSaturday && furikaeDate === settings.exam_date;
        if (!isWeekday(furikaeDate) && !isExamDay) {
          newErrors.furikaeDate = '振替受験は平日のみ可能です';
        }
      }
      if (!furikaeTime) {
        newErrors.furikaeTime = '希望時間を選択してください';
      }
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
      const gradeNumber = MOSHI_GRADE_NAME_TO_NUMBER[selectedGrade] || 7;

      const responseData: MoshiResponseData = {
        exam_type: examType as 'regular' | 'furikae',
        ...(examType === 'regular'
          ? { regular_confirmed: true }
          : {
              furikae_date: furikaeDate,
              furikae_date_label: formatDateLabel(furikaeDate),
              furikae_time: furikaeTime,
            }),
      };

      await submitMoshiResponse({
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
        completionMessage={settings.completion_message}
      />
    );
  }

  // 学年を昇順でソート（小4→中3）
  const sortedGrades = [...(settings.grades || [])].sort((a, b) => {
    const numA = MOSHI_GRADE_NAME_TO_NUMBER[a] ?? 99;
    const numB = MOSHI_GRADE_NAME_TO_NUMBER[b] ?? 99;
    return numA - numB;
  });

  return (
    <div className="space-y-5">
      <PortalFormHeader
        eyebrow="オープン模試 申し込み"
        title={period.title || 'オープン模試申し込み'}
        description={settings.description}
      />

      <form onSubmit={handleSubmit} className="space-y-5">
        {isPreview && <PortalPreviewBanner />}

        <PortalFormSection title="基本情報">
        <div className="space-y-4">
          {/* 生徒名 */}
          <div>
            <label className="block text-sm font-medium mb-1 text-[#1f2937]">
              生徒名 <span className="text-[color:var(--primary)]">*</span>
            </label>
            <Input
              type="text"
              value={studentName}
              onChange={(e) => {
                setStudentName(e.target.value);
                if (errors.studentName) setErrors((prev) => { const n = { ...prev }; delete n.studentName; return n; });
              }}
              placeholder="例：山田 太郎"
              className={errors.studentName ? 'border-[color:var(--primary)]' : ''}
            />
            {errors.studentName && (
              <p className="text-[color:var(--primary)] text-xs mt-1">{errors.studentName}</p>
            )}
          </div>

          {/* 学年 */}
          <div>
            <label className="block text-sm font-medium mb-1 text-[#1f2937]">
              学年 <span className="text-[color:var(--primary)]">*</span>
            </label>
            <Select
              value={selectedGrade}
              onChange={(e) => {
                setSelectedGrade(e.target.value);
                if (errors.grade) setErrors((prev) => { const n = { ...prev }; delete n.grade; return n; });
              }}
              options={[
                { value: '', label: '選択してください' },
                ...sortedGrades.map((g) => ({ value: g, label: g })),
              ]}
              className={errors.grade ? 'border-[color:var(--primary)]' : ''}
            />
            {errors.grade && (
              <p className="text-[color:var(--primary)] text-xs mt-1">{errors.grade}</p>
            )}
          </div>

          {/* メールアドレス */}
          <div>
            <label className="block text-sm font-medium mb-1 text-[#1f2937]">
              メールアドレス <span className="text-[color:var(--primary)]">*</span>
            </label>
            <Input
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (errors.email) setErrors((prev) => { const n = { ...prev }; delete n.email; return n; });
              }}
              placeholder="example@email.com"
              className={errors.email ? 'border-[color:var(--primary)]' : ''}
            />
            {errors.email && (
              <p className="text-[color:var(--primary)] text-xs mt-1">{errors.email}</p>
            )}
          </div>
        </div>
        </PortalFormSection>

        <PortalFormSection title="受験方法">
        <div>
          <label className="sr-only">
            受験方法 <span className="text-[color:var(--primary)]">*</span>
          </label>

          {/* 通常受験 */}
          <label
            className={`block p-4 border rounded-lg mb-3 cursor-pointer transition-colors ${
              examType === 'regular'
                ? 'border-[color:var(--primary)] bg-[color:var(--primary-subtle)]'
                : 'border-gray-300 hover:bg-gray-50'
            }`}
          >
            <div className="flex items-start gap-3">
              <input
                type="radio"
                name="examType"
                value="regular"
                checked={examType === 'regular'}
                onChange={(e) => {
                  setExamType(e.target.value as ExamType);
                  if (errors.examType) setErrors((prev) => { const n = { ...prev }; delete n.examType; return n; });
                }}
                className="mt-1"
              />
              <div>
                <span className="font-medium text-[#1f2937]">
                  {settings.exam_date_label}
                  {settings.exam_time ? ` ${settings.exam_time}` : ''}
                </span>
                <span className="block text-sm text-[#4b5563] mt-1">
                  の模試に参加します
                </span>
              </div>
            </div>
          </label>

          {/* 振替受験 */}
          {settings.furikae?.enabled && (
            <label
              className={`block p-4 border rounded-lg cursor-pointer transition-colors ${
                examType === 'furikae'
                  ? 'border-[color:var(--primary)] bg-[color:var(--primary-subtle)]'
                  : 'border-gray-300 hover:bg-gray-50'
              }`}
            >
              <div className="flex items-start gap-3">
                <input
                  type="radio"
                  name="examType"
                  value="furikae"
                  checked={examType === 'furikae'}
                  onChange={(e) => {
                    setExamType(e.target.value as ExamType);
                    if (errors.examType) setErrors((prev) => { const n = { ...prev }; delete n.examType; return n; });
                  }}
                  className="mt-1"
                />
                <div>
                  <span className="font-medium text-[#1f2937]">振替受験を希望します</span>
                  <span className="block text-sm text-[#4b5563] mt-1">
                    当日の時間変更を希望の場合もこちら
                  </span>
                </div>
              </div>
            </label>
          )}

          {errors.examType && (
            <p className="text-[color:var(--primary)] text-xs mt-1">{errors.examType}</p>
          )}

          {/* 振替受験詳細入力 */}
          {examType === 'furikae' && (
            <div className="mt-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
              {/* 注意事項 */}
              <div className="mb-4 text-sm text-[#4b5563]">
                <p className="font-medium mb-2">振替受験について</p>
                <ul className="list-disc list-inside space-y-1">
                  {settings.furikae?.note && (
                    <li>{settings.furikae.note}</li>
                  )}
                  {isExamOnSaturday && (
                    <li>受験当日（{settings.exam_date_label}）の時間変更もこちらからお申し込みください。</li>
                  )}
                  <li>
                    小学生の目安時間：<strong>{settings.furikae?.time_guide?.elementary ?? '約2時間'}</strong>
                  </li>
                  <li>
                    中学生の目安時間：<strong>{settings.furikae?.time_guide?.middle ?? '約3時間'}</strong>
                  </li>
                </ul>
              </div>

              {/* 希望日 */}
              <div className="mb-4">
                <label className="block text-sm font-medium mb-1 text-[#1f2937]">
                  希望日 <span className="text-[color:var(--primary)]">*</span>
                </label>
                <Input
                  type="date"
                  value={furikaeDate}
                  onChange={(e) => {
                    setFurikaeDate(e.target.value);
                    if (errors.furikaeDate) setErrors((prev) => { const n = { ...prev }; delete n.furikaeDate; return n; });
                  }}
                  className={errors.furikaeDate ? 'border-[color:var(--primary)]' : ''}
                />
                {errors.furikaeDate && (
                  <p className="text-[color:var(--primary)] text-xs mt-1">{errors.furikaeDate}</p>
                )}
              </div>

              {/* 希望時間 */}
              <div>
                <label className="block text-sm font-medium mb-1 text-[#1f2937]">
                  希望時間 <span className="text-[color:var(--primary)]">*</span>
                </label>
                <Select
                  value={furikaeTime}
                  onChange={(e) => {
                    setFurikaeTime(e.target.value);
                    if (errors.furikaeTime) setErrors((prev) => { const n = { ...prev }; delete n.furikaeTime; return n; });
                  }}
                  options={[
                    { value: '', label: '選択してください' },
                    ...timeOptions.map((time) => ({ value: time, label: `${time}〜` })),
                  ]}
                  className={errors.furikaeTime ? 'border-[color:var(--primary)]' : ''}
                />
                {errors.furikaeTime && (
                  <p className="text-[color:var(--primary)] text-xs mt-1">{errors.furikaeTime}</p>
                )}
              </div>
            </div>
          )}
        </div>
        </PortalFormSection>

        {errorMessage && <PortalErrorBanner message={errorMessage} />}

        <PortalFormActions isSubmitting={isSubmitting} />
      </form>
    </div>
  );
}
