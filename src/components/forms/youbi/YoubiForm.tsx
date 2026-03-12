'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Input, Select, Button } from '@/components/ui';
import { ToastContainer } from '@/components/ui/Toast';
import type { School } from '@/types/database';
import type {
  YoubiPeriod,
  YoubiResponseData,
  YoubiSlot,
} from '@/types/forms/youbi';
import { submitYoubiResponse } from '@/lib/api/youbi';
import { getSubjects } from '@/lib/api/subjects';
import { YOUBI_GRADE_NAME_TO_NUMBER } from '@/types/forms/youbi';
import { useToast } from '@/hooks/useToast';

interface YoubiFormProps {
  school: School;
  period: YoubiPeriod;
  isPreview?: boolean;
}

const GRADES = ['小1', '小2', '小3', '小4', '小5', '小6', '中1', '中2', '中3', '高1', '高2', '高3'];

function gradeToCategory(gradeLabel: string): 'elementary' | 'middle' | 'high' | null {
  if (!gradeLabel) return null;
  if (gradeLabel.startsWith('小')) return 'elementary';
  if (gradeLabel.startsWith('中')) return 'middle';
  if (gradeLabel.startsWith('高')) return 'high';
  return null;
}

export function YoubiForm({ school, period, isPreview }: YoubiFormProps) {
  const router = useRouter();
  const { toasts, removeToast, success, error } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  // 基本情報
  const [studentName, setStudentName] = useState('');
  const [selectedGrade, setSelectedGrade] = useState<string>('');
  const [email, setEmail] = useState('');

  // 現状
  const [current, setCurrent] = useState<YoubiSlot>({
    day: '',
    period: '',
    period_label: '',
    subject: '',
  });

  // 第1希望
  const [request1, setRequest1] = useState<YoubiSlot>({
    day: '',
    period: '',
    period_label: '',
    subject: '',
  });

  // 第2希望
  const [request2, setRequest2] = useState<YoubiSlot>({
    day: '',
    period: '',
    period_label: '',
    subject: '',
  });

  // 変更希望日・備考
  const [changeFrom, setChangeFrom] = useState('');
  const [note, setNote] = useState('');

  // 学年に応じた科目オプション（共通科目を小学/中学/高校で自動参照）
  // value は "科目名|||duration" 形式（同名科目の誤判定防止）
  const [subjectOptionsForGrade, setSubjectOptionsForGrade] = useState<Array<{ value: string; label: string }>>([]);
  const [isLoadingSubjects, setIsLoadingSubjects] = useState(false);

  // バリデーションエラー
  const [errors, setErrors] = useState<Record<string, string>>({});

  // 設定を取得
  const settings = period.settings;

  // 学年変更時に共通科目を取得（科目設定＝subjects テーブルを常に参照し自動更新）
  useEffect(() => {
    const category = gradeToCategory(selectedGrade);
    if (!category) {
      setSubjectOptionsForGrade([]);
      setSubjectDurationMap({});
      return;
    }
    setIsLoadingSubjects(true);
    getSubjects(category)
      .then((subjects) => {
        // 小5以上（学年番号5以上）は45分科目を非表示
        const gradeNum = YOUBI_GRADE_NAME_TO_NUMBER[selectedGrade] ?? 0;
        const isGrade5Plus = gradeNum >= 5;
        const displaySubjects = isGrade5Plus
          ? subjects.filter(s => (s.duration_minutes ?? 90) !== 45)
          : subjects;
        // value に duration を埋め込む → 同名科目が複数あっても正しいdurationを保持
        const options = displaySubjects.map(s => {
          const dur = s.duration_minutes ?? 90;
          return {
            value: `${s.name}|||${dur}`,
            label: dur === 45 ? `${s.name}（45分）` : s.name,
          };
        });
        setSubjectOptionsForGrade(options);
      })
      .catch(() => {
        setSubjectOptionsForGrade([]);
      })
      .finally(() => setIsLoadingSubjects(false));
  }, [selectedGrade]);

  // 学年を変えたらスロットの科目をクリア
  const prevGradeRef = useRef<string>('');
  useEffect(() => {
    if (prevGradeRef.current !== selectedGrade && selectedGrade) {
      setCurrent((prev) => ({ ...prev, subject: '' }));
      setRequest1((prev) => ({ ...prev, subject: '' }));
      setRequest2((prev) => ({ ...prev, subject: '' }));
      prevGradeRef.current = selectedGrade;
    }
    if (!selectedGrade) prevGradeRef.current = '';
  }, [selectedGrade]);

  const getPeriodLabel = (code: string): string => {
    return settings.available_periods.find((p) => p.code === code)?.label || code;
  };

  // 学年を数値に変換
  const gradeToNumber = (gradeStr: string): number => {
    return YOUBI_GRADE_NAME_TO_NUMBER[gradeStr] || 0;
  };

  // 日付ラベルを生成
  const formatDateLabel = (dateStr: string): string => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const dow = ['日', '月', '火', '水', '木', '金', '土'][date.getDay()];
    return `${month}月${day}日（${dow}）〜`;
  };

  // "科目名|||duration" 形式のoption valueをパースするヘルパー
  const parseSubjectOptionValue = (encoded: string): { name: string; duration: number } => {
    const sepIdx = encoded.lastIndexOf('|||');
    if (sepIdx !== -1) {
      return {
        name: encoded.slice(0, sepIdx),
        duration: parseInt(encoded.slice(sepIdx + 3)) || 90,
      };
    }
    return { name: encoded, duration: 90 };
  };

  // スロットの更新
  const updateSlot = (
    slot: YoubiSlot,
    setSlot: (s: YoubiSlot) => void,
    field: keyof YoubiSlot,
    value: string
  ) => {
    const updated = { ...slot, [field]: value };
    // periodが変更されたらperiod_labelも更新
    if (field === 'period') {
      updated.period_label = getPeriodLabel(value);
    }
    // subjectが変更されたら "名前|||duration" をパースして分離
    if (field === 'subject') {
      const { name, duration } = parseSubjectOptionValue(value);
      updated.subject = name;
      updated.duration_minutes = name ? duration : undefined;
    }
    setSlot(updated);
  };

  // スロットのバリデーション
  const validateSlot = (slot: YoubiSlot, label: string): boolean => {
    if (!slot.day) {
      error(`${label}の曜日を選択してください`);
      return false;
    }
    if (!slot.period) {
      error(`${label}の時限を選択してください`);
      return false;
    }
    if (!slot.subject) {
      error(`${label}の科目を選択してください`);
      return false;
    }
    return true;
  };

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

    if (!validateSlot(current, '現在の通塾情報')) {
      return false;
    }

    if (!validateSlot(request1, '第1希望')) {
      return false;
    }

    if (!validateSlot(request2, '第2希望')) {
      return false;
    }

    if (!changeFrom) {
      newErrors.changeFrom = '変更希望日を入力してください';
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

    try {
      const responseData: YoubiResponseData = {
        current: {
          ...current,
          period_label: current.period_label || getPeriodLabel(current.period),
        },
        request1: {
          ...request1,
          period_label: request1.period_label || getPeriodLabel(request1.period),
        },
        request2: {
          ...request2,
          period_label: request2.period_label || getPeriodLabel(request2.period),
        },
        change_from: changeFrom,
        change_from_label: formatDateLabel(changeFrom),
        note: note.trim() || undefined,
      };

      await submitYoubiResponse({
        school_id: school.id,
        period_key: period.period_key,
        student_name: studentName.trim(),
        grade: gradeToNumber(selectedGrade),
        email: email.trim(),
        response_data: responseData,
      });

      setIsSubmitted(true);
      success('申請を受け付けました');
    } catch (err) {
      console.error('Failed to submit:', err);
      error(
        err instanceof Error
          ? err.message
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
        <ToastContainer toasts={toasts} onRemove={removeToast} />
        <div className="bg-green-50 border border-green-200 rounded-lg p-6 text-center">
          <div className="text-4xl mb-4">✓</div>
          <h2 className="text-xl font-bold text-green-800 mb-4">
            申請を受け付けました
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

  // スロット入力UI（共通）
  const renderSlotInput = (
    slot: YoubiSlot,
    setSlot: (s: YoubiSlot) => void,
    label: string,
    highlight?: string,
    required?: boolean
  ) => (
    <div
      className={`p-4 rounded-lg border ${
        highlight || 'border-gray-200 bg-gray-50'
      }`}
    >
      <p className="text-sm font-medium text-[#1f2937] mb-3">
        {label}{required && <span className="text-red-500 ml-1">*</span>}
      </p>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="block text-xs text-[#4b5563]/60 mb-1">曜日</label>
          <Select
            value={slot.day}
            onChange={(e) => updateSlot(slot, setSlot, 'day', e.target.value)}
            options={[
              { value: '', label: '選択' },
              ...settings.available_days.map((d) => ({ value: d, label: d })),
            ]}
            className="text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-[#4b5563]/60 mb-1">時限</label>
          <Select
            value={slot.period}
            onChange={(e) => updateSlot(slot, setSlot, 'period', e.target.value)}
            options={[
              { value: '', label: '選択' },
              ...settings.available_periods.map((p) => ({
                value: p.code,
                label: p.label,
              })),
            ]}
            className="text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-[#4b5563]/60 mb-1">科目</label>
          <Select
            value={slot.subject ? `${slot.subject}|||${slot.duration_minutes ?? 90}` : ''}
            onChange={(e) => updateSlot(slot, setSlot, 'subject', e.target.value)}
            options={[
              { value: '', label: selectedGrade ? (isLoadingSubjects ? '読み込み中...' : '科目') : '学年を選んでください' },
              ...subjectOptionsForGrade,
            ]}
            className="text-sm"
          />
          {slot.subject && slot.duration_minutes === 45 && (
            <span className="mt-1 inline-block text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">
              45分授業
            </span>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="max-w-md mx-auto p-4">
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      {/* ヘッダー */}
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={() => router.push(`/portal/${school.code}`)}
          className="text-[#4b5563] hover:text-[#1f2937]"
        >
          ← 戻る
        </button>
        <h1 className="text-xl font-bold text-[#1f2937]">曜日変更</h1>
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
        <section>
          <h3 className="text-sm font-semibold text-[#1f2937] mb-3 border-b border-[#e5e7eb] pb-1">
            基本情報
          </h3>
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium mb-1 text-[#1f2937]">
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
            <div>
              <label className="block text-sm font-medium mb-1 text-[#1f2937]">
                学年 <span className="text-red-500">*</span>
              </label>
              <Select
                value={selectedGrade}
                onChange={(e) => setSelectedGrade(e.target.value)}
                options={[
                  { value: '', label: '選択してください' },
                  ...GRADES.map((g) => ({ value: g, label: g })),
                ]}
                className={errors.grade ? 'border-red-500' : ''}
              />
              {errors.grade && (
                <p className="text-red-500 text-xs mt-1">{errors.grade}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 text-[#1f2937]">
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
        </section>

        {/* 現状 */}
        <section>
          <h3 className="text-sm font-semibold text-[#1f2937] mb-3 border-b border-[#e5e7eb] pb-1">
            現在の通塾情報 <span className="text-red-500">*</span>
          </h3>
          {renderSlotInput(current, setCurrent, '現在通っている曜日・時間・科目')}
        </section>

        {/* 変更希望 */}
        <section>
          <h3 className="text-sm font-semibold text-[#1f2937] mb-3 border-b border-[#e5e7eb] pb-1">
            変更希望 <span className="text-red-500">*</span>
          </h3>
          <div className="space-y-3">
            {renderSlotInput(
              request1,
              setRequest1,
              '第1希望',
              'border-[#3b82f6] bg-orange-50'
            )}
            {renderSlotInput(request2, setRequest2, '第2希望', 'border-gray-300 bg-white', true)}
          </div>
        </section>

        {/* 変更希望日 */}
        <section>
          <h3 className="text-sm font-semibold text-[#1f2937] mb-3 border-b border-[#e5e7eb] pb-1">
            変更希望日 <span className="text-red-500">*</span>
          </h3>
          <div>
            <label className="block text-sm font-medium mb-1 text-[#1f2937]">
              いつから変更を希望しますか？
            </label>
            <Input
              type="date"
              value={changeFrom}
              onChange={(e) => setChangeFrom(e.target.value)}
              className={errors.changeFrom ? 'border-red-500' : ''}
            />
            {changeFrom && (
              <p className="text-sm text-[#4b5563] mt-1">→ {formatDateLabel(changeFrom)}</p>
            )}
            {errors.changeFrom && (
              <p className="text-red-500 text-xs mt-1">{errors.changeFrom}</p>
            )}
          </div>
        </section>

        {/* 備考 */}
        <section>
          <label className="block text-sm font-medium mb-1 text-[#1f2937]">備考</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="ご要望等あればご記入ください"
            rows={3}
            className="w-full border border-[#e5e7eb] rounded-lg px-3 py-2 resize-y text-sm"
          />
        </section>

        {/* 送信ボタン */}
        <Button type="submit" disabled={isSubmitting} className="w-full">
          {isSubmitting ? '送信中...' : '申請する'}
        </Button>
      </form>
    </div>
  );
}
