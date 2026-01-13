'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Input, Select, Button } from '@/components/ui';
import type { School } from '@/types/database';
import type {
  MoshiPeriod,
  MoshiResponseData,
} from '@/types/forms/moshi';
import { submitMoshiResponse } from '@/lib/api/moshi';
import { MOSHI_GRADE_NAME_TO_NUMBER } from '@/types/forms/moshi';

interface MoshiFormProps {
  school: School;
  period: MoshiPeriod;
}

type ExamType = 'regular' | 'furikae';

export function MoshiForm({ school, period }: MoshiFormProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // フォームデータ
  const [studentName, setStudentName] = useState('');
  const [selectedGrade, setSelectedGrade] = useState<string>('');
  const [email, setEmail] = useState('');
  const [examType, setExamType] = useState<ExamType | ''>('');
  const [furikaeDate, setFurikaeDate] = useState('');
  const [furikaeTime, setFurikaeTime] = useState('');
  const [note, setNote] = useState('');

  // バリデーションエラー
  const [errors, setErrors] = useState<Record<string, string>>({});

  // 設定を取得
  const settings = period.settings;

  // 学年が小学生かどうか判定
  const isElementary = (gradeStr: string): boolean => {
    return gradeStr.startsWith('小');
  };

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

    if (!examType) {
      newErrors.examType = '受験方法を選択してください';
    }

    if (examType === 'furikae') {
      if (!furikaeDate) {
        newErrors.furikaeDate = '振替希望日を入力してください';
      } else if (!isWeekday(furikaeDate)) {
        newErrors.furikaeDate = '振替受験は平日のみ可能です';
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

    if (!validate()) {
      return;
    }

    setIsSubmitting(true);
    setErrorMessage('');

    try {
      const gradeNumber = MOSHI_GRADE_NAME_TO_NUMBER[selectedGrade] || 7;

      const responseData: MoshiResponseData = {
        exam_type: examType,
        ...(examType === 'regular'
          ? { regular_confirmed: true }
          : {
              furikae_date: furikaeDate,
              furikae_date_label: formatDateLabel(furikaeDate),
              furikae_time: furikaeTime,
            }),
        note: note.trim() || undefined,
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

  return (
    <div className="max-w-md mx-auto p-4">
      {/* ヘッダー */}
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={() => router.push(`/portal/${school.code}`)}
          className="text-[#2a2a2a] hover:text-[#0d0d0d]"
        >
          ← 戻る
        </button>
        <h1 className="text-xl font-bold text-[#0d0d0d]">模試申込</h1>
        <div className="w-12"></div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
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
            <label className="block text-sm font-medium mb-1 text-[#0d0d0d]">
              生徒名 <span className="text-red-500">*</span>
            </label>
            <Input
              type="text"
              value={studentName}
              onChange={(e) => setStudentName(e.target.value)}
              placeholder="例：山田 太郎"
              className={errors.studentName ? 'border-red-500' : ''}
            />
            {errors.studentName && (
              <p className="text-red-500 text-xs mt-1">{errors.studentName}</p>
            )}
          </div>

          {/* 学年 */}
          <div>
            <label className="block text-sm font-medium mb-1 text-[#0d0d0d]">
              学年 <span className="text-red-500">*</span>
            </label>
            <Select
              value={selectedGrade}
              onChange={(e) => setSelectedGrade(e.target.value)}
              options={[
                { value: '', label: '選択してください' },
                ...settings.grades.map((g) => ({ value: g, label: g })),
              ]}
              className={errors.grade ? 'border-red-500' : ''}
            />
            {errors.grade && (
              <p className="text-red-500 text-xs mt-1">{errors.grade}</p>
            )}
          </div>

          {/* メールアドレス */}
          <div>
            <label className="block text-sm font-medium mb-1 text-[#0d0d0d]">
              メールアドレス <span className="text-red-500">*</span>
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
        </div>

        {/* 受験方法選択 */}
        <div>
          <label className="block text-sm font-medium mb-3 text-[#0d0d0d]">
            受験方法 <span className="text-red-500">*</span>
          </label>

          {/* 通常受験 */}
          <label
            className={`block p-4 border rounded-lg mb-3 cursor-pointer transition-colors ${
              examType === 'regular'
                ? 'border-[#ff8e3c] bg-orange-50'
                : 'border-gray-300 hover:bg-gray-50'
            }`}
          >
            <div className="flex items-start gap-3">
              <input
                type="radio"
                name="examType"
                value="regular"
                checked={examType === 'regular'}
                onChange={(e) => setExamType(e.target.value as ExamType)}
                className="mt-1"
              />
              <div>
                <span className="font-medium text-[#0d0d0d]">
                  {settings.exam_date_label} {settings.exam_time}
                </span>
                <span className="block text-sm text-[#2a2a2a] mt-1">
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
                  ? 'border-[#ff8e3c] bg-orange-50'
                  : 'border-gray-300 hover:bg-gray-50'
              }`}
            >
              <div className="flex items-start gap-3">
                <input
                  type="radio"
                  name="examType"
                  value="furikae"
                  checked={examType === 'furikae'}
                  onChange={(e) => setExamType(e.target.value as ExamType)}
                  className="mt-1"
                />
                <span className="font-medium text-[#0d0d0d]">振替受験を希望します</span>
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
              <div className="mb-4 text-sm text-[#2a2a2a]">
                <p className="font-medium mb-2">振替受験について</p>
                <ul className="list-disc list-inside space-y-1">
                  {settings.furikae?.note && (
                    <li>{settings.furikae.note}</li>
                  )}
                  {selectedGrade && (
                    <li>
                      {isElementary(selectedGrade) ? '小学生' : '中学生'}の目安時間：
                      <strong>
                        {isElementary(selectedGrade)
                          ? settings.furikae?.time_guide?.elementary
                          : settings.furikae?.time_guide?.middle}
                      </strong>
                    </li>
                  )}
                </ul>
              </div>

              {/* 希望日 */}
              <div className="mb-4">
                <label className="block text-sm font-medium mb-1 text-[#0d0d0d]">
                  希望日 <span className="text-red-500">*</span>
                </label>
                <Input
                  type="date"
                  value={furikaeDate}
                  onChange={(e) => setFurikaeDate(e.target.value)}
                  className={errors.furikaeDate ? 'border-red-500' : ''}
                />
                {furikaeDate && (
                  <p className={`text-sm mt-1 ${
                    isWeekday(furikaeDate) ? 'text-[#2a2a2a]' : 'text-red-600'
                  }`}>
                    → {formatDateLabel(furikaeDate)}
                    {!isWeekday(furikaeDate) && '（平日を選択してください）'}
                  </p>
                )}
                {errors.furikaeDate && (
                  <p className="text-red-500 text-xs mt-1">{errors.furikaeDate}</p>
                )}
              </div>

              {/* 希望時間 */}
              <div>
                <label className="block text-sm font-medium mb-1 text-[#0d0d0d]">
                  希望時間 <span className="text-red-500">*</span>
                </label>
                <Select
                  value={furikaeTime}
                  onChange={(e) => setFurikaeTime(e.target.value)}
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

        {/* 備考 */}
        <div>
          <label className="block text-sm font-medium mb-1 text-[#0d0d0d]">備考</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="ご要望等あればご記入ください"
            rows={3}
            className="w-full border border-[#0d0d0d] rounded-lg px-3 py-2 resize-y text-sm"
          />
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
