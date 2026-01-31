'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { DayCell, parseDayCellId } from './DayCell';
import { parseTeacherCardId } from './TeacherCard';
import { WeeklyScheduleGridView } from './WeeklyScheduleGridView';
import type { ScheduleEntry, ScheduleTimeSlot } from '@/types/schedule';
import type { TeacherGroup } from './DayCell';

function groupEntriesByTeacher(
  entries: ScheduleEntry[],
  date: string,
  slotId: string
): TeacherGroup[] {
  const filtered = entries.filter(
    (e) => e.entry_date === date && e.time_slot_id === slotId
  );
  const byTeacher = new Map<string, TeacherGroup>();
  for (const entry of filtered) {
    const tid = entry.teacher_id;
    const teacher = entry.teacher ?? { id: tid, display_name: null, email: null };
    if (!byTeacher.has(tid)) {
      byTeacher.set(tid, { teacher, entries: [] });
    }
    byTeacher.get(tid)!.entries.push(entry);
  }
  return Array.from(byTeacher.values());
}

export interface TeacherOption {
  id: string;
  display_name: string | null;
  email: string | null;
  user_schools?: Array<{ school_id: string }>;
  available_days_of_week?: number[] | null;
  available_slot_numbers_by_day?: Record<string, number[]> | null;
}

/** その曜日・そのコマで講師が出勤可能か */
function isTeacherAvailableForSlot(
  teacher: TeacherOption,
  dateStr: string,
  slotNumber: number
): boolean {
  const dayOfWeek = new Date(dateStr + 'Z').getUTCDay();
  const days = teacher.available_days_of_week;
  if (days && days.length > 0 && !days.includes(dayOfWeek)) return false;
  const byDay = teacher.available_slot_numbers_by_day;
  if (!byDay || Object.keys(byDay).length === 0) return true;
  const dayKey = String(dayOfWeek);
  const slotNums = byDay[dayKey];
  if (!slotNums || slotNums.length === 0) return true;
  return slotNums.includes(slotNumber);
}

export interface WeeklyScheduleGridProps {
  schoolId: string;
  weekDates: string[];
  timeSlots: ScheduleTimeSlot[];
  entries: ScheduleEntry[];
  closedDates: string[];
  teachers: TeacherOption[];
  emptyTeacherSlots: Record<string, string[]>;
  maxStudentsPerTeacher: number;
  transferMode: { sourceEntry: ScheduleEntry } | null;
  onEmptyTeacherSlotsChange: (next: Record<string, string[]>) => void;
  onAddTeacher: (date: string, slotId: string) => void;
  onAddStudent: (date: string, slotId: string, teacherId: string) => void;
  onRemoveTeacher: (date: string, slotId: string, teacherId: string, entryCount: number) => void;
  onStudentClick: (entry: ScheduleEntry, e: React.MouseEvent) => void;
  onTeacherCardMove: (
    source: { date: string; slotId: string; teacherId: string },
    target: { date: string; slotId: string }
  ) => Promise<void>;
  onTransferTargetSelect: (date: string, slotId: string) => void;
  onTransferCancel: () => void;
}

