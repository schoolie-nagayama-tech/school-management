'use client';

import React from 'react';
import { useDraggable } from '@dnd-kit/core';
import { Badge } from '@/components/ui';
import type { ScheduleEntry } from '@/types/schedule';

const ATTENDANCE_BG: Record<string, string> = {
  present: 'bg-green-100',
  absent: 'bg-red-100',
  late: 'bg-amber-100',
};
const DEFAULT_BG = 'bg-white';

function gradeLabel(g: number): string {
  if (g <= 6) return `小${g}`;
  if (g <= 9) return `中${g - 6}`;
  return `高${g - 9}`;
}

interface DraggableEntryProps {
  entry: ScheduleEntry;
  isDragging?: boolean;
}

export const DraggableEntry = React.memo(function DraggableEntry({
  entry,
  isDragging,
}: DraggableEntryProps) {
  const { attributes, listeners, setNodeRef } = useDraggable({
    id: entry.id,
    data: { entry },
  });

  const isTransferIn = entry.status === 'transferred_in';
  const bg = entry.attendance_status
    ? (ATTENDANCE_BG[entry.attendance_status] ?? DEFAULT_BG)
    : DEFAULT_BG;
  const studentName = entry.student
    ? `${entry.student.last_name} ${entry.student.first_name}（${gradeLabel(entry.student.grade)}）`
    : entry.student_id;
  const subjectNames =
    (entry.subject_ids || [])
      .map((id) => entry.subjects?.find((s) => s.id === id)?.name ?? '')
      .filter(Boolean)
      .join('・') || '—';

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`rounded px-2 py-1 text-xs cursor-grab active:cursor-grabbing border ${bg} ${
        isDragging ? 'opacity-50 shadow-lg' : 'border-transparent'
      }`}
    >
      {isTransferIn && (
        <Badge variant="outline" className="mb-1 text-[10px] bg-blue-100 border-blue-300">
          振替
        </Badge>
      )}
      <div className="font-medium truncate">{studentName}</div>
      <div className="text-[10px] text-[var(--paragraph)] truncate">{subjectNames}</div>
      {entry.seat_label && (
        <div className="text-[10px] text-[var(--paragraph-light)]">[{entry.seat_label}]</div>
      )}
    </div>
  );
});
