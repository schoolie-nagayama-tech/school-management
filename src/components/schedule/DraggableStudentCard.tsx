'use client';

import React from 'react';
import { useDraggable } from '@dnd-kit/core';
import { StudentCard, type SwapState } from './StudentCard';
import type { ScheduleEntry } from '@/types/schedule';

export interface DraggableStudentCardProps {
  entry: ScheduleEntry;
  onStudentClick: (entry: ScheduleEntry, e: React.MouseEvent) => void;
  koushuEnrolled?: number;
  koushuScheduled?: number;
  /** §2.12 入れ替えモード時の行ハイライト状態 */
  swapState?: SwapState;
}

export const DraggableStudentCard = React.memo(function DraggableStudentCard({
  entry,
  onStudentClick,
  koushuEnrolled,
  koushuScheduled,
  swapState,
}: DraggableStudentCardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: entry.id,
    data: { type: 'student-entry', entry },
    // 下書き（擬似エントリ）はドラッグ不可。実エントリではないため移動・振替の対象にしない。
    disabled: !!entry.isDraft,
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={
        entry.isDraft
          ? ''
          : isDragging
            ? 'opacity-70 cursor-grabbing'
            : 'cursor-grab active:cursor-grabbing'
      }
    >
      <StudentCard
        entry={entry}
        onClick={(e) => {
          e.stopPropagation();
          onStudentClick(entry, e);
        }}
        koushuEnrolled={koushuEnrolled}
        koushuScheduled={koushuScheduled}
        swapState={swapState}
      />
    </div>
  );
});
