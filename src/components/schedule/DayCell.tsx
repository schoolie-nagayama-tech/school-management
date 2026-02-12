'use client';

import React from 'react';
import { TeacherCard } from './TeacherCard';
import type { ScheduleEntry, ScheduleTimeSlot } from '@/types/schedule';

export interface TeacherGroup {
  teacher: { id: string; display_name: string | null; email: string | null };
  entries: ScheduleEntry[];
}

const DAY_CELL_DROP_PREFIX = 'day-cell-';

export function getDayCellId(date: string, slotId: string): string {
  return `${DAY_CELL_DROP_PREFIX}${date}|${slotId}`;
}

export function parseDayCellId(id: string): { date: string; slotId: string } | null {
  if (!id.startsWith(DAY_CELL_DROP_PREFIX)) return null;
  const rest = id.slice(DAY_CELL_DROP_PREFIX.length);
  const parts = rest.split('|');
  if (parts.length !== 2) return null;
  return { date: parts[0], slotId: parts[1] };
}

export interface DayCellProps {
  date: string;
  timeSlot: ScheduleTimeSlot;
  isClosed: boolean;
  teacherGroups: TeacherGroup[];
  emptyTeacherIds: string[];
  teachersMap: Map<string, { id: string; display_name: string | null; email: string | null }>;
  maxStudentsPerTeacher: number;
  activeDragId: string | null;
  activeDragEntry: ScheduleEntry | null;
  transferMode: boolean;
  onAddTeacher: () => void;
  onAddStudent: (teacherId: string) => void;
  onRemoveTeacher: (teacherId: string, entryCount: number) => void;
  onStudentClick: (entry: ScheduleEntry, e: React.MouseEvent) => void;
  onTransferClick?: (entry: ScheduleEntry) => void;
  onTransferTargetClick?: (date: string, slotId: string, teacherId: string) => void;
}

export const DayCell = React.memo(function DayCell({
  date,
  timeSlot,
  isClosed,
  teacherGroups,
  emptyTeacherIds,
  teachersMap,
  maxStudentsPerTeacher,
  activeDragId,
  activeDragEntry,
  transferMode,
  onAddTeacher,
  onAddStudent,
  onRemoveTeacher,
  onStudentClick,
  onTransferClick,
  onTransferTargetClick,
}: DayCellProps) {
  if (isClosed) {
    return (
      <div className="py-3 rounded-xl bg-gray-100 text-gray-400 text-sm text-center flex items-center justify-center min-h-[80px]">
        休講日
      </div>
    );
  }

  return (
    <div className="py-3 space-y-3 min-h-[80px]">
      {teacherGroups.map((group) => (
        <TeacherCard
          key={group.teacher.id}
          teacher={group.teacher}
          entries={group.entries}
          date={date}
          timeSlotId={timeSlot.id}
          maxStudents={maxStudentsPerTeacher}
          isClosed={false}
          onAddStudent={() => onAddStudent(group.teacher.id)}
          onRemoveTeacher={() =>
            onRemoveTeacher(
              group.teacher.id,
              group.entries.filter(
                (e) => e.status !== 'cancelled' && e.status !== 'transferred_out'
              ).length
            )
          }
          onStudentClick={onStudentClick}
          onTransferClick={onTransferClick}
          activeDragId={activeDragId}
          activeDragEntry={activeDragEntry}
          transferMode={transferMode}
          onTransferTargetClick={onTransferTargetClick}
        />
      ))}
      {emptyTeacherIds.map((teacherId) => {
        const teacher = teachersMap.get(teacherId);
        if (!teacher) return null;
        return (
          <TeacherCard
            key={`empty-${teacherId}`}
            teacher={teacher}
            entries={[]}
            date={date}
            timeSlotId={timeSlot.id}
            maxStudents={maxStudentsPerTeacher}
            isClosed={false}
            onAddStudent={() => onAddStudent(teacherId)}
            onRemoveTeacher={() => onRemoveTeacher(teacherId, 0)}
            onStudentClick={onStudentClick}
            onTransferClick={onTransferClick}
            activeDragId={activeDragId}
            activeDragEntry={activeDragEntry}
            transferMode={transferMode}
            onTransferTargetClick={onTransferTargetClick}
          />
        );
      })}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onAddTeacher();
        }}
        className="w-full py-2 text-xs text-gray-400 hover:text-gray-600 rounded-xl transition-colors duration-200"
      >
        + 講師追加
      </button>
    </div>
  );
});
