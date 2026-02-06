'use client';

import React from 'react';
import { useDraggable } from '@dnd-kit/core';
import { StudentCard } from './StudentCard';
import type { ScheduleEntry } from '@/types/schedule';

export interface DraggableStudentCardProps {
  entry: ScheduleEntry;
  onStudentClick: (entry: ScheduleEntry, e: React.MouseEvent) => void;
  onTransferClick?: (entry: ScheduleEntry) => void;
}

export const DraggableStudentCard = React.memo(function DraggableStudentCard({
  entry,
  onStudentClick,
  onTransferClick,
}: DraggableStudentCardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: entry.id,
    data: { type: 'student-entry', entry },
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={isDragging ? 'opacity-70 cursor-grabbing' : 'cursor-grab active:cursor-grabbing'}
    >
      <StudentCard
        entry={entry}
        onClick={(e) => {
          e.stopPropagation();
          onStudentClick(entry, e);
        }}
        onTransferClick={onTransferClick}
      />
    </div>
  );
});
