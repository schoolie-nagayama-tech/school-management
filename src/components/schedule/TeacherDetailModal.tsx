'use client';

import { Modal, Button } from '@/components/ui';
import type { Subject } from '@/types/database';

const DAY_LABELS: { value: number; label: string }[] = [
  { value: 0, label: '日' },
  { value: 1, label: '月' },
  { value: 2, label: '火' },
  { value: 3, label: '水' },
  { value: 4, label: '木' },
  { value: 5, label: '金' },
  { value: 6, label: '土' },
];

export interface ScheduleTeacherOption {
  id: string;
  display_name: string | null;
  email: string | null;
  user_schools?: Array<{ school_id: string; school?: { name: string } }>;
  teachable_subject_ids?: string[] | null;
  available_days_of_week?: number[] | null;
  available_slot_numbers_by_day?: Record<string, number[]> | null;
}

interface TeacherDetailModalProps {
  open: boolean;
  onClose: () => void;
  teacher: ScheduleTeacherOption | null;
  subjects: Subject[];
}

export function TeacherDetailModal({
  open,
  onClose,
  teacher,
  subjects,
}: TeacherDetailModalProps) {
  if (!teacher) return null;

  const subjectNames = (teacher.teachable_subject_ids ?? [])
    .map((id) => subjects.find((s) => s.id === id)?.name)
    .filter(Boolean) as string[];
  const schoolNames = (teacher.user_schools ?? [])
    .map((us) => us.school?.name)
    .filter(Boolean) as string[];
  const slotByDay = teacher.available_slot_numbers_by_day ?? {};
  const slotByDayLines = DAY_LABELS.filter((d) => {
    const arr = slotByDay[String(d.value)];
    return arr && arr.length > 0;
  }).map((d) => {
    const arr = slotByDay[String(d.value)]!.sort((a, b) => a - b);
    return `${d.label}: ${arr.map((n) => `${n}限`).join('・')}`;
  });

  return (
    <Modal isOpen={open} onClose={onClose} title="講師詳細" size="md">
      <div className="space-y-4">
        <div>
          <label className="text-xs text-[var(--paragraph)]">表示名</label>
          <p className="mt-1 text-sm font-medium text-[var(--headline)]">
            {teacher.display_name || '—'}
          </p>
        </div>
        <div>
          <label className="text-xs text-[var(--paragraph)]">メール</label>
          <p className="mt-1 text-sm text-[var(--headline)]">{teacher.email || '—'}</p>
        </div>
        <div>
          <label className="text-xs text-[var(--paragraph)]">担当教室</label>
          <p className="mt-1 text-sm text-[var(--headline)]">
            {schoolNames.length > 0 ? schoolNames.join('、') : '—'}
          </p>
        </div>
        <div>
          <label className="text-xs text-[var(--paragraph)]">指導可能科目</label>
          <p className="mt-1 text-sm text-[var(--headline)]">
            {subjectNames.length > 0 ? subjectNames.join('、') : '—'}
          </p>
        </div>
        <div>
          <label className="text-xs text-[var(--paragraph)]">出勤可能コマ</label>
          <p className="mt-1 text-sm text-[var(--headline)]">
            {slotByDayLines.length > 0 ? slotByDayLines.join(' / ') : '—'}
          </p>
        </div>
        <div className="flex justify-end pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            閉じる
          </Button>
        </div>
      </div>
    </Modal>
  );
}
