'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { Input, Select } from '@/components/ui';
import { fetchClassPeriodsLive, type ClassPeriodItem } from '@/lib/api/class-periods';
import { ToastContainer } from '@/components/ui/Toast';
import {
  PortalFormHeader,
  PortalFormSection,
  PortalFormActions,
  PortalCompletionView,
  PortalPreviewBanner,
  usePortalFormDraft,
} from '@/components/forms/shared';
import type { School } from '@/types/database';
import { validateStudentName } from '@/lib/utils/validation';
import type {
  ShukaisuPeriod,
  ShukaisuResponseData,
  ShukaisuSlot,
} from '@/types/forms/shukaisu';
import { submitShukaisuResponse } from '@/lib/api/shukaisu';
import { getSubjects } from '@/lib/api/subjects';
import { SHUKAISU_GRADE_NAME_TO_NUMBER } from '@/types/forms/shukaisu';
import { useToast } from '@/hooks/useToast';

interface ShukaisuFormProps {
  school: School;
  period: ShukaisuPeriod;
  isPreview?: boolean;
}

const GRADES = ['小1', '小2', '小3', '小4', '小5', '小6', '中1', '中2', '中3', '高1', '高2', '高3'];

// 学年ラベル → 共通科目の grade_category
function gradeToCategory(gradeLabel: string): 'elementary' | 'middle' | 'high' | null {
  if (!gradeLabel) return null;
  if (gradeLabel.startsWith('小')) return 'elementary';
  if (gradeLabel.startsWith('中')) return 'middle';
  if (gradeLabel.startsWith('高')) return 'high';
  return null;
}

