'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input, Select } from '@/components/ui';
import type { FormWithFields } from '@/types/database';
import { KOMA_GRADE_OPTIONS } from '@/lib/forms/grade-converter';
import { generateSlots, groupSlotsByDate } from '@/lib/forms/slots';
import { getPriceByGradeNumber } from '@/lib/forms/pricing';
import { submitFormResponse } from '@/lib/api/forms';

interface KomaFormRendererProps {
  form: FormWithFields;
  schoolCode: string;
  onSuccess?: () => void;
  isReadOnly?: boolean;
}

export function KomaFormRenderer({
  form,
  schoolCode,
  onSuccess,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  isReadOnly = false,
}: KomaFormRendererProps) {
  const router = useRouter();
  const [studentName, setStudentName] = useState('');
  const [grade, setGrade] = useState<number | ''>('');
  const [email, setEmail] = useState('');
  const [subjectKomas, setSubjectKomas] = useState<Record<string, number>>({});
  const [selectedSlots, setSelectedSlots] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // スロット生成
  const slots = useMemo(() => generateSlots(), []);
  const slotsByDate = useMemo(() => groupSlotsByDate(slots), [slots]);

  // 科目フィールドを取得
  const subjectFields = form.fields.filter((f) => f.field_type === 'number' && f.label.includes('（コマ）'));
  const slotsField = form.fields.find((f) => f.label === '出席可能日程');
  const notesField = form.fields.find((f) => f.label === '備考');

  // 科目コマ数の合計
  const totalKomas = useMemo(() => {
    return Object.values(subjectKomas).reduce((sum, koma) => sum + (Number(koma) || 0), 0);
  }, [subjectKomas]);

  // 見積金額
  const estimatedPrice = useMemo(() => {
    if (grade === '' || typeof grade !== 'number') return 0;
    const pricePerKoma = getPriceByGradeNumber(Number(grade));
    return totalKomas * pricePerKoma;
  }, [grade, totalKomas]);

  // 学年ラベル
  const gradeLabel = useMemo(() => {
    if (grade === '' || typeof grade !== 'number') return '';
    return KOMA_GRADE_OPTIONS.find((opt) => opt.value === grade)?.label || '';
  }, [grade]);

  const validateEmail = (email: string) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const validate = () => {
    const newErrors: Record<string, string> = {};

    if (!studentName.trim()) {
      newErrors.studentName = '生徒名を入力してください';
    }

    if (grade === '' || typeof grade !== 'number') {
      newErrors.grade = '学年を選択してください';
    }

    if (!email.trim()) {
      newErrors.email = 'メールアドレスを入力してください';
    } else if (!validateEmail(email)) {
      newErrors.email = '正しいメールアドレスを入力してください';
    }

    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) {
      return false;
    }

    // 合計コマ数が0の場合は警告
    if (totalKomas === 0) {
      if (!confirm('合計コマ数が0です。このまま送信しますか？')) {
        return false;
      }
    }

    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validate()) {
      return;
    }

    // プレビューモードのチェック
    if (window.location.pathname.includes('/preview/')) {
      alert('プレビューモードでは送信できません。実際のフォームページから送信してください。');
      return;
    }

    setIsSubmitting(true);
    try {
      // answersオブジェクトを構築
      const answers: Record<string, unknown> = {};

      // 科目コマ数
      subjectFields.forEach((field) => {
        answers[field.id] = subjectKomas[field.id] || 0;
      });

      // スロット選択
      if (slotsField) {
        answers[slotsField.id] = selectedSlots;
      }

      // 備考
      if (notesField) {
        answers[notesField.id] = notes.trim();
      }

      await submitFormResponse(form.id, {
        student_name: studentName.trim(),
        grade: grade === '' ? null : Number(grade),
        email: email.trim() || null,
        answers,
      });
      if (onSuccess) {
        onSuccess();
      }
      router.push(`/portal/${schoolCode}/${form.slug}?submitted=true`);
    } catch (error) {
      console.error('Error submitting form:', error);
      alert('送信に失敗しました。もう一度お試しください。');
    } finally {
      setIsSubmitting(false);
    }
  };

  // 時限で全選択/解除
  const handlePeriodToggle = (period: number) => {
    const periodSlots = slots.filter((s) => s.period === period);
    const periodSlotIds = periodSlots.map((s) => s.id);
    const allSelected = periodSlotIds.every((id) => selectedSlots.includes(id));

    if (allSelected) {
      setSelectedSlots((prev) => prev.filter((id) => !periodSlotIds.includes(id)));
    } else {
      setSelectedSlots((prev) => Array.from(new Set([...prev, ...periodSlotIds])));
    }
  };

  // 日付で全選択/解除
  const handleDateToggle = (dateKey: string) => {
    const dateSlots = slotsByDate.get(dateKey) || [];
    const dateSlotIds = dateSlots.map((s) => s.id);
    const allSelected = dateSlotIds.every((id) => selectedSlots.includes(id));

    if (allSelected) {
      setSelectedSlots((prev) => prev.filter((id) => !dateSlotIds.includes(id)));
    } else {
      setSelectedSlots((prev) => Array.from(new Set([...prev, ...dateSlotIds])));
    }
  };

  // リセット
  const handleReset = () => {
    if (!confirm('入力内容をリセットしますか？')) return;
    setStudentName('');
    setGrade('');
    setEmail('');
    setSubjectKomas({});
    setSelectedSlots([]);
    setNotes('');
    setErrors({});
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Heroセクション */}
      <div className="bg-gradient-to-r from-[#3b82f6] to-[#60a5fa] rounded-xl p-8 text-center text-white">
        <h2 className="text-3xl font-bold mb-2">{form.title}</h2>
        <p className="text-lg opacity-90 mb-4">{form.description}</p>
        <span className="inline-block bg-white/20 px-4 py-1 rounded-full text-sm">
          定期テスト対策
        </span>
      </div>

      {/* 基本情報 */}
      <div className="bg-white rounded-xl border border-[#e5e7eb] p-6">
        <h3 className="text-lg font-semibold text-[#1f2937] mb-4">基本情報</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-[#4b5563] mb-2">
              生徒名 <span className="text-[#ef4444]">*</span>
            </label>
            <Input
              value={studentName}
              onChange={(e) => {
                setStudentName(e.target.value);
                if (errors.studentName) {
                  setErrors((prev) => {
                    const newErrors = { ...prev };
                    delete newErrors.studentName;
                    return newErrors;
                  });
                }
              }}
              placeholder="山田太郎"
              disabled={isSubmitting}
            />
            {errors.studentName && (
              <p className="text-sm text-[#ef4444] mt-1">{errors.studentName}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-[#4b5563] mb-2">
              学年 <span className="text-[#ef4444]">*</span>
            </label>
            <Select
              value={grade === '' ? '' : String(grade)}
              onChange={(e) => {
                setGrade(e.target.value === '' ? '' : Number(e.target.value));
                if (errors.grade) {
                  setErrors((prev) => {
                    const newErrors = { ...prev };
                    delete newErrors.grade;
                    return newErrors;
                  });
                }
              }}
              disabled={isSubmitting}
              options={[
                { value: '', label: '選択してください' },
                ...KOMA_GRADE_OPTIONS.map((opt) => ({ value: opt.value, label: opt.label })),
              ]}
            />
            {errors.grade && (
              <p className="text-sm text-[#ef4444] mt-1">{errors.grade}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-[#4b5563] mb-2">
              メールアドレス <span className="text-[#ef4444]">*</span>
            </label>
            <Input
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (errors.email) {
                  setErrors((prev) => {
                    const newErrors = { ...prev };
                    delete newErrors.email;
                    return newErrors;
                  });
                }
              }}
              placeholder="example@email.com"
              disabled={isSubmitting}
            />
            {errors.email && (
              <p className="text-sm text-[#ef4444] mt-1">{errors.email}</p>
            )}
          </div>
        </div>
      </div>

      {/* 科目入力 */}
      <div className="bg-white rounded-xl border border-[#e5e7eb] p-6">
        <h3 className="text-lg font-semibold text-[#1f2937] mb-4">科目別コマ数</h3>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {subjectFields.map((field) => {
            const subjectName = field.label.replace('（コマ）', '');
            const options = (field.options as { min?: number; max?: number; step?: number }) || {};
            return (
              <div key={field.id}>
                <label className="block text-sm font-medium text-[#4b5563] mb-2">
                  {subjectName}
                </label>
                <Input
                  type="number"
                  min={options.min ?? 0}
                  max={options.max ?? 60}
                  step={options.step ?? 1}
                  value={subjectKomas[field.id] || ''}
                  onChange={(e) => {
                    const value = e.target.value === '' ? 0 : Number(e.target.value);
                    setSubjectKomas((prev) => ({
                      ...prev,
                      [field.id]: value,
                    }));
                  }}
                  placeholder="0"
                  disabled={isSubmitting}
                />
              </div>
            );
          })}
        </div>
        <div className="mt-4 text-sm text-[#4b5563]">
          合計: <span className="font-semibold text-[#1f2937]">{totalKomas}コマ</span>
        </div>
      </div>

      {/* 料金表と見積 */}
      {grade !== '' && typeof grade === 'number' && (
        <div className="bg-white rounded-xl border border-[#e5e7eb] p-6">
          <h3 className="text-lg font-semibold text-[#1f2937] mb-4">料金</h3>
          <div className="space-y-4">
            <div>
              <p className="text-sm text-[#4b5563] mb-2">単価（{gradeLabel}）</p>
              <p className="text-xl font-bold text-[#1f2937]">
                ¥{getPriceByGradeNumber(Number(grade)).toLocaleString()} / コマ
              </p>
            </div>
            <div className="border-t border-[#e5e7eb] pt-4">
              <div className="flex justify-between items-center mb-2">
                <span className="text-[#4b5563]">見積金額</span>
                <span className="text-2xl font-bold text-[#1f2937]">
                  ¥{estimatedPrice.toLocaleString()}
                </span>
              </div>
              <p className="text-xs text-[#4b5563]/60">
                {totalKomas}コマ × ¥{getPriceByGradeNumber(Number(grade)).toLocaleString()}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* スロット選択 */}
      <div className="bg-white rounded-xl border border-[#e5e7eb] p-6">
        <h3 className="text-lg font-semibold text-[#1f2937] mb-4">出席可能日程</h3>
        
        {/* 時限全選択ボタン */}
        <div className="mb-4 flex gap-2 flex-wrap">
          {[4, 5, 6, 7].map((period) => {
            const periodSlots = slots.filter((s) => s.period === period);
            const allSelected = periodSlots.length > 0 && periodSlots.every((s) => selectedSlots.includes(s.id));
            return (
              <button
                key={period}
                type="button"
                onClick={() => handlePeriodToggle(period)}
                className={`px-3 py-1 text-sm rounded border ${
                  allSelected
                    ? 'bg-[#3b82f6] text-white border-[#e5e7eb]'
                    : 'bg-[#f3f4f6] text-[#4b5563] border-[#e5e7eb]'
                }`}
                disabled={isSubmitting}
              >
                {period}限{allSelected ? ' ✓' : ''}
              </button>
            );
          })}
        </div>

        {/* スロット表 */}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-[#f3f4f6] border-b border-[#e5e7eb]">
                <th className="px-3 py-2 text-left text-sm font-semibold text-[#1f2937] border-r border-[#e5e7eb]">
                  日付
                </th>
                {[4, 5, 6, 7].map((period) => (
                  <th
                    key={period}
                    className="px-3 py-2 text-center text-sm font-semibold text-[#1f2937] border-r border-[#e5e7eb] last:border-r-0"
                  >
                    {period}限
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from(slotsByDate.entries()).map(([dateKey, dateSlots]) => {
                const date = dateSlots[0].date;
                const dateLabel = `${date.getMonth() + 1}/${date.getDate()}(${['日', '月', '火', '水', '木', '金', '土'][date.getDay()]})`;
                const allDateSelected = dateSlots.every((s) => selectedSlots.includes(s.id));
                return (
                  <tr key={dateKey} className="border-b border-[#e5e7eb]">
                    <td className="px-3 py-2 text-sm text-[#4b5563] border-r border-[#e5e7eb]">
                      <button
                        type="button"
                        onClick={() => handleDateToggle(dateKey)}
                        className={`font-medium ${
                          allDateSelected ? 'text-[#3b82f6]' : 'text-[#4b5563]'
                        }`}
                        disabled={isSubmitting}
                      >
                        {dateLabel} {allDateSelected ? '✓' : ''}
                      </button>
                    </td>
                    {[4, 5, 6, 7].map((period) => {
                      const slot = dateSlots.find((s) => s.period === period);
                      const isSelected = slot && selectedSlots.includes(slot.id);
                      return (
                        <td
                          key={period}
                          className="px-3 py-2 text-center border-r border-[#e5e7eb] last:border-r-0"
                        >
                          {slot ? (
                            <label className="cursor-pointer">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedSlots((prev) => [...prev, slot.id]);
                                  } else {
                                    setSelectedSlots((prev) => prev.filter((id) => id !== slot.id));
                                  }
                                }}
                                disabled={isSubmitting}
                                className="w-4 h-4 text-[#3b82f6] border-[#e5e7eb] rounded focus:ring-[#3b82f6]"
                              />
                            </label>
                          ) : (
                            <span className="text-[#4b5563]/30">-</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 備考 */}
      {notesField && (
        <div className="bg-white rounded-xl border border-[#e5e7eb] p-6">
          <h3 className="text-lg font-semibold text-[#1f2937] mb-4">{notesField.label}</h3>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={('placeholder' in notesField && notesField.placeholder) ? String(notesField.placeholder) : ''}
            rows={4}
            disabled={isSubmitting}
            className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm bg-white text-[#4b5563] focus:ring-2 focus:ring-[#3b82f6] focus:border-[#3b82f6] disabled:opacity-50"
          />
        </div>
      )}

      {/* 注意ボックス */}
      <div className="bg-[#3b82f6]/20 border border-[#3b82f6] rounded-xl p-4">
        <p className="text-sm text-[#1f2937]">
          <strong>ご注意:</strong> 送信後、担当者よりご連絡いたします。
        </p>
      </div>

      {/* ボタン */}
      <div className="flex justify-center gap-4 pt-6">
        <Button
          type="button"
          onClick={handleReset}
          variant="secondary"
          disabled={isSubmitting}
          className="min-h-[48px] px-8"
        >
          リセット
        </Button>
        <Button
          type="submit"
          size="lg"
          disabled={isSubmitting}
          className="min-h-[48px] px-8 text-lg"
        >
          {isSubmitting ? '送信中...' : '送信する'}
        </Button>
      </div>
    </form>
  );
}
