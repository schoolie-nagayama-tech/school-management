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
      <td className="border border-[var(--surface)] p-1 align-top bg-[var(--surface)] text-center text-[var(--paragraph-light)] text-xs min-w-[120px] max-w-[160px]">
        休講日
      </td>
    );
  }

  return (
    <td className="border border-[var(--surface)] border-l-[var(--stroke)] p-1 align-top min-w-[120px] max-w-[160px]">
      <div className="space-y-1 min-h-[48px]">
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
          className="w-full py-1 text-[10px] text-[var(--paragraph-light)] hover:bg-[var(--surface)] rounded border border-dashed border-[var(--stroke)]"
        >
          + 講師追加
        </button>
      </div>
    </td>
  );
});
