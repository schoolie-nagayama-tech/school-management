'use client';

import React from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui';
import { DayCell } from './DayCell';
import { StudentCard } from './StudentCard';
import type { ScheduleEntry, ScheduleTimeSlot } from '@/types/schedule';
import type { TeacherGroup } from './DayCell';
import { Printer } from 'lucide-react';

function formatDayHeader(dateStr: string): { date: string; weekday: string } {
  const d = new Date(dateStr + 'Z');
  const week = ['日', '月', '火', '水', '木', '金', '土'][d.getUTCDay()];
  return {
    date: `${d.getUTCMonth() + 1}/${d.getUTCDate()}`,
    weekday: `(${week})`,
  };
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
  activeEntry: ScheduleEntry | null;
  groupEntriesByTeacher: (entries: ScheduleEntry[], date: string, slotId: string) => TeacherGroup[];
  getTeacherGroupsForCell: (dateStr: string, slotId: string, slotNumber: number) => TeacherGroup[];
  onDragStart: (e: { active: { id: unknown } }) => void;
  onDragEnd: (event: { active: { id: string }; over: { id: string } | null }) => Promise<void>;
  onAddTeacher: (date: string, slotId: string) => void;
  onAddStudent: (date: string, slotId: string, teacherId: string) => void;
  onRemoveTeacher: (date: string, slotId: string, teacherId: string, entryCount: number) => void;
  onStudentClick: (entry: ScheduleEntry, e: React.MouseEvent) => void;
  onTransferClick?: (entry: ScheduleEntry) => void;
  onTransferTargetClick?: (date: string, slotId: string, teacherId: string) => void;
  onPrintDay?: (date: string) => void;
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
    activeEntry,
    groupEntriesByTeacher,
    getTeacherGroupsForCell,
    onDragStart,
    onDragEnd,
    onAddTeacher,
    onAddStudent,
    onRemoveTeacher,
    onStudentClick,
    onTransferClick,
    onTransferTargetClick,
    onPrintDay,
  } = props;

  // クリックでドラッグが始まらないよう、一定距離動いてからドラッグ開始
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  return (
    <DndContext
      sensors={sensors}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <div className="overflow-x-auto border border-[var(--surface)] rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16 bg-[var(--surface)] font-medium text-[var(--headline)] text-center align-middle py-1">
                <div className="text-[10px] text-[var(--paragraph-light)]">コマ</div>
                <div className="text-[9px] mt-0.5">/ 時間</div>
              </TableHead>
              {weekDates.map((dateStr) => {
                const { date, weekday } = formatDayHeader(dateStr);
                return (
                  <TableHead
                    key={dateStr}
                    className="min-w-[120px] max-w-[160px] bg-[var(--surface)] font-medium text-center text-[var(--headline)] border-l border-[var(--stroke)] first:border-l-0 py-1"
                  >
                    <div className="flex items-center justify-center gap-1">
                      <span className="text-xs">{date}</span>
                      {onPrintDay && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onPrintDay(dateStr);
                          }}
                          className="p-0.5 rounded hover:bg-[var(--surface)] text-[var(--paragraph-light)] hover:text-[var(--primary)] no-print"
                          title={`${dateStr} を印刷`}
                          aria-label={`${dateStr} を印刷`}
                        >
                          <Printer className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    <div className="text-[10px] text-[var(--paragraph)] mt-0.5">{weekday}</div>
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {timeSlots.map((slot) => (
              <TableRow key={slot.id} className="border-b border-[var(--surface)]">
                <TableCell className="w-16 align-top bg-[var(--surface)] text-[10px] py-1 border border-[var(--surface)]">
                  <div className="font-semibold text-[var(--headline)]">{slot.slot_number}限</div>
                  <div className="text-[9px] text-[var(--paragraph-light)] mt-0.5">
                    {slot.start_time?.slice(0, 5)}〜{slot.end_time?.slice(0, 5)}
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
                      activeDragEntry={activeEntry}
                      transferMode={!!transferMode}
                      onAddTeacher={() => onAddTeacher(dateStr, slot.id)}
                      onAddStudent={(teacherId) => onAddStudent(dateStr, slot.id, teacherId)}
                      onRemoveTeacher={(teacherId, entryCount) =>
                        onRemoveTeacher(dateStr, slot.id, teacherId, entryCount)
                      }
                      onStudentClick={onStudentClick}
                      onTransferClick={onTransferClick}
                      onTransferTargetClick={
                        onTransferTargetClick
                          ? (_, slotId, teacherId) =>
                              onTransferTargetClick(dateStr, slotId, teacherId)
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
        {activeEntry ? (
          <div className="opacity-95 shadow-lg cursor-grabbing">
            <StudentCard
              entry={activeEntry}
              onClick={() => {}}
            />
          </div>
        ) : null}
      </DragOverlay>
      <p className="text-[10px] text-[var(--paragraph-light)] mt-1 text-center">
        横＝日付・縦＝コマ
      </p>
    </DndContext>
  );
}
