'use client';

import React from 'react';
import { DndContext, DragOverlay } from '@dnd-kit/core';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui';
import { DayCell } from './DayCell';
import type { ScheduleEntry, ScheduleTimeSlot } from '@/types/schedule';
import type { TeacherGroup } from './DayCell';

function formatDayHeader(dateStr: string): string {
  const d = new Date(dateStr + 'Z');
  const week = ['日', '月', '火', '水', '木', '金', '土'][d.getUTCDay()];
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${week})`;
}

export interface WeeklyScheduleGridViewProps {
  schoolId: string;
  weekDates: string[];
  timeSlots: ScheduleTimeSlot[];
  entries: ScheduleEntry[];
  closedDates: string[];
  emptyTeacherSlots: Record<string, string[]>;
  maxStudentsPerTeacher: number;
  transferMode: { sourceEntry: ScheduleEntry } | null;
  teachersMap: Map<string, { id: string; display_name: string | null; email: string | null }>;
  activeId: string | null;
  activeTeacherGroup: { teacher: { id: string; display_name: string | null; email: string | null }; entries: ScheduleEntry[] } | null;
  groupEntriesByTeacher: (entries: ScheduleEntry[], date: string, slotId: string) => TeacherGroup[];
  getTeacherGroupsForCell: (dateStr: string, slotId: string, slotNumber: number) => TeacherGroup[];
  onDragStart: (e: { active: { id: unknown } }) => void;
  onDragEnd: (event: { active: { id: string }; over: { id: string } | null }) => Promise<void>;
  onAddTeacher: (date: string, slotId: string) => void;
  onAddStudent: (date: string, slotId: string, teacherId: string) => void;
  onRemoveTeacher: (date: string, slotId: string, teacherId: string, entryCount: number) => void;
  onStudentClick: (entry: ScheduleEntry, e: React.MouseEvent) => void;
  onTransferTargetSelect: (date: string, slotId: string) => void;
}

export function WeeklyScheduleGridView(props: WeeklyScheduleGridViewProps) {
  const {
    schoolId: _schoolId,
    weekDates,
    timeSlots,
    entries,
    closedDates,
    emptyTeacherSlots,
    maxStudentsPerTeacher,
    transferMode,
    teachersMap,
    activeId,
    activeTeacherGroup,
    groupEntriesByTeacher,
    getTeacherGroupsForCell,
    onDragStart,
    onDragEnd,
    onAddTeacher,
    onAddStudent,
    onRemoveTeacher,
    onStudentClick,
    onTransferTargetSelect,
  } = props;

  return (
    <DndContext onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="overflow-x-auto border border-[var(--surface)] rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24 bg-[var(--surface)] font-medium text-[var(--headline)]">
                コマ
              </TableHead>
              {weekDates.map((dateStr) => (
                <TableHead
                  key={dateStr}
                  className="min-w-[160px] max-w-[200px] bg-[var(--surface)] font-medium text-center text-[var(--headline)]"
                >
                  {formatDayHeader(dateStr)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {timeSlots.map((slot) => (
              <TableRow key={slot.id}>
                <TableCell className="w-24 align-top bg-[var(--surface)] text-xs py-2 border border-[var(--surface)]">
                  <div className="font-medium text-[var(--headline)]">{slot.slot_number}限</div>
                  <div className="text-[10px] text-[var(--paragraph-light)]">
                    {slot.start_time?.slice(0, 5)}-{slot.end_time?.slice(0, 5)}
                  </div>
                </TableCell>
                {weekDates.map((dateStr) => {
                  const isClosed = closedDates.includes(dateStr);
                  const teacherGroups = getTeacherGroupsForCell(
                    dateStr,
                    slot.id,
                    slot.slot_number
                  );
                  const cellKey = `${dateStr}-${slot.id}`;
                  const emptyIds = emptyTeacherSlots[cellKey] ?? [];
                  const isTransferTarget = !!(
                    transferMode &&
                    !(
                      transferMode.sourceEntry.entry_date === dateStr &&
                      transferMode.sourceEntry.time_slot_id === slot.id
                    )
                  );

                  return (
                    <DayCell
                      key={cellKey}
                      date={dateStr}
                      timeSlot={slot}
                      isClosed={isClosed}
                      teacherGroups={teacherGroups}
                      emptyTeacherIds={emptyIds}
                      teachersMap={teachersMap}
                      maxStudentsPerTeacher={maxStudentsPerTeacher}
                      activeDragId={activeId}
                      isTransferTarget={isTransferTarget}
                      onAddTeacher={() => onAddTeacher(dateStr, slot.id)}
                      onAddStudent={(teacherId) => onAddStudent(dateStr, slot.id, teacherId)}
                      onRemoveTeacher={(teacherId, entryCount) =>
                        onRemoveTeacher(dateStr, slot.id, teacherId, entryCount)
                      }
                      onStudentClick={onStudentClick}
                      onCellClickForTransfer={
                        isTransferTarget
                          ? () => onTransferTargetSelect(dateStr, slot.id)
                          : undefined
                      }
                    />
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <DragOverlay>
        {activeTeacherGroup ? (
          <div className="bg-white border border-[var(--headline)]/20 rounded-lg shadow-lg p-2 min-w-[160px] opacity-95">
            <div className="font-medium text-sm text-[var(--headline)] mb-2 border-b border-[var(--surface)] pb-1.5">
              {activeTeacherGroup.teacher.display_name ||
                activeTeacherGroup.teacher.email ||
                '—'}
            </div>
            <div className="space-y-1">
              {activeTeacherGroup.entries.slice(0, 3).map((entry) => {
                const name = entry.student
                  ? `${entry.student.last_name}${entry.student.first_name}`
                  : entry.student_id;
                return (
                  <div key={entry.id} className="text-xs py-1 px-2 bg-[#f5f5f5] rounded">
                    {name}
                  </div>
                );
              })}
              {activeTeacherGroup.entries.length > 3 && (
                <div className="text-xs text-[var(--paragraph-light)]">
                  他{activeTeacherGroup.entries.length - 3}名
                </div>
              )}
            </div>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
