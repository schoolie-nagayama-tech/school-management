'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui';
import { Button } from '@/components/ui';
import type { ScheduleEntry, ScheduleTimeSlot } from '@/types/schedule';

function gradeLabel(grade: number): string {
  if (grade <= 6) return `小${grade}`;
  if (grade <= 9) return `中${grade - 6}`;
  return `高${grade - 9}`;
}

function formatDay(dateStr: string): string {
  const d = new Date(dateStr + 'Z');
  const week = ['日', '月', '火', '水', '木', '金', '土'][d.getUTCDay()];
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${week})`;
}

export type DeleteType = 'single' | 'regular';

export interface DeleteScheduleEntryModalProps {
  open: boolean;
  onClose: () => void;
  entry: ScheduleEntry | null;
  timeSlot: ScheduleTimeSlot | null;
  onConfirm: (deleteType: DeleteType) => Promise<void>;
}

export function DeleteScheduleEntryModal({
  open,
  onClose,
  entry,
  timeSlot,
  onConfirm,
}: DeleteScheduleEntryModalProps) {
  const [deleteType, setDeleteType] = useState<DeleteType>('single');
  const [saving, setSaving] = useState(false);

  if (!entry) return null;

  const studentName = entry.student
    ? `${entry.student.last_name} ${entry.student.first_name}（${gradeLabel(entry.student.grade)}）`
    : entry.student_id;
  const subjectNames = (entry.subjects ?? [])
    .map((s) => (typeof s === 'object' && s && 'name' in s ? s.name : String(s)))
    .filter(Boolean)
    .join('・') || '—';
  const teacherName =
    entry.teacher?.display_name || entry.teacher?.email || '—';
  const slotLabel = timeSlot
    ? `${timeSlot.slot_number}限 ${timeSlot.start_time?.slice(0, 5) ?? ''}-${timeSlot.end_time?.slice(0, 5) ?? ''}`
    : '—';
  const hasRegularPattern = !!entry.regular_pattern_id;

  const handleConfirm = async () => {
    setSaving(true);
    try {
      await onConfirm(deleteType);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md bg-white border border-gray-200">
        <DialogHeader>
          <DialogTitle>授業を削除</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <p className="text-sm text-[var(--paragraph)]">
            以下の授業を削除しますか？
          </p>
          <div className="text-sm">
            <div>生徒: {studentName}</div>
            <div>日時: {formatDay(entry.entry_date)} {slotLabel}</div>
            <div>講師: {teacherName}</div>
            <div>科目: {subjectNames}</div>
          </div>

          <div>
            <div className="text-xs font-medium text-[var(--paragraph)] mb-2">
              削除タイプ
            </div>
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="deleteType"
                  checked={deleteType === 'single'}
                  onChange={() => setDeleteType('single')}
                  className="text-[#1e3a5f]"
                />
                <span className="text-sm">この日のみ削除</span>
              </label>
              {hasRegularPattern && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="deleteType"
                    checked={deleteType === 'regular'}
                    onChange={() => setDeleteType('regular')}
                    className="text-[#1e3a5f]"
                  />
                  <span className="text-sm">
                    通常授業から削除（以降この曜日・コマに入らない）
                  </span>
                </label>
              )}
            </div>
          </div>

          {deleteType === 'regular' && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-700">
              ⚠️ 通常授業から削除すると、以降の週からもこの授業がなくなります。
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            キャンセル
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={saving}
            className="border-[#c62828] text-[#c62828] hover:bg-red-50"
          >
            {saving ? '削除中...' : '削除する'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
