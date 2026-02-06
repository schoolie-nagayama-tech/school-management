'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui';
import { Button } from '@/components/ui';
import {
  createRegularPattern,
  updateRegularPattern,
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
}

export interface RegularScheduleFormModalProps {
  open: boolean;
  onClose: () => void;
  studentId: string;
  schoolId: string;
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
  pattern,
  timeSlots,
  teachers,
  subjects,
  onSuccess,
}: RegularScheduleFormModalProps) {
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [timeSlotId, setTimeSlotId] = useState('');
  const [teacherId, setTeacherId] = useState('');
  const [subjectIds, setSubjectIds] = useState<string[]>([]);
  const [periodType, setPeriodType] = useState<SchedulePeriodType>('regular');
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isEdit = !!pattern;

  useEffect(() => {
    if (open) {
      setErrorMessage(null);
      if (pattern) {
        setDayOfWeek(pattern.day_of_week);
        setTimeSlotId(pattern.time_slot_id);
        setTeacherId(pattern.teacher_id);
        setSubjectIds(pattern.subject_ids ?? []);
        setPeriodType(pattern.period_type ?? 'regular');
      } else {
        setDayOfWeek(1);
        setTimeSlotId(timeSlots[0]?.id ?? '');
        setTeacherId(teachers[0]?.id ?? '');
        setSubjectIds(subjects[0] ? [subjects[0].id] : []);
        setPeriodType('regular');
      }
    }
  }, [open, pattern, timeSlots, teachers, subjects]);

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
      };
      if (isEdit && pattern) {
        await updateRegularPattern(pattern.id, form);
        onSuccess();
        onClose();
      } else {
        await createRegularPattern(schoolId, form);
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
      <DialogContent className="max-w-md bg-white border border-gray-200">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? '通塾日程を編集' : '通塾日程を追加'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <label className="block text-xs font-medium text-[var(--paragraph)] mb-1">
              曜日
            </label>
            <div className="flex flex-wrap gap-2">
              {DAYS.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDayOfWeek(d)}
                  className={`px-3 py-1.5 rounded text-sm border ${
                    dayOfWeek === d
                      ? 'bg-[#1e3a5f] text-white border-[#1e3a5f]'
                      : 'bg-white border-[var(--stroke)] text-[var(--paragraph)] hover:bg-[var(--surface)]'
                  }`}
                >
                  {DAY_OF_WEEK_LABELS[d] ?? ''}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--paragraph)] mb-1">
              コマ
            </label>
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
            <label className="block text-xs font-medium text-[var(--paragraph)] mb-1">
              講師
            </label>
            <select
              value={teacherId}
              onChange={(e) => setTeacherId(e.target.value)}
              className="w-full px-3 py-2 border border-[var(--stroke)] rounded-md text-sm bg-white"
            >
              {teachers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.display_name || t.email || '—'}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--paragraph)] mb-1">
              科目
            </label>
            <select
              value={subjectIds[0] ?? ''}
              onChange={(e) => setSubjectIds(e.target.value ? [e.target.value] : [])}
              className="w-full px-3 py-2 border border-[var(--stroke)] rounded-md text-sm bg-white"
            >
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--paragraph)] mb-1">
              期間
            </label>
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
            className="bg-[#1e3a5f] hover:bg-[#2a4a6f]"
          >
            {saving ? '保存中...' : '保存する'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
