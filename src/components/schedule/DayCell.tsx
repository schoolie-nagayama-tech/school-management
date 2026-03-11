'use client';

import React from 'react';
import { TeacherCard } from './TeacherCard';
import type { ScheduleEntry, ScheduleTimeSlot } from '@/types/schedule';

export interface TeacherGroup {
  teacher: { id: string; display_name: string | null; email: string | null };
  entries: ScheduleEntry[];
  isAvailableOnly: boolean; // true = 出勤可能だが授業なし
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
  maxStudentsPerTeacher: number;
  activeDragId: string | null;
  activeDragEntry: ScheduleEntry | null;
  transferMode: boolean;
  onAddTeacher: (existingTeacherIds: string[]) => void;
  onAddStudent: (teacherId: string) => void;
  onRemoveTeacher: (teacherId: string, entryCount: number) => void;
  onStudentClick: (entry: ScheduleEntry, e: React.MouseEvent) => void;
  onTransferClick?: (entry: ScheduleEntry) => void;
  onTransferTargetClick?: (date: string, slotId: string, teacherId: string) => void;
  getKoushuInfo?: (studentId: string) => { enrolled: number; scheduled: number } | null;
}

export const DayCell = React.memo(function DayCell({
  date,
  timeSlot,
  isClosed,
  teacherGroups,
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
  getKoushuInfo,
}: DayCellProps) {
  if (isClosed) {
    return (
      <div className="py-2 rounded-lg bg-gray-100 text-gray-400 text-xs text-center flex items-center justify-center min-h-[40px]">
        休講日
      </div>
    );
  }

  return (
    <div className="py-1 space-y-1 min-h-[40px]">
      {teacherGroups.map((group) => (
        <TeacherCard
          key={group.teacher.id}
          teacher={group.teacher}
          entries={group.entries}
          isAvailableOnly={group.isAvailableOnly}
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
          getKoushuInfo={getKoushuInfo}
        />
      ))}
      {!transferMode && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onAddTeacher(teacherGroups.map((g) => g.teacher.id));
          }}
          className="w-full py-1 text-[10px] text-gray-300 hover:text-gray-500 rounded-lg transition-colors duration-200"
        >
          + 講師追加
        </button>
      )}
    </div>
  );
});
