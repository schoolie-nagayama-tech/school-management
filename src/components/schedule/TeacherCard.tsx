'use client';

import React from 'react';
import { useDraggable } from '@dnd-kit/core';
import { StudentCard } from './StudentCard';
import type { ScheduleEntry } from '@/types/schedule';

const TEACHER_CARD_DRAG_PREFIX = 'teacher-card-';

export function getTeacherCardId(date: string, slotId: string, teacherId: string): string {
  return `${TEACHER_CARD_DRAG_PREFIX}${date}|${slotId}|${teacherId}`;
}

export function parseTeacherCardId(
  id: string
): { date: string; slotId: string; teacherId: string } | null {
  if (!id.startsWith(TEACHER_CARD_DRAG_PREFIX)) return null;
  const rest = id.slice(TEACHER_CARD_DRAG_PREFIX.length);
  const parts = rest.split('|');
  if (parts.length !== 3) return null;
  return { date: parts[0], slotId: parts[1], teacherId: parts[2] };
}

export interface TeacherCardProps {
  teacher: { id: string; display_name: string | null; email: string | null };
  entries: ScheduleEntry[];
  date: string;
  timeSlotId: string;
  maxStudents: number;
  isClosed: boolean;
  onAddStudent: () => void;
  onRemoveTeacher: () => void;
  onStudentClick: (entry: ScheduleEntry, e: React.MouseEvent) => void;
  activeDragId: string | null;
}

export const TeacherCard = React.memo(function TeacherCard({
  teacher,
  entries,
  date,
  timeSlotId,
  maxStudents,
  isClosed,
  onAddStudent,
  onRemoveTeacher,
  onStudentClick,
  activeDragId,
}: TeacherCardProps) {
  const dragId = getTeacherCardId(date, timeSlotId, teacher.id);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: dragId,
    data: {
      type: 'teacher-card',
      date,
      timeSlotId,
      teacherId: teacher.id,
      entryIds: entries.map((e) => e.id),
    },
  });

  const activeEntries = entries.filter(
    (e) => e.status !== 'cancelled' && e.status !== 'transferred_out'
  );
  const canAddStudent = !isClosed && activeEntries.length < maxStudents;
  const displayName = teacher.display_name || teacher.email || '—';

  return (
    <div
      ref={setNodeRef}
      className={`bg-white border border-[var(--headline)]/20 rounded-lg shadow-sm p-2 mb-2 hover:shadow-md transition-shadow ${
        isDragging ? 'opacity-70 shadow-lg ring-2 ring-[var(--primary)]' : ''
      }`}
    >
      <div
        className={`flex justify-between items-center mb-2 border-b border-[var(--surface)] pb-1.5 ${
          isDragging ? '' : 'cursor-grab active:cursor-grabbing'
        }`}
        {...(activeDragId === dragId ? {} : { ...listeners, ...attributes })}
      >
        <span className="font-medium text-sm text-[var(--headline)] truncate">{displayName}</span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemoveTeacher();
          }}
          className="flex-shrink-0 ml-1 w-6 h-6 flex items-center justify-center rounded text-[var(--paragraph-light)] hover:text-[#d9376e] hover:bg-red-50"
          aria-label="講師カードを削除"
        >
          ×
        </button>
      </div>

      <div className="space-y-1">
        {activeEntries.map((entry) => (
          <StudentCard
            key={entry.id}
            entry={entry}
            onClick={(e) => {
              e.stopPropagation();
              onStudentClick(entry, e);
            }}
          />
        ))}
      </div>

      {canAddStudent && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onAddStudent();
          }}
          className="w-full mt-2 py-1.5 text-xs text-[var(--paragraph-light)] hover:bg-[var(--surface)] rounded border border-dashed border-[var(--stroke)]"
        >
          + 生徒追加
        </button>
      )}
    </div>
  );
});