export function ShukaisuForm({ school, period, isPreview }: ShukaisuFormProps) {
  const { toasts, removeToast, success, error } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  // 基本情報
  const [studentName, setStudentName] = useState('');
  const [selectedGrade, setSelectedGrade] = useState<string>('');
  const [email, setEmail] = useState('');

  // 現状
  const [currentWeekly, setCurrentWeekly] = useState<number>(1);
  const [currentSlots, setCurrentSlots] = useState<ShukaisuSlot[]>([
    { day: '', period: '', period_label: '', subject: '' },
  ]);

  // 変更希望
  const [requestedWeekly, setRequestedWeekly] = useState<number>(1);
  const [requestedSlots, setRequestedSlots] = useState<ShukaisuSlot[]>([
    { day: '', period: '', period_label: '', subject: '' },
  ]);

  // 変更希望日・備考
  const [changeFrom, setChangeFrom] = useState('');
  const [note, setNote] = useState('');

  // 学年に応じた科目オプション（共通科目を小学/中学/高校でフィルタ）
  // value は "科目名|||duration" 形式（同名科目の誤判定防止）
  const [subjectOptionsForGrade, setSubjectOptionsForGrade] = useState<Array<{ value: string; label: string }>>([]);
  const [isLoadingSubjects, setIsLoadingSubjects] = useState(false);

  // バリデーションエラー
  const [errors, setErrors] = useState<Record<string, string>>({});

  // 設定を取得
  const settings = period.settings;

  // 時限はコマ時間マスタ(schedule_time_slots)をライブ参照する。
  // 取得できない場合のみ期間設定のスナップショット(available_periods)にフォールバック。
  const [masterPeriods, setMasterPeriods] = useState<ClassPeriodItem[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchClassPeriodsLive(school.id).then((p) => {
      if (!cancelled) setMasterPeriods(p);
    });
    return () => { cancelled = true; };
  }, [school.id]);

  // 表示する時限リスト。1・2限（昼の時間帯）は週回数変更では対象外のため除外。
  const periodOptions = useMemo(() => {
    const base = masterPeriods && masterPeriods.length > 0 ? masterPeriods : settings.available_periods;
    return base.filter((p) => p.code !== '1' && p.code !== '2');
  }, [masterPeriods, settings.available_periods]);

  // ドラフト自動保存
  const { clearDraft } = usePortalFormDraft({
    storageKey: `shukaisu:${school.id}:${period.period_key}`,
    enabled: !isPreview,
    value: {
      studentName,
      selectedGrade,
      email,
      currentWeekly,
      currentSlots,
      requestedWeekly,
      requestedSlots,
      changeFrom,
      note,
    },
    onRestore: (d) => {
      if (d.studentName) setStudentName(d.studentName);
      if (d.selectedGrade) setSelectedGrade(d.selectedGrade);
      if (d.email) setEmail(d.email);
      if (d.currentWeekly) setCurrentWeekly(d.currentWeekly);
      if (d.currentSlots?.length) setCurrentSlots(d.currentSlots);
      if (d.requestedWeekly) setRequestedWeekly(d.requestedWeekly);
      if (d.requestedSlots?.length) setRequestedSlots(d.requestedSlots);
      if (d.changeFrom) setChangeFrom(d.changeFrom);
      if (d.note) setNote(d.note);
    },
  });

  // 学年変更時に共通科目を取得（科目設定＝subjects テーブルを常に参照し自動更新）
  useEffect(() => {
    const category = gradeToCategory(selectedGrade);
    if (!category) {
      setSubjectOptionsForGrade([]);
      return;
    }
    setIsLoadingSubjects(true);
    getSubjects(category)
      .then((subjects) => {
        // 小5以上（学年番号5以上）は45分科目を非表示
        const gradeNum = SHUKAISU_GRADE_NAME_TO_NUMBER[selectedGrade] ?? 0;
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

  // 学年を変えたらスロットの科目選択をクリア（選択肢が変わるため）
  const prevGradeRef = useRef<string>('');
  useEffect(() => {
    if (prevGradeRef.current !== selectedGrade && selectedGrade) {
      setCurrentSlots((prev) => prev.map((s) => ({ ...s, subject: '' })));
      setRequestedSlots((prev) => prev.map((s) => ({ ...s, subject: '' })));
      prevGradeRef.current = selectedGrade;
    }
    if (!selectedGrade) prevGradeRef.current = '';
  }, [selectedGrade]);

  // 週回数変更時にスロット数を調整
  useEffect(() => {
    setCurrentSlots((prev) => adjustSlots(prev, currentWeekly));
  }, [currentWeekly]);

  useEffect(() => {
    setRequestedSlots((prev) => adjustSlots(prev, requestedWeekly));
  }, [requestedWeekly]);

  const adjustSlots = (slots: ShukaisuSlot[], count: number): ShukaisuSlot[] => {
    if (slots.length === count) return slots;
    if (slots.length < count) {
      return [
        ...slots,
        ...Array(count - slots.length).fill(null).map(() => ({
          day: '',
          period: '',
          period_label: '',
          subject: '',
        })),
      ];
    }
    return slots.slice(0, count);
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

  const updateCurrentSlot = (index: number, field: keyof ShukaisuSlot, value: string) => {
    setCurrentSlots((prev) =>
      prev.map((s, i) => {
        if (i === index) {
          const updated = { ...s, [field]: value };
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
          return updated;
        }
        return s;
      })
    );
  };

  const updateRequestedSlot = (index: number, field: keyof ShukaisuSlot, value: string) => {
    setRequestedSlots((prev) =>
      prev.map((s, i) => {
        if (i === index) {
          const updated = { ...s, [field]: value };
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
          return updated;
        }
        return s;
      })
    );
  };

  const getPeriodLabel = (code: string): string => {
    // マスタ優先、無ければスナップショットからラベルを引く
    const base = masterPeriods && masterPeriods.length > 0 ? masterPeriods : settings.available_periods;
    return base.find((p) => p.code === code)?.label || code;
  };

  // 学年を数値に変換
  const gradeToNumber = (gradeStr: string): number => {
    return SHUKAISU_GRADE_NAME_TO_NUMBER[gradeStr] || 0;
  };

  // 月ラベルを生成（yyyy-MM → ○月〜）
  const formatDateLabel = (dateStr: string): string => {
    if (!dateStr) return '';
    // yyyy-MM 形式
    if (/^\d{4}-\d{2}$/.test(dateStr)) {
      const [y, m] = dateStr.split('-').map(Number);
      return `${y}年${m}月〜`;
    }
    // 旧形式（yyyy-MM-dd）も念のためサポート
    const date = new Date(dateStr);
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const dow = ['日', '月', '火', '水', '木', '金', '土'][date.getDay()];
    return `${month}月${day}日（${dow}）〜`;
  };

  // 変更開始月の最小値（翌月）
  const minChangeMonth = (() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 2; // 翌月（0-indexed +1 で今月、+2 で翌月）
    if (m > 12) return `${y + 1}-01`;
    return `${y}-${String(m).padStart(2, '0')}`;
  })();

  // スロットのバリデーション
  const validateSlots = (slots: ShukaisuSlot[], label: string): boolean => {
    for (let i = 0; i < slots.length; i++) {
      if (!slots[i].day || !slots[i].period || !slots[i].subject) {
        error(`${label}の${i + 1}コマ目を全て入力してください`);
        return false;
      }
    }
    return true;
  };

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

    if (!validateSlots(currentSlots, '現状')) {
      return false;
    }

    if (!validateSlots(requestedSlots, '変更希望')) {
      return false;
    }

    if (!changeFrom) {
      newErrors.changeFrom = '変更開始月を選択してください';
    } else if (changeFrom < minChangeMonth) {
      newErrors.changeFrom = '翌月以降を選択してください';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // フォーム送信
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingRef.current) return;

    if (!validate()) {
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);

    try {
      const responseData: ShukaisuResponseData = {
        current: {
          weekly_count: currentWeekly,
          slots: currentSlots.map((s) => ({
            ...s,
            period_label: s.period_label || getPeriodLabel(s.period),
          })),
        },
        requested: {
          weekly_count: requestedWeekly,
          slots: requestedSlots.map((s) => ({
            ...s,
            period_label: s.period_label || getPeriodLabel(s.period),
          })),
        },
        change_from: changeFrom,
        change_from_label: formatDateLabel(changeFrom),
        note: note.trim() || undefined,
      };

      await submitShukaisuResponse({
        school_id: school.id,
        period_key: period.period_key,
        student_name: studentName.trim(),
        grade: gradeToNumber(selectedGrade),
        email: email.trim(),
        response_data: responseData,
      });

      clearDraft();
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
      <>
        <ToastContainer toasts={toasts} onRemove={removeToast} />
        <PortalCompletionView
          schoolCode={school.code ?? ''}
          title="申請を受け付けました"
          completionMessage={settings.completion_message}
        />
      </>
    );
  }

  // スロット入力UI（共通）
  const renderSlotInputs = (
    slots: ShukaisuSlot[],
    updateFn: (index: number, field: keyof ShukaisuSlot, value: string) => void
  ) => (
    <div className="space-y-3">
      {slots.map((slot, index) => (
        <div key={index} className="p-3 bg-gray-50 rounded-lg border border-gray-200">
          <p className="text-sm font-medium text-[#1f2937] mb-2">{index + 1}コマ目</p>
          <div className="grid grid-cols-3 gap-2">
            <Select
              value={slot.day}
              onChange={(e) => updateFn(index, 'day', e.target.value)}
              options={[
                { value: '', label: '曜日' },
                ...settings.available_days.map((d) => ({ value: d, label: d })),
              ]}
              className="text-sm"
            />
            <Select
              value={slot.period}
              onChange={(e) => updateFn(index, 'period', e.target.value)}
              options={[
                { value: '', label: '時限' },
                ...periodOptions.map((p) => ({
                  value: p.code,
                  label: p.label,
                })),
              ]}
              className="text-sm"
            />
            <div>
              <Select
                value={slot.subject ? `${slot.subject}|||${slot.duration_minutes ?? 90}` : ''}
                onChange={(e) => updateFn(index, 'subject', e.target.value)}
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
      ))}
    </div>
  );

  return (
    <div className="space-y-5">
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      <PortalFormHeader
        eyebrow="週回数変更 申込"
        title={period.title || '週回数変更'}
        description={settings.description}
      />

      <form onSubmit={handleSubmit} className="space-y-5">
        {isPreview && <PortalPreviewBanner />}

        <PortalFormSection title="基本情報">
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium mb-1 text-[#1f2937]">
                生徒名 <span className="text-[color:var(--primary)]">*</span>
              </label>
              <Input
                type="text"
                value={studentName}
                onChange={(e) => setStudentName(e.target.value)}
                placeholder="例：山田 太郎"
                className={errors.studentName ? 'border-[color:var(--primary)]' : ''}
              />
              {errors.studentName && (
                <p className="text-[color:var(--primary)] text-xs mt-1">{errors.studentName}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 text-[#1f2937]">
                学年 <span className="text-[color:var(--primary)]">*</span>
              </label>
              <Select
                value={selectedGrade}
                onChange={(e) => setSelectedGrade(e.target.value)}
                options={[
                  { value: '', label: '選択してください' },
                  ...GRADES.map((g) => ({ value: g, label: g })),
                ]}
                className={errors.grade ? 'border-[color:var(--primary)]' : ''}
              />
              {errors.grade && (
                <p className="text-[color:var(--primary)] text-xs mt-1">{errors.grade}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 text-[#1f2937]">
                メールアドレス <span className="text-[color:var(--primary)]">*</span>
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
          </div>
        </PortalFormSection>

        <PortalFormSection title="現在の通塾状況">
          <div className="mb-3">
            <label className="block text-sm font-medium mb-1 text-[#1f2937]">
              週回数 <span className="text-[color:var(--primary)]">*</span>
            </label>
            <Select
              value={currentWeekly.toString()}
              onChange={(e) => setCurrentWeekly(Number(e.target.value))}
              options={settings.weekly_options.map((n) => ({
                value: n.toString(),
                label: `週${n}回`,
              }))}
            />
          </div>
          {renderSlotInputs(currentSlots, updateCurrentSlot)}
        </PortalFormSection>

        <PortalFormSection title="変更希望">
          <div className="mb-3">
            <label className="block text-sm font-medium mb-1 text-[#1f2937]">
              週回数 <span className="text-[color:var(--primary)]">*</span>
            </label>
            <Select
              value={requestedWeekly.toString()}
              onChange={(e) => setRequestedWeekly(Number(e.target.value))}
              options={settings.weekly_options.map((n) => ({
                value: n.toString(),
                label: `週${n}回`,
              }))}
            />
          </div>
          {renderSlotInputs(requestedSlots, updateRequestedSlot)}
        </PortalFormSection>

        <PortalFormSection title="変更開始月">
          <div>
            <label className="block text-sm font-medium mb-1 text-[#1f2937]">
              何月から変更を希望しますか？ <span className="text-[color:var(--primary)]">*</span>
            </label>
            <Input
              type="month"
              value={changeFrom}
              min={minChangeMonth}
              onChange={(e) => setChangeFrom(e.target.value)}
              className={errors.changeFrom ? 'border-[color:var(--primary)]' : ''}
            />
            {changeFrom && (
              <p className="text-sm text-[#4b5563] mt-1">→ {formatDateLabel(changeFrom)}</p>
            )}
            {errors.changeFrom && (
              <p className="text-[color:var(--primary)] text-xs mt-1">{errors.changeFrom}</p>
            )}
          </div>
          <div className="mt-4 p-4 bg-amber-50 border border-amber-300 rounded-lg space-y-2">
            <p className="text-sm font-semibold text-amber-900 leading-relaxed">
              変更は翌月以降からとなります。変更希望月の前々月末までにお申し込みください。
            </p>
            <p className="text-xs text-amber-800 leading-relaxed">
              例：4月から変更したい場合 → 2月末までにお申し込みください。2月中にお申し込みいただいた場合、3月は現在と同じ内容で通塾いただき、4月から変更が適用されます。
            </p>
            <p className="text-sm font-semibold text-amber-900 leading-relaxed">
              ご希望の時間帯が満席の場合もございます。決まり次第Growからご連絡、ご相談させていただきます。
            </p>
          </div>
        </PortalFormSection>

        <PortalFormSection title="備考">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="ご要望等あればご記入ください"
            rows={3}
            className="w-full border border-[#e5e7eb] rounded-lg px-3 py-2 resize-y text-sm focus:ring-2 focus:ring-[color:var(--primary)] focus:border-[color:var(--primary)]"
          />
        </PortalFormSection>

        <PortalFormActions isSubmitting={isSubmitting} submitLabel="申請する" />
      </form>
    </div>
  );
}
