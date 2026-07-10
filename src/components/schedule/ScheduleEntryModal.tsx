'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui';
import { Button } from '@/components/ui';
import { ScheduleEntryForm } from './ScheduleEntryForm';
import type { ScheduleEntry, ScheduleEntryFormData } from '@/types/schedule';
import type { ScheduleTimeSlot } from '@/types/schedule';
import type { Subject } from '@/types/database';

interface TeacherOption {
  id: string;
  display_name: string | null;
  email: string | null;
  user_schools?: Array<{ school_id: string }>;
}

interface StudentOption {
  id: string;
  last_name: string;
  first_name: string;
  last_name_kana?: string;
  first_name_kana?: string;
  grade: number;
}

interface ScheduleEntryModalProps {
  open: boolean;
  onClose: () => void;
  mode: 'add' | 'edit';
  date: string;
  slot: ScheduleTimeSlot | null;
  entry: ScheduleEntry | null;
  initialTeacherId?: string;
  teachers: TeacherOption[];
  students: StudentOption[];
  subjects: Subject[];
  schoolId: string;
  onSave: (form: ScheduleEntryFormData) => Promise<void>;
}

function formatDate(d: string): string {
  const date = new Date(d + 'Z');
  const week = ['日', '月', '火', '水', '木', '金', '土'][date.getUTCDay()];
  return `${d}（${week}）`;
}

export function ScheduleEntryModal({
  open,
  onClose,
  mode,
  date,
  slot,
  entry,
  initialTeacherId,
  teachers,
  students,
  subjects,
  schoolId,
  onSave,
}: ScheduleEntryModalProps) {
  const [form, setForm] = useState<ScheduleEntryFormData>({
    teacher_id: '',
    student_id: '',
    subject_ids: [],
    seat_label: '',
    note: '',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      if (mode === 'edit' && entry) {
        setForm({
          teacher_id: entry.teacher_id,
          // Phase T: 体験の見込み客（student_id 無し）はこの編集フォームの対象外。空文字で受ける。
          student_id: entry.student_id ?? '',
          subject_ids: entry.subject_ids || [],
          seat_label: entry.seat_label || '',
          note: entry.note || '',
        });
      } else {
        setForm({
          teacher_id: initialTeacherId || '',
          student_id: '',
          subject_ids: [],
          seat_label: '',
          note: '',
        });
      }
    }
  }, [open, mode, entry, initialTeacherId]);

  const handleSubmit = async () => {
    if (!form.teacher_id) return;
    if (mode === 'add' && !form.student_id) return;
    setSaving(true);
    try {
      await onSave(form);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const dateLabel = formatDate(date);
  const slotLabel = slot
    ? `${slot.slot_number}限 ${slot.start_time?.slice(0, 5)}-${slot.end_time?.slice(0, 5)}`
    : '—';

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === 'add' ? '授業を追加' : '授業を編集'}</DialogTitle>
        </DialogHeader>
        <ScheduleEntryForm
          mode={mode}
          dateLabel={dateLabel}
          slotLabel={slotLabel}
          form={form}
          onChange={setForm}
          teachers={teachers}
          students={students}
          subjects={subjects}
          selectedSchoolId={schoolId}
          editingEntry={entry}
        />
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            キャンセル
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? '保存中...' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
