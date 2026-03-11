'use client';

import React, { useCallback, useMemo, useState } from 'react';
import type { DragEndEvent } from '@dnd-kit/core';
import { parseTeacherSlotId } from './TeacherCard';
import { WeeklyScheduleGridView } from './WeeklyScheduleGridView';
import type { ScheduleEntry, ScheduleTimeSlot } from '@/types/schedule';
import type { TeacherGroup } from './DayCell';

function groupEntriesByTeacher(
  entries: ScheduleEntry[],
  date: string,
  slotId: string,
  teachersMap: Map<string, { id: string; display_name: string | null; email: string | null }>
): TeacherGroup[] {
  const filtered = entries.filter(
    (e) => e.entry_date === date && e.time_slot_id === slotId
  );
  const byTeacher = new Map<string, TeacherGroup>();
  for (const entry of filtered) {
    const tid = entry.teacher_id;
    const fromList = teachersMap.get(tid);
    const fromEntry = entry.teacher ?? { id: tid, display_name: null, email: null };
    // 講師一覧にいない場合：schedule_entries.teacher_id が user_profiles の誰かを指しているが、
    // role=teacher ではない可能性。JOIN で取得した名前を表示し、未登録であることを示す
    const teacher =
      fromList ??
      {
        ...fromEntry,
        display_name: fromEntry.display_name
          ? `${fromEntry.display_name}（講師未登録）`
          : '講師未登録',
      };
    if (!byTeacher.has(tid)) {
      byTeacher.set(tid, { teacher, entries: [], isAvailableOnly: false });
    }
    byTeacher.get(tid)!.entries.push(entry);
  }
  return Array.from(byTeacher.values());
}

export interface TeacherOption {
  id: string;
  display_name: string | null;
  email: string | null;
  is_active?: boolean;
  user_schools?: Array<{ school_id: string }>;
  available_days_of_week?: number[] | null;
  available_slot_numbers_by_day?: Record<string, number[]> | null;
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
  onAddTeacher: (date: string, slotId: string, existingTeacherIds: string[]) => void;
  onAddStudent: (date: string, slotId: string, teacherId: string) => void;
  onRemoveTeacher: (date: string, slotId: string, teacherId: string, entryCount: number) => void;
  onStudentClick: (entry: ScheduleEntry, e: React.MouseEvent) => void;
  onTransferClick?: (entry: ScheduleEntry) => void;
  onTeacherCardMove: (
    source: { date: string; slotId: string; teacherId: string },
    target: { date: string; slotId: string }
  ) => Promise<void>;
  onStudentEntryDrop?: (
    entryId: string,
    targetDate: string,
    targetSlotId: string,
    targetTeacherId: string
  ) => void;
  onTransferTargetClick?: (date: string, slotId: string, teacherId: string) => void;
  onPrintDay?: (date: string) => void;
  onTransferCancel: () => void;
  /** 曜日ヘッダー行の一番右に表示する要素（例: 通塾日程ボタン） */
  headerRightContent?: React.ReactNode;
  getKoushuInfo?: (studentId: string) => { enrolled: number; scheduled: number } | null;
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
    onTransferClick,
    onTeacherCardMove: _onTeacherCardMove,
    onStudentEntryDrop,
    onTransferTargetClick,
    onPrintDay,
    headerRightContent,
    getKoushuInfo,
  } = props;

  const [activeId, setActiveId] = useState<string | null>(null);

  const teachersMap = useMemo(
    () =>
      new Map(
        teachers.map((t) => [t.id, { id: t.id, display_name: t.display_name, email: t.email }])
      ),
    [teachers]
  );

  const activeEntry = useMemo(() => {
    if (!activeId || activeId.startsWith('teacher-card-') || activeId.startsWith('teacher-slot-'))
      return null;
    return entries.find((e) => e.id === activeId) ?? null;
  }, [activeId, entries]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    if (!over || over.id === active.id) return;

    // 生徒カードのドロップ → 講師ブロックに振替
    const overSlot = parseTeacherSlotId(String(over.id));
    if (overSlot && onStudentEntryDrop) {
      const entry = entries.find((e) => e.id === String(active.id));
      if (!entry || closedDates.includes(overSlot.date)) return;
      const isSourceBlock =
        entry.entry_date === overSlot.date &&
        entry.time_slot_id === overSlot.slotId &&
        entry.teacher_id === overSlot.teacherId;
      if (isSourceBlock) return;
      const targetEntries = entries.filter(
        (e) =>
          e.entry_date === overSlot.date &&
          e.time_slot_id === overSlot.slotId &&
          e.teacher_id === overSlot.teacherId &&
          e.status !== 'cancelled' &&
          e.status !== 'transferred_out'
      );
      if (targetEntries.some((e) => e.student_id === entry.student_id)) return;
      if (targetEntries.length >= maxStudentsPerTeacher) return;
      onStudentEntryDrop(String(active.id), overSlot.date, overSlot.slotId, overSlot.teacherId);
      return;
    }
  };

  const teachersForSchool = useMemo(
    () =>
      teachers.filter(
        (t) =>
          t.is_active !== false &&
          t.user_schools?.some((us) => us.school_id === schoolId)
      ),
    [teachers, schoolId]
  );

  /** セル (dateStr, slotId) に出勤可能な講師を全員含む teacherGroups */
  const getTeacherGroupsForCell = useCallback(
    (dateStr: string, slotId: string, _slotNumber: number) => {
      const fromEntries = groupEntriesByTeacher(
        entries,
        dateStr,
        slotId,
        teachersMap
      );
      const cellKey = `${dateStr}-${slotId}`;
      const emptyIds = emptyTeacherSlots[cellKey] ?? [];
      const merged: TeacherGroup[] = [];

      // (A) エントリがある講師（授業あり）
      for (const group of fromEntries) {
        merged.push({ ...group, isAvailableOnly: false });
      }

      // (B) 手動で追加した講師スロット（+講師追加 で明示的に追加したもの）
      for (const tid of emptyIds) {
        if (merged.some((m) => m.teacher.id === tid)) continue;
        const teacher = teachersMap.get(tid);
        if (teacher)
          merged.push({ teacher, entries: [], isAvailableOnly: true });
      }

      return merged;
    },
    [entries, teachersForSchool, emptyTeacherSlots, teachersMap]
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
      activeId={activeId}
      activeEntry={activeEntry}
      groupEntriesByTeacher={(e, d, s) =>
        groupEntriesByTeacher(e, d, s, teachersMap)
      }
      getTeacherGroupsForCell={getTeacherGroupsForCell}
      onDragStart={(e) => setActiveId(String(e.active.id))}
      onDragEnd={handleDragEnd}
      onAddTeacher={onAddTeacher}
      onAddStudent={onAddStudent}
      onRemoveTeacher={onRemoveTeacher}
      onStudentClick={onStudentClick}
      onTransferClick={onTransferClick}
      onTransferTargetClick={onTransferTargetClick}
      onPrintDay={onPrintDay}
      headerRightContent={headerRightContent}
      getKoushuInfo={getKoushuInfo}
    />
  );
}
