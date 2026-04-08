'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Input, Select, Button } from '@/components/ui';
import type { School } from '@/types/database';
import { validateStudentName } from '@/lib/utils/validation';
import type {
  MoshiPeriod,
  MoshiResponseData,
} from '@/types/forms/moshi';
import { submitMoshiResponse } from '@/lib/api/moshi';
import { MOSHI_GRADE_NAME_TO_NUMBER } from '@/types/forms/moshi';

interface MoshiFormProps {
  school: School;
  period: MoshiPeriod;
  isPreview?: boolean;
}

type ExamType = 'regular' | 'furikae';

export function MoshiForm({ school, period, isPreview }: MoshiFormProps) {
  const router = useRouter();
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
            お申し込みを受け付けました
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

  // 学年を昇順でソート（小4→中3）
  const sortedGrades = [...(settings.grades || [])].sort((a, b) => {
    const numA = MOSHI_GRADE_NAME_TO_NUMBER[a] ?? 99;
    const numB = MOSHI_GRADE_NAME_TO_NUMBER[b] ?? 99;
    return numA - numB;
  });

  return (
    <div className="max-w-md mx-auto p-4">
      {/* ヘッダー */}
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => router.push(`/portal/${school.code}`)}
          className="text-[#4b5563] hover:text-[#1f2937]"
        >
          ← 戻る
        </button>
        <div className="w-12"></div>
      </div>

      {/* タイトルカード */}
      <div className="bg-white rounded-xl border-2 border-[#e5e7eb] shadow-sm p-6 mb-6">
        <h1 className="text-xl font-bold text-[#1f2937] text-center">模試申込</h1>
        {period.title && (
          <p className="text-sm text-[#4b5563] text-center mt-1">{period.title}</p>
        )}
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
              生徒名 <span className="text-red-500">*</span>
            </label>
            <Input
              type="text"
              value={studentName}
              onChange={(e) => {
                setStudentName(e.target.value);
                if (errors.studentName) setErrors((prev) => { const n = { ...prev }; delete n.studentName; return n; });
              }}
              placeholder="例：山田 太郎"
              className={errors.studentName ? 'border-red-500' : ''}
            />
            {errors.studentName && (
              <p className="text-red-500 text-xs mt-1">{errors.studentName}</p>
            )}
          </div>

          {/* 学年 */}
          <div>
            <label className="block text-sm font-medium mb-1 text-[#1f2937]">
              学年 <span className="text-red-500">*</span>
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
              className={errors.grade ? 'border-red-500' : ''}
            />
            {errors.grade && (
              <p className="text-red-500 text-xs mt-1">{errors.grade}</p>
            )}
          </div>

          {/* メールアドレス */}
          <div>
            <label className="block text-sm font-medium mb-1 text-[#1f2937]">
              メールアドレス <span className="text-red-500">*</span>
            </label>
            <Input
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (errors.email) setErrors((prev) => { const n = { ...prev }; delete n.email; return n; });
              }}
              placeholder="example@email.com"
              className={errors.email ? 'border-red-500' : ''}
            />
            {errors.email && (
              <p className="text-red-500 text-xs mt-1">{errors.email}</p>
            )}
          </div>
        </div>

        {/* 受験方法選択 */}
        <div>
          <label className="block text-sm font-medium mb-3 text-[#1f2937]">
            受験方法 <span className="text-red-500">*</span>
          </label>

          {/* 通常受験 */}
          <label
            className={`block p-4 border rounded-lg mb-3 cursor-pointer transition-colors ${
              examType === 'regular'
                ? 'border-[#3b82f6] bg-orange-50'
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
                  ? 'border-[#3b82f6] bg-orange-50'
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
            <p className="text-red-500 text-xs mt-1">{errors.examType}</p>
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
                  希望日 <span className="text-red-500">*</span>
                </label>
                <Input
                  type="date"
                  value={furikaeDate}
                  onChange={(e) => {
                    setFurikaeDate(e.target.value);
                    if (errors.furikaeDate) setErrors((prev) => { const n = { ...prev }; delete n.furikaeDate; return n; });
                  }}
                  className={errors.furikaeDate ? 'border-red-500' : ''}
                />
                {errors.furikaeDate && (
                  <p className="text-red-500 text-xs mt-1">{errors.furikaeDate}</p>
                )}
              </div>

              {/* 希望時間 */}
              <div>
                <label className="block text-sm font-medium mb-1 text-[#1f2937]">
                  希望時間 <span className="text-red-500">*</span>
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
                  className={errors.furikaeTime ? 'border-red-500' : ''}
                />
                {errors.furikaeTime && (
                  <p className="text-red-500 text-xs mt-1">{errors.furikaeTime}</p>
                )}
              </div>
            </div>
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
          {isSubmitting ? '送信中...' : '申し込む'}
        </Button>
      </form>
    </div>
  );
}
