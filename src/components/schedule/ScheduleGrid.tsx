'use client';

import React, { useMemo, useState } from 'react';
import { DndContext, DragOverlay, type DragStartEvent, type DragEndEvent } from '@dnd-kit/core';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui';
import {
  DroppableCell,
  getCellId,
  parseCellId,
  MAX_STUDENTS_PER_TEACHER,
} from './DroppableCell';
import { DraggableEntry } from './DraggableEntry';
import type { ScheduleEntry, ScheduleTimeSlot } from '@/types/schedule';

interface TeacherOption {
  id: string;
  display_name: string | null;
  email: string | null;
  user_schools?: Array<{ school_id: string }>;
  /** 曜日ごとの出勤可能コマ。キー "0"〜"6"、値は 1〜7 限の配列。空/未設定は全コマ可 */
  available_slot_numbers_by_day?: Record<string, number[]> | null;
}

/** その曜日・そのコマで講師が出勤可能か */
function isTeacherAvailableForSlot(
  teacher: TeacherOption,
  dateStr: string,
  slotNumber: number
): boolean {
  const byDay = teacher.available_slot_numbers_by_day;
  if (!byDay || Object.keys(byDay).length === 0) return true;
  const dayOfWeek = new Date(dateStr + 'Z').getUTCDay();
  const dayKey = String(dayOfWeek);
  const slotNums = byDay[dayKey];
  if (!slotNums || slotNums.length === 0) return true;
  return slotNums.includes(slotNumber);
}

interface ScheduleGridProps {
  date: string;
  timeSlots: ScheduleTimeSlot[];
  teachers: TeacherOption[];
  entries: ScheduleEntry[];
  closedDates: string[];
  selectedSchoolId: string;
  onAddClick: (date: string, slotId: string, teacherId: string) => void;
  onEntryClick: (entry: ScheduleEntry, e: React.MouseEvent) => void;
  onTeacherClick?: (teacher: TeacherOption) => void;
  onMove: (
    entryId: string,
    targetDate: string,
    targetSlotId: string,
    targetTeacherId: string
  ) => Promise<void>;
}

function useEntriesByCell(
  date: string,
  timeSlots: ScheduleTimeSlot[],
  teachers: TeacherOption[],
  entries: ScheduleEntry[],
  schoolId: string
): Map<string, ScheduleEntry[]> {
  return useMemo(() => {
    const map = new Map<string, ScheduleEntry[]>();
    const dayEntries = entries.filter((e) => e.entry_date === date);
    for (const slot of timeSlots) {
      for (const teacher of teachers) {
        const cellId = getCellId(date, slot.id, teacher.id);
        const cellEntries = dayEntries.filter(
          (e) => e.time_slot_id === slot.id && e.teacher_id === teacher.id
        );
        map.set(cellId, cellEntries);
      }
    }
    return map;
  }, [date, timeSlots, teachers, entries, schoolId]);
}

export function ScheduleGrid({
  date,
  timeSlots,
  teachers,
  entries,
  closedDates,
  selectedSchoolId,
  onAddClick,
  onEntryClick,
  onTeacherClick,
  onMove,
}: ScheduleGridProps) {
  const [activeId, setActiveId] = useState<string | null>(null);

  const teachersForSchool = useMemo(
    () =>
      teachers.filter((t) =>
        t.user_schools?.some((us) => us.school_id === selectedSchoolId)
      ),
    [teachers, selectedSchoolId]
  );

  const entriesByCell = useEntriesByCell(
    date,
    timeSlots,
    teachersForSchool,
    entries,
    selectedSchoolId
  );

  const isClosed = closedDates.includes(date);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    if (!over || over.id === active.id) return;
    const overId = String(over.id);
    const parsed = parseCellId(overId);
    if (!parsed) return;
    const { date: targetDate, slotId: targetSlotId, teacherId: targetTeacherId } = parsed;
    const targetSlot = timeSlots.find((s) => s.id === targetSlotId);
    const targetTeacher = teachersForSchool.find((t) => t.id === targetTeacherId);
    if (
      !targetSlot ||
      !targetTeacher ||
      !isTeacherAvailableForSlot(targetTeacher, targetDate, targetSlot.slot_number)
    ) {
      return;
    }
    const entryId = String(active.id);
    const cellEntries = entriesByCell.get(overId) ?? [];
    const canDrop =
      cellEntries.filter(
        (e) => e.status !== 'cancelled' && e.status !== 'transferred_out'
      ).length < MAX_STUDENTS_PER_TEACHER;
    if (!canDrop) return;
    void onMove(entryId, targetDate, targetSlotId, targetTeacherId);
  };

  const activeEntry = useMemo(
    () => (activeId ? entries.find((e) => e.id === activeId) : null),
    [activeId, entries]
  );

  return (
    <>
      <DndContext onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="overflow-x-auto border border-[var(--surface)] rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28 bg-[var(--surface)] font-medium">コマ</TableHead>
                {teachersForSchool.map((t) => (
                  <TableHead
                    key={t.id}
                    className="min-w-[120px] bg-[var(--surface)] font-medium text-center"
                  >
                    {onTeacherClick ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onTeacherClick(t);
                        }}
                        className="w-full py-1 text-[var(--headline)] hover:text-[var(--primary)] hover:underline focus:outline-none focus:ring-2 focus:ring-[var(--primary)] rounded"
                      >
                        {t.display_name || t.email || '—'}
                      </button>
                    ) : (
                      <span>{t.display_name || t.email || '—'}</span>
                    )}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {timeSlots.map((slot) => (
                <TableRow key={slot.id}>
                  <TableCell className="w-28 align-top bg-[#f9f9f9] text-xs py-2">
                    <div className="font-medium">{slot.slot_number}限</div>
                    <div className="text-[10px] text-[var(--paragraph-light)]">
                      {slot.start_time?.slice(0, 5)}-{slot.end_time?.slice(0, 5)}
                    </div>
                  </TableCell>
                  {teachersForSchool.map((teacher) => {
                    const cellId = getCellId(date, slot.id, teacher.id);
                    const cellEntries = entriesByCell.get(cellId) ?? [];
                    const activeCount = cellEntries.filter(
                      (e) => e.status !== 'cancelled' && e.status !== 'transferred_out'
                    ).length;
                    const slotAvailable = isTeacherAvailableForSlot(
                      teacher,
                      date,
                      slot.slot_number
                    );
                    const canDrop =
                      slotAvailable && activeCount < MAX_STUDENTS_PER_TEACHER;
                    return (
                      <DroppableCell
                        key={cellId}
                        id={cellId}
                        date={date}
                        slotId={slot.id}
                        teacherId={teacher.id}
                        entries={cellEntries}
                        timeSlot={slot}
                        isClosed={isClosed}
                        canDrop={canDrop}
                        isSlotAvailable={slotAvailable}
                        onCellClick={() => onAddClick(date, slot.id, teacher.id)}
                        onEntryClick={onEntryClick}
                        activeId={activeId}
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
            <div className="opacity-90 shadow-lg rounded p-2 bg-white border border-[var(--headline)] min-w-[100px]">
              <DraggableEntry entry={activeEntry} isDragging />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </>
  );
}
