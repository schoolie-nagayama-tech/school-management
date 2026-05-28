'use client';

import React from 'react';
import { useDraggable } from '@dnd-kit/core';
import { TeacherCard } from './TeacherCard';
import type { ScheduleEntry, ScheduleTimeSlot } from '@/types/schedule';

export interface TeacherGroup {
  teacher: {
    id: string;
    display_name: string | null;
    email: string | null;
    /** D&D 制約チェックに使用 */
    teachable_subject_ids?: string[] | null;
    gender?: 'male' | 'female' | 'other' | null;
  };
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

/**
 * セル内の未配置エントリミニチップ。
 * ドラッグソース。ID は entry.id で、WeeklyScheduleGrid.handleDragEnd の
 * 既存「生徒エントリ → 講師セル」ドロップ処理がそのまま流れる。
 */
function UnassignedChip({
  entry,
  subjectNameById,
}: {
  entry: ScheduleEntry;
  subjectNameById?: Map<string, string>;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: entry.id });
  const studentName = entry.student
    ? `${entry.student.last_name ?? ''} ${entry.student.first_name ?? ''}`.trim() || '生徒'
    : '生徒';
  const grade = entry.student?.grade;
  const gradeLabel =
    grade != null
      ? grade <= 6
        ? `小${grade}`
        : grade <= 9
          ? `中${grade - 6}`
          : `高${grade - 9}`
      : '';
  const subjects = (entry.subject_ids ?? [])
    .map((sid) => subjectNameById?.get(sid))
    .filter((n): n is string => !!n);
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      title={`未設定 ${studentName} ${gradeLabel} ${subjects.join('・')}`}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-dashed border-warning bg-warning-subtle/60 text-[11px] cursor-grab active:cursor-grabbing transition-opacity duration-150 ${
        isDragging ? 'opacity-30' : 'hover:bg-warning-subtle hover:shadow-sm'
      }`}
    >
      <span className="font-semibold text-text-body truncate max-w-[5.5rem]">{studentName}</span>
      {gradeLabel && <span className="text-[9px] text-text-muted">{gradeLabel}</span>}
      {subjects.length > 0 && (
        <span className="text-[9px] text-sky-700 truncate max-w-[4rem]">
          {subjects[0]}
          {subjects.length > 1 && `+${subjects.length - 1}`}
        </span>
      )}
    </div>
  );
}

export interface DayCellProps {
  date: string;
  timeSlot: ScheduleTimeSlot;
  isClosed: boolean;
  teacherGroups: TeacherGroup[];
  /** このコマの未配置エントリ（teacher_id NULL） */
  unassignedEntries?: ScheduleEntry[];
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
  subjectNameById?: Map<string, string>;
  /** 講師欠勤マップ。キー: `${date}|${timeSlotId}|${userId}` */
  absenceKeySet?: Set<string>;
  onToggleAbsence?: (date: string, slotId: string, teacherId: string) => void;
}

export const DayCell = React.memo(function DayCell({
  date,
  timeSlot,
  isClosed,
  teacherGroups,
  unassignedEntries,
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
  subjectNameById,
  absenceKeySet,
  onToggleAbsence,
}: DayCellProps) {
  if (isClosed) {
    return (
      <div className="py-2 rounded-lg bg-gray-100 text-gray-400 text-xs text-center flex items-center justify-center min-h-[40px]">
        休講日
      </div>
    );
  }

  // 講師カードを 1 列で並べた直後に、未配置エントリの mini チップを表示。
  // その日・その時間で「まだ担当が決まっていない生徒」が一目で分かり、
  // すぐ隣の講師カードにドラッグして割り当てられる。
  const unassigned = unassignedEntries ?? [];

  return (
    <div className="py-1 min-h-[40px]">
      <div className="space-y-1">
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
            subjectNameById={subjectNameById}
            isAbsent={absenceKeySet?.has(`${date}|${timeSlot.id}|${group.teacher.id}`) ?? false}
            onToggleAbsence={
              onToggleAbsence && !group.teacher.id.startsWith('__unassigned__')
                ? () => onToggleAbsence(date, timeSlot.id, group.teacher.id)
                : undefined
            }
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

        {/* 未配置エントリプール (このコマ分)
            講師カードの直下に置き、「ここの未配置」を即座に視認できるようにする。
            チップをドラッグして上の講師カードに落とすと割当できる。 */}
        {unassigned.length > 0 && (
          <div
            className="pt-1 mt-1 border-t border-dashed border-warning/40"
            title="このコマの未配置生徒。講師カードへドラッグして割当"
          >
            <div className="flex items-center gap-1 mb-1 text-[10px] text-warning font-semibold">
              <span className="inline-block w-1 h-1 rounded-full bg-warning animate-pulse" />
              未配置 {unassigned.length}
            </div>
            <div className="flex flex-wrap gap-1">
              {unassigned.map((entry) => (
                <UnassignedChip
                  key={entry.id}
                  entry={entry}
                  subjectNameById={subjectNameById}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
