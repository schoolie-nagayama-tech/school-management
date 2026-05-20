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
import { SlotTable, generateAllSlots } from './SlotTable';
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
  // バツ印モード: 出席できない日程を選択
  const [unavailableSlots, setUnavailableSlots] = useState<string[]>([]);
  const [note, setNote] = useState('');

  // バリデーションエラー
  const [errors, setErrors] = useState<Record<string, string>>({});

  // 設定を取得
  const settings = period.settings;

  // ドラフト自動保存
  const { clearDraft } = usePortalFormDraft({
    storageKey: `zoukoma:${school.id}:${period.period_key}`,
    enabled: !isPreview,
    value: { studentName, selectedGrade, email, subjectValues, selectedSlots: unavailableSlots, note },
    onRestore: (d) => {
      if (d.studentName) setStudentName(d.studentName);
      if (d.selectedGrade) setSelectedGrade(d.selectedGrade);
      if (d.email) setEmail(d.email);
      if (d.subjectValues) setSubjectValues(d.subjectValues);
      if (d.selectedSlots?.length) setUnavailableSlots(d.selectedSlots);
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

    // バツ印モード: 全スロットが出席不可だとエラー
    const allSlots = generateAllSlots(settings);
    const unavailableSet = new Set(unavailableSlots);
    const availableCount = allSlots.filter(s => !unavailableSet.has(s.id)).length;
    if (availableCount === 0) {
      newErrors.slots = '全ての日程が出席不可になっています。出席できる日程を残してください。';
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
    setUnavailableSlots([]);
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

      // スロットID → ラベル変換ヘルパー
      const buildSlotDetail = (slotId: string) => {
        const [date, periodStr] = slotId.split('_');
        const dateObj = new Date(date);
        const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
        const dayName = dayNames[dateObj.getDay()];
        const dateStr = `${dateObj.getMonth() + 1}/${dateObj.getDate()}`;

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
        return { id: slotId, label };
      };

      // 全スロットから出席不可を除外して出席可能スロットを算出
      const allSlots = generateAllSlots(settings);
      const unavailableSet = new Set(unavailableSlots);
      const availableSlotIds = allSlots
        .filter(s => !unavailableSet.has(s.id))
        .map(s => s.id);

      const selectedSlotDetails = availableSlotIds.map(buildSlotDetail);
      const unavailableSlotDetails = unavailableSlots.map(buildSlotDetail);

      const responseData: ZoukomaResponseData = {
        subjects: subjectValues,
        total_koma: totalKoma,
        unit_price: unitPrice,
        total_fee: totalFee,
        selected_slots: selectedSlotDetails,
        unavailable_slots: unavailableSlotDetails,
        slot_count: availableSlotIds.length,
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
        eyebrow="テスト対策 増コマ申し込み"
        title={period.title || 'テスト対策増コマ申し込み'}
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
          title="出席できない日程に✗をつけてください（3週間・PS2のみ）"
        >
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4 space-y-2">
            <p className="text-sm font-semibold text-[#92400e]">
              PS2のみでの実施となります
            </p>
            <p className="text-sm text-[#4b5563]">
              ご都合の悪い日程に✗印をおつけください。✗のない日程にお申し込みいただいたコマ数を割り振ってご案内いたします。
            </p>
          </div>

          {errors.slots && (
            <div className="p-3 bg-[color:var(--primary-subtle)] border border-[color:var(--primary)]/30 rounded-lg mb-4">
              <p className="text-sm text-[color:var(--primary-dark)]">{errors.slots}</p>
            </div>
          )}

          <SlotTable
            settings={settings}
            selectedSlots={unavailableSlots}
            onChange={setUnavailableSlots}
            disabled={isSubmitting}
            mode="unavailable"
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
