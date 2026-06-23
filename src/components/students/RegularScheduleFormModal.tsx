'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui';
import { Button } from '@/components/ui';
import {
  createRegularPattern,
  updateRegularPattern,
  regenerateCurrentWeekIfNeeded,
  scheduleRegularPatternChangeFrom,
} from '@/lib/api/schedule';
import { DAY_OF_WEEK_LABELS, SCHEDULE_PERIOD_LABELS } from '@/types/schedule';
import type {
  ScheduleRegularPattern,
  ScheduleRegularPatternFormData,
  ScheduleTimeSlot,
  SchedulePeriodType,
} from '@/types/schedule';
import type { Subject } from '@/types/database';

const DAYS: number[] = [0, 1, 2, 3, 4, 5, 6];
const PERIOD_TYPES: SchedulePeriodType[] = ['regular', 'spring', 'summer', 'winter'];

interface TeacherOption {
  id: string;
  display_name: string | null;
  email: string | null;
  teachable_subject_ids?: string[] | null;
}

/** 学年(1-12)から科目のgrade_categoryへ */
function gradeToCategory(grade: number): 'elementary' | 'middle' | 'high' {
  if (grade <= 6) return 'elementary';
  if (grade <= 9) return 'middle';
  return 'high';
}

/** 翌月1日を YYYY-MM-DD で返す（「来月から変更」のデフォルト値） */
function getNextMonthFirstDay(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 1, 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}-01`;
}

export interface RegularScheduleFormModalProps {
  open: boolean;
  onClose: () => void;
  studentId: string;
  schoolId: string;
  /** 該当学年の科目だけ表示するため（1-6: 小学生, 7-9: 中学生, 10-12: 高校生） */
  studentGrade?: number;
  pattern: ScheduleRegularPattern | null;
  timeSlots: ScheduleTimeSlot[];
  teachers: TeacherOption[];
  subjects: Subject[];
  onSuccess: () => void;
}

export function RegularScheduleFormModal({
  open,
  onClose,
  studentId,
  schoolId,
  studentGrade,
  pattern,
  timeSlots,
  teachers,
  subjects,
  onSuccess,
}: RegularScheduleFormModalProps) {
  const { profile } = useAuth();
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [timeSlotId, setTimeSlotId] = useState('');
  const [teacherId, setTeacherId] = useState('');
  const [subjectIds, setSubjectIds] = useState<string[]>([]);
  const [periodType, setPeriodType] = useState<SchedulePeriodType>('regular');
  // 適用開始モード: 'now' = 既存を即時上書き / 'future' = 指定日から（新パターン作成・旧パターンに終了日）
  const [applyMode, setApplyMode] = useState<'now' | 'future'>('now');
  // 適用開始日（future モード時。デフォルトは翌月1日）
  const [effectiveFrom, setEffectiveFrom] = useState<string>(getNextMonthFirstDay());
  // 終了日（任意。退塾・期間限定変更用）
  const [effectiveUntil, setEffectiveUntil] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isEdit = !!pattern;

  /** 該当学年の科目のみ（studentGrade 未指定時は全件） */
  const subjectsForGrade =
    studentGrade != null
      ? subjects.filter((s) => s.grade_category === gradeToCategory(studentGrade))
      : subjects;

  useEffect(() => {
    if (!open) return;
    setErrorMessage(null);
    const subsForGrade =
      studentGrade != null
        ? subjects.filter((s) => s.grade_category === gradeToCategory(studentGrade))
        : subjects;
    if (pattern) {
      setDayOfWeek(pattern.day_of_week);
      setTimeSlotId(pattern.time_slot_id);
      setTeacherId(pattern.teacher_id ?? '');
      setSubjectIds(pattern.subject_ids ?? []);
      setPeriodType(pattern.period_type ?? 'regular');
      setApplyMode('now');
      setEffectiveFrom(getNextMonthFirstDay());
      setEffectiveUntil(pattern.effective_until ?? '');
    } else {
      setDayOfWeek(1);
      setTimeSlotId(timeSlots[0]?.id ?? '');
      const initSubs = subsForGrade[0] ? [subsForGrade[0].id] : [];
      setSubjectIds(initSubs);
      setTeacherId('');
      setPeriodType('regular');
      setApplyMode('now');
      setEffectiveFrom(getNextMonthFirstDay());
      setEffectiveUntil('');
    }
  }, [open, pattern, timeSlots, subjects, studentGrade]);

  /** 選択科目を指導可能な講師のみ（teachable_subject_ids が空/未設定は全科目可） */
  const teachersForSubject =
    subjectIds.length > 0
      ? teachers.filter((t) => {
          const allowed = t.teachable_subject_ids;
          if (!allowed || allowed.length === 0) return true;
          return subjectIds.some((id) => allowed.includes(id));
        })
      : teachers;

  const validTeacherId =
    teacherId === ''
      ? ''
      : teachersForSubject.some((t) => t.id === teacherId)
        ? teacherId
        : (teachersForSubject[0]?.id ?? '');

  useEffect(() => {
    if (teacherId !== '' && validTeacherId !== teacherId) {
      setTeacherId(validTeacherId);
    }
  }, [validTeacherId, teacherId]);

  const handleSubmit = async () => {
    if (!schoolId || !timeSlotId || !teacherId) return;
    setSaving(true);
    setErrorMessage(null);
    try {
      const form: ScheduleRegularPatternFormData = {
        student_id: studentId,
        day_of_week: dayOfWeek,
        time_slot_id: timeSlotId,
        teacher_id: teacherId,
        subject_ids: subjectIds,
        seat_label: '',
        period_type: periodType,
        effective_until: effectiveUntil || null,
      };
      if (isEdit && pattern) {
        if (applyMode === 'future') {
          // 「来月から」変更：旧パターンに終了日をセットし、新パターンを effective_from から開始
          await scheduleRegularPatternChangeFrom(pattern.id, effectiveFrom, form, schoolId);
        } else {
          // 即時変更：既存行をそのまま更新（effective_until のみ変えたい場合もここで処理）
          await updateRegularPattern(pattern.id, form);
        }
        await regenerateCurrentWeekIfNeeded(schoolId, profile?.id);
        onSuccess();
        onClose();
      } else {
        // 新規追加：effective_from は applyMode によって今日 or 指定日
        const createForm: ScheduleRegularPatternFormData = {
          ...form,
          effective_from: applyMode === 'future' ? effectiveFrom : undefined,
        };
        await createRegularPattern(schoolId, createForm);
        await regenerateCurrentWeekIfNeeded(schoolId, profile?.id);
        onSuccess();
        onClose();
      }
    } catch (e) {
      setErrorMessage((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const slotLabel = (slot: ScheduleTimeSlot) =>
    `${slot.slot_number}限 ${slot.start_time?.slice(0, 5) ?? ''}-${slot.end_time?.slice(0, 5) ?? ''}`;

  return (
    <Dialog open={open} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md bg-white">
        <DialogHeader>
          <DialogTitle>{isEdit ? '通塾日程を編集' : '通塾日程を追加'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <label className="block text-xs font-medium text-[var(--paragraph)] mb-1">曜日</label>
            <div className="flex flex-wrap gap-2">
              {DAYS.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDayOfWeek(d)}
                  className={`px-3 py-1.5 rounded text-sm border ${
                    dayOfWeek === d
                      ? 'bg-[#1e3a5f] text-white border-[#1e3a5f]'
                      : 'bg-white border-[var(--stroke)] text-[var(--paragraph)] hover:bg-[var(--surface)] transition-colors duration-150'
                  }`}
                >
                  {DAY_OF_WEEK_LABELS[d] ?? ''}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--paragraph)] mb-1">コマ</label>
            <select
              value={timeSlotId}
              onChange={(e) => setTimeSlotId(e.target.value)}
              className="w-full px-3 py-2 border border-[var(--stroke)] rounded-md text-sm bg-white"
            >
              {timeSlots.map((s) => (
                <option key={s.id} value={s.id}>
                  {slotLabel(s)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--paragraph)] mb-1">科目</label>
            <select
              value={subjectIds[0] ?? ''}
              onChange={(e) => {
                const next = e.target.value ? [e.target.value] : [];
                setSubjectIds(next);
                if (next.length === 0) {
                  setTeacherId('');
                } else {
                  const nextTeacherIds = teachers
                    .filter((t) => {
                      const allowed = t.teachable_subject_ids;
                      if (!allowed || allowed.length === 0) return true;
                      return next.some((id) => allowed.includes(id));
                    })
                    .map((t) => t.id);
                  if (!nextTeacherIds.includes(teacherId)) setTeacherId(nextTeacherIds[0] ?? '');
                }
              }}
              className="w-full px-3 py-2 border border-[var(--stroke)] rounded-md text-sm bg-white"
            >
              <option value="">選択してください</option>
              {subjectsForGrade.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--paragraph)] mb-1">講師</label>
            <select
              value={validTeacherId}
              onChange={(e) => setTeacherId(e.target.value)}
              className="w-full px-3 py-2 border border-[var(--stroke)] rounded-md text-sm bg-white"
            >
              <option value="">選択してください</option>
              {teachersForSubject.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.display_name || t.email || '—'}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--paragraph)] mb-1">期間</label>
            <select
              value={periodType}
              onChange={(e) => setPeriodType(e.target.value as SchedulePeriodType)}
              className="w-full px-3 py-2 border border-[var(--stroke)] rounded-md text-sm bg-white"
            >
              {PERIOD_TYPES.map((p) => (
                <option key={p} value={p}>
                  {SCHEDULE_PERIOD_LABELS[p]}
                </option>
              ))}
            </select>
          </div>

          {/* 適用範囲（バージョン管理）— 過去月の請求と整合を取るため、変更日を予約できる */}
          <div className="border-t border-[var(--stroke)] pt-3 space-y-2">
            <label className="block text-xs font-medium text-[var(--paragraph)]">
              いつから適用
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setApplyMode('now')}
                className={`flex-1 px-3 py-1.5 rounded text-sm border ${
                  applyMode === 'now'
                    ? 'bg-[#1e3a5f] text-white border-[#1e3a5f]'
                    : 'bg-white border-[var(--stroke)] text-[var(--paragraph)] hover:bg-[var(--surface)]'
                }`}
              >
                今すぐ反映
              </button>
              <button
                type="button"
                onClick={() => setApplyMode('future')}
                className={`flex-1 px-3 py-1.5 rounded text-sm border ${
                  applyMode === 'future'
                    ? 'bg-[#1e3a5f] text-white border-[#1e3a5f]'
                    : 'bg-white border-[var(--stroke)] text-[var(--paragraph)] hover:bg-[var(--surface)]'
                }`}
              >
                指定日から
              </button>
            </div>
            {applyMode === 'future' && (
              <div>
                <input
                  type="date"
                  value={effectiveFrom}
                  onChange={(e) => setEffectiveFrom(e.target.value)}
                  className="w-full px-3 py-2 border border-[var(--stroke)] rounded-md text-sm bg-white"
                />
                <p className="text-[11px] text-[var(--paragraph-light)] mt-1">
                  {isEdit
                    ? 'この日以降に新しい設定が適用され、これまでの設定はこの日の前日で終了します（過去月の請求計算に影響しません）'
                    : 'この日から新しい通塾日程として登録されます'}
                </p>
              </div>
            )}

            <label className="block text-xs font-medium text-[var(--paragraph)] pt-2">
              終了日（任意）
            </label>
            <input
              type="date"
              value={effectiveUntil}
              onChange={(e) => setEffectiveUntil(e.target.value)}
              className="w-full px-3 py-2 border border-[var(--stroke)] rounded-md text-sm bg-white"
            />
            <p className="text-[11px] text-[var(--paragraph-light)]">
              退塾や期間限定の通塾の場合に指定。空欄なら無期限。
            </p>
          </div>

          {errorMessage && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
              {errorMessage}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            キャンセル
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={saving || !timeSlotId || !teacherId}
            className="bg-[#1e3a5f] hover:bg-[#2a4a6f] transition-colors duration-150"
          >
            {saving ? '保存中...' : '保存する'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
