'use client';

import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { DraggableEntry } from './DraggableEntry';
import type { ScheduleEntry, ScheduleTimeSlot } from '@/types/schedule';

const MAX_STUDENTS_PER_TEACHER = 2;

interface DroppableCellProps {
  id: string;
  date: string;
  slotId: string;
  teacherId: string;
  entries: ScheduleEntry[];
  timeSlot?: ScheduleTimeSlot;
  isClosed?: boolean;
  canDrop: boolean;
  /** このコマで講師が出勤可能か。false のときは追加・ドロップ不可でグレー表示 */
  isSlotAvailable?: boolean;
  onCellClick: (e: React.MouseEvent) => void;
  onEntryClick: (entry: ScheduleEntry, e: React.MouseEvent) => void;
  activeId: string | null;
}

export const DroppableCell = React.memo(function DroppableCell({
  id,
  entries,
  timeSlot: _timeSlot,
  isClosed,
  canDrop,
  isSlotAvailable = true,
  onCellClick,
  onEntryClick,
  activeId,
}: DroppableCellProps) {
  const { isOver, setNodeRef } = useDroppable({ id });

  const activeEntries = entries.filter(
    (e) => e.status !== 'cancelled' && e.status !== 'transferred_out'
  );
  const transferredOutEntries = entries.filter((e) => e.status === 'transferred_out');
  const canAdd = activeEntries.length === 0 && !isClosed && isSlotAvailable;

  return (
    <td
      ref={setNodeRef}
      className={`border border-[var(--surface)] p-1 min-w-[120px] align-top ${
        isOver ? (canDrop ? 'ring-2 ring-green-500 bg-green-50' : 'ring-2 ring-red-500 bg-red-50') : ''
      } ${isClosed ? 'bg-[var(--surface)]' : ''} ${!isSlotAvailable && !isClosed ? 'bg-[var(--surface)]' : ''}`}
      onClick={canAdd ? onCellClick : undefined}
    >
      <div className="min-h-[44px] space-y-1">
        {transferredOutEntries.map((entry) => {
          const studentName = entry.student
            ? `${entry.student.last_name} ${entry.student.first_name}`
            : entry.student_id;
          return (
            <div
              key={entry.id}
              className="rounded px-2 py-1 text-xs bg-[var(--stroke)] text-[#666] line-through"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="truncate">{studentName}</div>
              <div className="text-[10px]">→ 振替先へ</div>
            </div>
          );
        })}
        {activeEntries.map((entry) => (
          <div key={entry.id} onClick={(e) => { e.stopPropagation(); onEntryClick(entry, e); }}>
            <DraggableEntry entry={entry} isDragging={activeId === entry.id} />
          </div>
        ))}
        {activeEntries.length === 0 && !isClosed && isSlotAvailable && (
          <div
            className="min-h-[40px] rounded border border-dashed border-[var(--stroke)] flex items-center justify-center text-[var(--paragraph-light)] text-xs hover:border-[var(--primary)] hover:text-[var(--primary)] cursor-pointer"
            onClick={onCellClick}
          >
            ＋ 追加
          </div>
        )}
        {activeEntries.length === 0 && !isClosed && !isSlotAvailable && (
          <div className="min-h-[40px] flex items-center justify-center text-[var(--paragraph-light)] text-[10px]">
            —
          </div>
        )}
      </div>
    </td>
  );
});

export function getCellId(date: string, slotId: string, teacherId: string): string {
  return `cell-${date}|${slotId}|${teacherId}`;
}

export function parseCellId(cellId: string): { date: string; slotId: string; teacherId: string } | null {
  if (!cellId.startsWith('cell-')) return null;
  const rest = cellId.slice(5);
  const parts = rest.split('|');
  if (parts.length !== 3) return null;
  return { date: parts[0], slotId: parts[1], teacherId: parts[2] };
}

export { MAX_STUDENTS_PER_TEACHER };
