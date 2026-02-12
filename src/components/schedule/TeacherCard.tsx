'use client';

import React, { useMemo } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { DraggableStudentCard } from './DraggableStudentCard';
import { Plus } from 'lucide-react';
import type { ScheduleEntry } from '@/types/schedule';

/** 講師ブロックをドロップ先として識別するID（生徒D&D用） */
const TEACHER_SLOT_DROP_PREFIX = 'teacher-slot-';

export function getTeacherSlotId(date: string, slotId: string, teacherId: string): string {
  return `${TEACHER_SLOT_DROP_PREFIX}${date}|${slotId}|${teacherId}`;
}

export function parseTeacherSlotId(
  id: string
): { date: string; slotId: string; teacherId: string } | null {
  if (!id.startsWith(TEACHER_SLOT_DROP_PREFIX)) return null;
  const rest = id.slice(TEACHER_SLOT_DROP_PREFIX.length);
  const parts = rest.split('|');
  if (parts.length !== 3) return null;
  return { date: parts[0], slotId: parts[1], teacherId: parts[2] };
}

/** 旧講師カードドラッグ用（互換のため残す） */
export function getTeacherCardId(date: string, slotId: string, teacherId: string): string {
  return `teacher-card-${date}|${slotId}|${teacherId}`;
}

export function parseTeacherCardId(
  id: string
): { date: string; slotId: string; teacherId: string } | null {
  if (!id.startsWith('teacher-card-')) return null;
  const rest = id.slice('teacher-card-'.length);
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
  onTransferClick?: (entry: ScheduleEntry) => void;
  activeDragId: string | null;
  /** ドラッグ中の生徒エントリ（ドロップ可否・視覚フィードバック用） */
  activeDragEntry: ScheduleEntry | null;
  /** 振替モード時: この講師ブロックをクリックで振替先に選ぶ */
  transferMode?: boolean;
  onTransferTargetClick?: (date: string, slotId: string, teacherId: string) => void;
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
  onTransferClick,
  activeDragId,
  activeDragEntry,
  transferMode,
  onTransferTargetClick,
}: TeacherCardProps) {
  const dropId = getTeacherSlotId(date, timeSlotId, teacher.id);
  const { isOver, setNodeRef } = useDroppable({ id: dropId });

  const activeEntries = entries.filter(
    (e) => e.status !== 'cancelled' && e.status !== 'transferred_out'
  );
  const canAddStudent = !isClosed && activeEntries.length < maxStudents;
  const displayName = teacher.display_name || teacher.email || '—';

  const canDrop = useMemo(() => {
    if (!activeDragEntry) return false;
    const isSourceBlock =
      activeDragEntry.entry_date === date &&
      activeDragEntry.time_slot_id === timeSlotId &&
      activeDragEntry.teacher_id === teacher.id;
    if (isSourceBlock) return false;
    const hasStudent = activeEntries.some((e) => e.student_id === activeDragEntry.student_id);
    if (hasStudent) return false;
    if (activeEntries.length >= maxStudents) return false;
    return true;
  }, [activeDragEntry, date, timeSlotId, teacher.id, activeEntries, maxStudents]);

  const remaining = maxStudents - activeEntries.length;
  const slotLabel = remaining === 0 ? '満員' : `残${remaining}`;

  const isOverAndCanDrop = isOver && canDrop;
  const isOverAndCannotDrop = isOver && !canDrop && activeDragEntry;

  const handleCardClick = () => {
    if (transferMode && onTransferTargetClick) onTransferTargetClick(date, timeSlotId, teacher.id);
  };

  const isOnDuty = activeEntries.length > 0;

  return (
    <div
      className={`
        group relative min-h-[72px] rounded-xl border border-gray-200 bg-white
        shadow-sm hover:shadow-md hover:bg-gray-50 transition-all duration-150
        ${isOnDuty ? 'border-l-2 border-l-[var(--primary)]' : ''}
        ${!isOnDuty ? 'bg-gray-50/30' : ''}
        ${transferMode ? 'cursor-pointer hover:border-[var(--primary)]/40 hover:bg-gray-50/50' : ''}
        ${isOverAndCanDrop ? 'ring-2 ring-green-400 bg-green-50/50' : ''}
        ${isOverAndCannotDrop ? 'ring-2 ring-red-200 bg-red-50/50 cursor-not-allowed' : ''}
      `}
      onClick={transferMode && onTransferTargetClick ? handleCardClick : undefined}
      role={transferMode && onTransferTargetClick ? 'button' : undefined}
    >
      <div
        className="flex justify-between items-center px-2.5 py-2 border-b border-gray-100"
        onClick={(e) => transferMode && e.stopPropagation()}
      >
        <span className="font-medium text-base text-gray-700 min-w-0 truncate flex-1">
          {displayName}
        </span>
        <span className="text-xs text-gray-400 flex-shrink-0 ml-2 text-right tabular-nums">
          {slotLabel}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRemoveTeacher();
          }}
          className="flex-shrink-0 ml-1 w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:text-red-500 hover:bg-red-50 text-sm"
          aria-label="講師を削除"
        >
          ×
        </button>
      </div>

      <div ref={setNodeRef} className="relative p-2 rounded-b-xl">
        <div className="space-y-2">
          {activeEntries.map((entry) => (
            <DraggableStudentCard
              key={entry.id}
              entry={entry}
              onStudentClick={onStudentClick}
              onTransferClick={onTransferClick}
            />
          ))}
        </div>

        {canAddStudent && !transferMode && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onAddStudent();
            }}
            className="absolute bottom-2 right-2 w-7 h-7 rounded-full flex items-center justify-center bg-white border border-gray-200 text-gray-500 hover:text-[var(--primary)] hover:border-[var(--primary)]/30 opacity-0 group-hover:opacity-100 transition-opacity duration-200 shadow-sm"
            aria-label="生徒を追加"
          >
            <Plus className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
});
