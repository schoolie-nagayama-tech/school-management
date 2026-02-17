'use client';

import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui';
import { Button } from '@/components/ui';
import { StudentSearchInput, type StudentWithSubjects } from './StudentSearchInput';
import {
  createRegularPattern,
  createScheduleEntry,
  checkStudentTimeConflict,
  regenerateWeekForDate,
} from '@/lib/api/schedule';
import type { ScheduleTimeSlot } from '@/types/schedule';
import type { ScheduleEntryFormData } from '@/types/schedule';
import type { Subject } from '@/types/database';
import { DAY_OF_WEEK_LABELS } from '@/types/schedule';

export interface AddStudentToSlotModalProps {
  isOpen: boolean;
  onClose: () => void;
  date: string;
  dayOfWeek: number;
  timeSlot: ScheduleTimeSlot;
  teacherId: string;
  teacherName: string;
  schoolId: string;
  subjects: Subject[];
  /** 講師の指導可能科目ID。空 or null = 指導可能科目なし */
  teacherTeachableSubjectIds?: string[] | null;
  onSuccess: () => void;
}

type RegisterType = 'regular' | 'single';

export function AddStudentToSlotModal({
  isOpen,
  onClose,
  date,
  dayOfWeek,
  timeSlot,
  teacherId,
  teacherName,
  schoolId,
  subjects,
  teacherTeachableSubjectIds,
  onSuccess,
}: AddStudentToSlotModalProps) {
  const { profile } = useAuth();
  const [selectedStudent, setSelectedStudent] = useState<StudentWithSubjects | null>(null);
  const [subjectId, setSubjectId] = useState<string>('');
  const [registerType, setRegisterType] = useState<RegisterType>('regular');
  const [saving, setSaving] = useState(false);
  const [conflictError, setConflictError] = useState<string | null>(null);

  const availableSubjects = useMemo(() => {
    if (!teacherTeachableSubjectIds || teacherTeachableSubjectIds.length === 0) {
      return []; // 空 or null = 指導可能科目なし（すべてなし）
    }
    return subjects.filter((s) => teacherTeachableSubjectIds.includes(s.id));
  }, [subjects, teacherTeachableSubjectIds]);

  useEffect(() => {
    if (isOpen) {
      setSelectedStudent(null);
      setSubjectId(availableSubjects[0]?.id ?? '');
      setRegisterType('regular');
      setConflictError(null);
    }
  }, [isOpen, availableSubjects]);

  const slotLabel = `${DAY_OF_WEEK_LABELS[dayOfWeek] ?? ''}曜日 ${timeSlot.slot_number}限 ${timeSlot.start_time?.slice(0, 5) ?? ''}-${timeSlot.end_time?.slice(0, 5) ?? ''}`;

  const handleSubmit = async () => {
    if (!selectedStudent || !subjectId || !schoolId) return;
    setConflictError(null);
    setSaving(true);
    try {
      const startTime = timeSlot.start_time ?? '00:00:00';
      const endTime = timeSlot.end_time ?? '23:59:59';
      const form: ScheduleEntryFormData = {
        teacher_id: teacherId,
        student_id: selectedStudent.id,
        subject_ids: [subjectId],
        seat_label: '',
        note: '',
      };

      if (registerType === 'regular') {
        const conflict = await checkStudentTimeConflict(
          selectedStudent.id,
          dayOfWeek,
          startTime,
          endTime
        );
        if (conflict) {
          setConflictError(conflict.message);
          setSaving(false);
          return;
        }
        const pattern = await createRegularPattern(schoolId, {
          student_id: selectedStudent.id,
          day_of_week: dayOfWeek,
          time_slot_id: timeSlot.id,
          teacher_id: teacherId,
          subject_ids: [subjectId],
          seat_label: '',
          period_type: 'regular',
        });
        await createScheduleEntry(schoolId, date, timeSlot.id, form, {
          regular_pattern_id: pattern.id,
          status: 'scheduled',
        });
        await regenerateWeekForDate(schoolId, date, profile?.id);
      } else {
        const conflict = await checkStudentTimeConflict(
          selectedStudent.id,
          dayOfWeek,
          startTime,
          endTime,
          { specificDate: date }
        );
        if (conflict) {
          setConflictError(conflict.message);
          setSaving(false);
          return;
        }
        await createScheduleEntry(schoolId, date, timeSlot.id, form, {
          regular_pattern_id: null,
          status: 'scheduled',
        });
      }
      onSuccess();
      onClose();
    } catch (e) {
      setConflictError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const canSubmit = selectedStudent && subjectId && schoolId;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md bg-white border border-gray-200">
        <DialogHeader>
          <DialogTitle>生徒を追加</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="text-sm text-[var(--paragraph)]">
            <div>追加先: {slotLabel}</div>
            <div>講師: {teacherName}</div>
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--paragraph)] mb-1">
              生徒を検索
            </label>
            <StudentSearchInput
              schoolId={schoolId}
              onSelect={setSelectedStudent}
              placeholder="生徒を検索..."
            />
            {selectedStudent && (
              <div className="mt-2 text-sm text-[var(--headline)]">
                選択: {selectedStudent.last_name} {selectedStudent.first_name}
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--paragraph)] mb-1">
              科目
            </label>
            <select
              value={subjectId}
              onChange={(e) => setSubjectId(e.target.value)}
              className="w-full px-3 py-2 border border-[var(--stroke)] rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
            >
              {availableSubjects.length === 0 ? (
                <option value="">
                  この講師の指導可能科目が設定されていません
                </option>
              ) : (
                availableSubjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))
              )}
            </select>
          </div>

          <div>
            <div className="text-xs font-medium text-[var(--paragraph)] mb-2">
              登録タイプ
            </div>
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="registerType"
                  checked={registerType === 'regular'}
                  onChange={() => setRegisterType('regular')}
                  className="text-[#1e3a5f]"
                />
                <span className="text-sm">
                  通常授業として登録（毎週この曜日・コマに入る）
                </span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="registerType"
                  checked={registerType === 'single'}
                  onChange={() => setRegisterType('single')}
                  className="text-[#1e3a5f]"
                />
                <span className="text-sm">この日のみ追加（振替・臨時など）</span>
              </label>
            </div>
          </div>

          {conflictError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
              <div className="font-medium">時間が重複しています</div>
              <div className="mt-1">{conflictError}</div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            キャンセル
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit || saving}
            className="bg-[#1e3a5f] hover:bg-[#2a4a6f]"
          >
            {saving ? '追加中...' : '追加する'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
