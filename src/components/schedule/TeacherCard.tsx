'use client';

import React, { useMemo } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { DraggableStudentCard } from './DraggableStudentCard';
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

  const slotBadge =
    activeEntries.length === 0
      ? '空き'
      : activeEntries.length === 1
        ? '残1'
        : '満員';
  const slotBadgeClass =
    activeEntries.length === 0
      ? 'bg-green-100 text-green-700'
      : activeEntries.length === 1
        ? 'bg-yellow-100 text-yellow-700'
        : 'bg-red-100 text-red-700';

  const isOverAndCanDrop = isOver && canDrop;
  const isOverAndCannotDrop = isOver && !canDrop && activeDragEntry;

  const handleCardClick = () => {
    if (transferMode && onTransferTargetClick) onTransferTargetClick(date, timeSlotId, teacher.id);
  };

  return (
    <div
      className={`
        min-h-[72px] rounded border border-dashed border-[var(--stroke)] mb-1.5
        transition-colors
        ${transferMode ? 'cursor-pointer hover:border-[var(--primary)] hover:bg-blue-50/50' : ''}
        ${!transferMode && !isOver ? 'bg-white border-[var(--headline)]/20 hover:border-[var(--primary)]/40 hover:bg-gray-50/50' : ''}
      `}
      onClick={transferMode && onTransferTargetClick ? handleCardClick : undefined}
      role={transferMode && onTransferTargetClick ? 'button' : undefined}
    >
      {/* ヘッダーは droppable の外に置き、×クリックを確実に受け取る */}
      <div
        className="flex justify-between items-center px-1.5 py-1 border-b border-[var(--surface)]"
        onClick={(e) => transferMode && e.stopPropagation()}
      >
        <span className="font-medium text-xs text-[var(--headline)] truncate">{displayName}</span>
        <span
          className={`text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 ml-1 ${slotBadgeClass}`}
        >
          {slotBadge}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRemoveTeacher();
          }}
          className="flex-shrink-0 ml-0.5 w-5 h-5 flex items-center justify-center rounded text-[var(--paragraph-light)] hover:text-[#d9376e] hover:bg-red-50 text-sm"
          aria-label="講師を削除"
        >
          ×
        </button>
      </div>

      <div
        ref={setNodeRef}
        className={`
          p-1.5 rounded-b transition-colors
          ${isOverAndCanDrop ? 'border-green-500 bg-green-50' : ''}
          ${isOverAndCannotDrop ? 'border-red-500 bg-red-50 cursor-not-allowed' : ''}
        `}
      >
        <div className="space-y-0.5">
          {activeEntries.map((entry) => (
            <DraggableStudentCard
              key={entry.id}
              entry={entry}
              onStudentClick={onStudentClick}
              onTransferClick={onTransferClick}
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
            className="w-full mt-1 py-1 text-[10px] text-[var(--paragraph-light)] hover:bg-[var(--surface)] rounded border border-dashed border-[var(--stroke)]"
          >
            + 生徒追加（残り{maxStudents - activeEntries.length}枠）
          </button>
        )}
      </div>
    </div>
  );
});
