'use client';

import { useRef, useEffect } from 'react';
import { Button } from '@/components/ui';
import { AttendanceButtons } from './AttendanceButtons';
import { Pencil, ArrowRightLeft, Trash2 } from 'lucide-react';
import type { ScheduleEntry } from '@/types/schedule';

function gradeLabel(g: number): string {
  if (g <= 6) return `小${g}`;
  if (g <= 9) return `中${g - 6}`;
  return `高${g - 9}`;
}

export interface StudentCardMenuProps {
  entry: ScheduleEntry;
  position: { x: number; y: number };
  onClose: () => void;
  onAttendance: (status: 'present' | 'absent' | 'late') => void;
  onTransfer: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function StudentCardMenu({
  entry,
  position,
  onClose,
  onAttendance,
  onTransfer,
  onEdit,
  onDelete,
}: StudentCardMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  const studentName = entry.student
    ? `${entry.student.last_name}${entry.student.first_name}（${gradeLabel(entry.student.grade)}）`
    : entry.student_id;
  const subjectNames =
    (entry.subjects ?? [])
      .map((s) => (typeof s === 'object' && s && 'name' in s ? s.name : String(s)))
      .filter(Boolean)
      .join('・') || '—';

  const isTransferredOut = entry.status === 'transferred_out';
  const isCancelled = entry.status === 'cancelled';
  const canAct = !isTransferredOut && !isCancelled;

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-[200px] rounded-lg border border-[var(--headline)] bg-white shadow-lg p-2"
      style={{ left: position.x, top: position.y }}
    >
      <div className="text-xs font-medium text-[var(--headline)] mb-2 border-b border-[var(--surface)] pb-2">
        {studentName}
        <div className="text-[var(--paragraph)] font-normal mt-0.5">{subjectNames}</div>
      </div>

      {canAct && (
        <>
          <div className="mb-2">
            <div className="text-[10px] text-[var(--paragraph)] mb-1">出席を記録</div>
            <AttendanceButtons current={entry.attendance_status} onSelect={onAttendance} />
          </div>
          <div className="border-t border-[var(--surface)] pt-2 space-y-1">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start text-xs"
              onClick={onTransfer}
            >
              <ArrowRightLeft className="h-3 w-3 mr-2" />
              振替する
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start text-xs"
              onClick={onEdit}
            >
              <Pencil className="h-3 w-3 mr-2" />
              編集
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start text-xs text-[#d9376e] hover:bg-red-50"
              onClick={onDelete}
            >
              <Trash2 className="h-3 w-3 mr-2" />
              削除
            </Button>
          </div>
        </>
      )}
      {(isTransferredOut || isCancelled) && (
        <p className="text-xs text-[var(--paragraph)]">
          {isCancelled ? '取消済み' : '振替元のため操作できません'}
        </p>
      )}
    </div>
  );
}