export function WeeklyScheduleGrid(props: WeeklyScheduleGridProps) {
  const {
    schoolId,
    weekDates,
    timeSlots,
    entries,
    closedDates,
    teachers,
    emptyTeacherSlots,
    maxStudentsPerTeacher,
    transferMode,
    onAddTeacher,
    onAddStudent,
    onRemoveTeacher,
    onStudentClick,
    onTeacherCardMove,
    onTransferTargetSelect,
  } = props;

  const [activeId, setActiveId] = useState<string | null>(null);

  const teachersMap = useMemo(
    () =>
      new Map(
        teachers.map((t) => [t.id, { id: t.id, display_name: t.display_name, email: t.email }])
      ),
    [teachers]
  );

  const handleDragEnd = async (event: {
    active: { id: string; data: { current?: unknown } };
    over: { id: string } | null;
  }) => {
    const { active, over } = event;
    setActiveId(null);
    if (!over || over.id === active.id) return;

    const parsed = parseTeacherCardId(String(active.id));
    const overParsed = parseDayCellId(String(over.id));
    if (!parsed || !overParsed) return;

    const { date: srcDate, slotId: srcSlotId, teacherId } = parsed;
    const { date: tgtDate, slotId: tgtSlotId } = overParsed;

    if (srcDate === tgtDate && srcSlotId === tgtSlotId) return;
    if (closedDates.includes(tgtDate)) return;

    try {
      await onTeacherCardMove(
        { date: srcDate, slotId: srcSlotId, teacherId },
        { date: tgtDate, slotId: tgtSlotId }
      );
    } catch {
      // 親で toast
    }
  };

  const activeDragData = useMemo(() => {
    if (!activeId || !activeId.startsWith('teacher-card-')) return null;
    return parseTeacherCardId(activeId);
  }, [activeId]);

  const activeTeacherGroup = useMemo(() => {
    if (!activeDragData) return null;
    const { date, slotId, teacherId } = activeDragData;
    const teacher = teachersMap.get(teacherId);
    if (!teacher) return null;
    const entriesForCell = entries.filter(
      (e) =>
        e.entry_date === date &&
        e.time_slot_id === slotId &&
        e.teacher_id === teacherId &&
        e.status !== 'cancelled' &&
        e.status !== 'transferred_out'
    );
    return { teacher, entries: entriesForCell };
  }, [activeDragData, entries, teachersMap]);

  const teachersForSchool = useMemo(
    () =>
      teachers.filter((t) =>
        t.user_schools?.some((us) => us.school_id === schoolId)
      ),
    [teachers, schoolId]
  );

  /** セル (dateStr, slotId) に出勤可能な講師を全員含む teacherGroups */
  const getTeacherGroupsForCell = useCallback(
    (dateStr: string, slotId: string, slotNumber: number) => {
      const fromEntries = groupEntriesByTeacher(entries, dateStr, slotId);
      const availableTeachers = teachersForSchool.filter((t) =>
        isTeacherAvailableForSlot(t, dateStr, slotNumber)
      );
      const cellKey = `${dateStr}-${slotId}`;
      const emptyIds = emptyTeacherSlots[cellKey] ?? [];
      const fromEntryIds = new Set(fromEntries.map((g) => g.teacher.id));
      const fromEmptyIds = new Set(emptyIds);
      const merged: TeacherGroup[] = [];
      for (const t of availableTeachers) {
        const group = fromEntries.find((g) => g.teacher.id === t.id);
        merged.push({
          teacher: { id: t.id, display_name: t.display_name, email: t.email },
          entries: group?.entries ?? [],
        });
      }
      for (const tid of emptyIds) {
        if (fromEntryIds.has(tid) || merged.some((m) => m.teacher.id === tid)) continue;
        const teacher = teachersMap.get(tid);
        if (teacher) merged.push({ teacher, entries: [] });
      }
      return merged;
    },
    [entries, teachersForSchool, emptyTeacherSlots, groupEntriesByTeacher, teachersMap]
  );

  return (
    <WeeklyScheduleGridView
      schoolId={schoolId}
      weekDates={weekDates}
      timeSlots={timeSlots}
      entries={entries}
      closedDates={closedDates}
      emptyTeacherSlots={emptyTeacherSlots}
      maxStudentsPerTeacher={maxStudentsPerTeacher}
      transferMode={transferMode}
      teachersMap={teachersMap}
      activeId={activeId}
      activeTeacherGroup={activeTeacherGroup}
      groupEntriesByTeacher={groupEntriesByTeacher}
      getTeacherGroupsForCell={getTeacherGroupsForCell}
      onDragStart={(e) => setActiveId(String(e.active.id))}
      onDragEnd={handleDragEnd}
      onAddTeacher={onAddTeacher}
      onAddStudent={onAddStudent}
      onRemoveTeacher={onRemoveTeacher}
      onStudentClick={onStudentClick}
      onTransferTargetSelect={onTransferTargetSelect}
    />
  );
}
