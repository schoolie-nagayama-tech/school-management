'use client';

import { useState, useMemo, useRef } from 'react';
import { Input, Select } from '@/components/ui';
import type { School } from '@/types/database';
import { validateStudentName } from '@/lib/utils/validation';
import type {
  ZoukomaPeriod,
  ZoukomaResponseData,
  PriceTable,
} from '@/types/forms/zoukoma';
import { submitZoukomaResponse } from '@/lib/api/zoukoma';
import {
  GRADE_NAME_TO_NUMBER,
} from '@/types/forms/zoukoma';
import { SubjectInput } from './SubjectInput';
import { PriceQuote } from './PriceQuote';
import { SlotTable } from './SlotTable';
import {
  PortalFormHeader,
  PortalFormSection,
  PortalFormActions,
  PortalCompletionView,
  PortalErrorBanner,
  PortalPreviewBanner,
  usePortalFormDraft,
} from '@/components/forms/shared';

interface ZoukomaFormProps {
  school: School;
  period: ZoukomaPeriod;
  isPreview?: boolean;
}

export function ZoukomaForm({ school, period, isPreview }: ZoukomaFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // フォームデータ
  const [studentName, setStudentName] = useState('');
  const [selectedGrade, setSelectedGrade] = useState<string>('');
  const [email, setEmail] = useState('');
  const [subjectValues, setSubjectValues] = useState<Record<string, number>>(
    {}
  );
  const [selectedSlots, setSelectedSlots] = useState<string[]>([]);
  const [note, setNote] = useState('');

  // バリデーションエラー
  const [errors, setErrors] = useState<Record<string, string>>({});

  // 設定を取得
  const settings = period.settings;

  // ドラフト自動保存
  const { clearDraft } = usePortalFormDraft({
    storageKey: `zoukoma:${school.id}:${period.period_key}`,
    enabled: !isPreview,
    value: { studentName, selectedGrade, email, subjectValues, selectedSlots, note },
    onRestore: (d) => {
      if (d.studentName) setStudentName(d.studentName);
      if (d.selectedGrade) setSelectedGrade(d.selectedGrade);
      if (d.email) setEmail(d.email);
      if (d.subjectValues) setSubjectValues(d.subjectValues);
      if (d.selectedSlots?.length) setSelectedSlots(d.selectedSlots);
      if (d.note) setNote(d.note);
    },
  });

  // デフォルト設定
  const grades = settings.grades || [
    '中1',
    '中2',
    '中3',
    '高1',
    '高2',
    '高3',
  ];
  const subjects = settings.subjects || [
    '英語',
    '数学',
    '国語',
    '理科',
    '社会',
  ];
  const priceTable: PriceTable =
    settings.price_table ||
    ({
      中1: 3980,
      中2: 3980,
      中3: 4120,
      高1: 4480,
      高2: 4770,
      高3: 5060,
    } as PriceTable);

  // 合計コマ数を計算
  const totalKoma = useMemo(() => {
    return Object.values(subjectValues).reduce((sum, koma) => sum + koma, 0);
  }, [subjectValues]);

  // 科目入力の変更
  const handleSubjectChange = (subject: string, value: number) => {
    setSubjectValues((prev) => ({
      ...prev,
      [subject]: value,
    }));
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

    if (totalKoma === 0) {
      newErrors.subjects = '少なくとも1科目はコマ数を入力してください';
    }

    if (selectedSlots.length === 0) {
      newErrors.slots = '出席可能な日程を選択してください';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // リセット
  const handleReset = () => {
    setStudentName('');
    setSelectedGrade('');
    setEmail('');
    setSubjectValues({});
    setSelectedSlots([]);
    setNote('');
    setErrors({});
    setErrorMessage('');
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
      const gradeNumber = GRADE_NAME_TO_NUMBER[selectedGrade];
      if (!gradeNumber) {
        throw new Error('学年の変換に失敗しました');
      }

      const unitPrice = priceTable[selectedGrade] || 0;
      const totalFee = totalKoma * unitPrice;

      // 選択されたスロットの詳細情報を生成
      const selectedSlotDetails = selectedSlots.map((slotId) => {
        // slotId形式: "2024-10-15_5"
        const [date, periodStr] = slotId.split('_');
        const dateObj = new Date(date);
        const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
        const dayName = dayNames[dateObj.getDay()];
        const dateStr = `${dateObj.getMonth() + 1}/${dateObj.getDate()}`;
        
        // 新形式または旧形式から時間帯を取得
        let timeRange = '';
        if (settings.schedule?.periods) {
          const periodConfig = settings.schedule.periods.find(
            (p) => p.code === periodStr
          );
          if (periodConfig) {
            timeRange = `${periodConfig.start_time}–${periodConfig.end_time}`;
          }
        } else {
          timeRange = settings.time_slots?.[periodStr as '4' | '5' | '6' | '7'] || '';
        }
        
        const label = `${dateStr}(${dayName}) ${periodStr}限${timeRange ? ' ' + timeRange : ''}`;

        return {
          id: slotId,
          label,
        };
      });

      const responseData: ZoukomaResponseData = {
        subjects: subjectValues,
        total_koma: totalKoma,
        unit_price: unitPrice,
        total_fee: totalFee,
        selected_slots: selectedSlotDetails,
        slot_count: selectedSlots.length,
        note: note.trim() || undefined,
      };

      await submitZoukomaResponse({
        school_id: school.id,
        form_period: period.period_key,
        student_name: studentName.trim(),
        grade: gradeNumber,
        email: email.trim(),
        response_data: responseData,
      });

      clearDraft();
      setIsSubmitted(true);
    } catch (error) {
      console.error('Error submitting form:', error);
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
        eyebrow="増コマ 申込"
        title={period.title || '増コマ申込'}
        description={settings.description}
      />
      <form onSubmit={handleSubmit} className="space-y-5">
        {isPreview && <PortalPreviewBanner />}

        <PortalFormSection title="基本情報">
          <div className="space-y-4">
          <Input
            label="生徒名"
            type="text"
            value={studentName}
            onChange={(e) => setStudentName(e.target.value)}
            error={errors.studentName}
            required
            disabled={isSubmitting}
          />

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

          <Input
            label="保護者メールアドレス"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={errors.email}
            required
            disabled={isSubmitting}
          />
          </div>
        </PortalFormSection>

        <PortalFormSection
          title="申込科目とコマ数"
          description="必要な科目に必要なコマ数を入力してください"
        >
          {errors.subjects && (
            <div className="p-3 bg-[color:var(--primary-subtle)] border border-[color:var(--primary)]/30 rounded-lg mb-4">
              <p className="text-sm text-[color:var(--primary-dark)]">{errors.subjects}</p>
            </div>
          )}

          <SubjectInput
            subjects={subjects}
            values={subjectValues}
            onChange={handleSubjectChange}
            disabled={isSubmitting}
          />

          {/* 料金 */}
          {selectedGrade && (
            <div className="mt-6">
              <PriceQuote
                selectedGrade={selectedGrade}
                priceTable={priceTable}
                subjectValues={subjectValues}
                totalKoma={totalKoma}
              />
            </div>
          )}

          <p className="text-sm text-[#4b5563] mt-4">
            テスト対策の日程が決まりましたら、Growより保護者様へご連絡いたします。
          </p>
        </PortalFormSection>

        <PortalFormSection
          title="出席可能日程"
          description="出席できる日程を選んでください"
        >
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
            <p className="text-sm text-[#4b5563]">
              出席可能な日程は多めに選択してください。申込コマ数と同じ数だけ日程をお選びいただいた場合、他の生徒さんとの調整ができず授業を組めない場合があります。
            </p>
          </div>

          {errors.slots && (
            <div className="p-3 bg-[color:var(--primary-subtle)] border border-[color:var(--primary)]/30 rounded-lg mb-4">
              <p className="text-sm text-[color:var(--primary-dark)]">{errors.slots}</p>
            </div>
          )}

          <SlotTable
            settings={settings}
            selectedSlots={selectedSlots}
            onChange={setSelectedSlots}
            disabled={isSubmitting}
          />
          <p className="text-sm text-[#4b5563] mt-4">
            日程が決まりましたら、Growよりご連絡いたします。
          </p>
        </PortalFormSection>

        <PortalFormSection title="備考">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="例：部活の都合で土日は夕方のみ希望"
            className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm bg-white text-[#4b5563] focus:ring-2 focus:ring-[color:var(--primary)] focus:border-[color:var(--primary)] disabled:opacity-50"
            rows={4}
            disabled={isSubmitting}
          />
        </PortalFormSection>

        {errorMessage && <PortalErrorBanner message={errorMessage} />}

        <PortalFormActions onReset={handleReset} isSubmitting={isSubmitting} />
      </form>
    </div>
  );
}
