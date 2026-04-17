'use client';

import React, { useMemo } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { DraggableStudentCard } from './DraggableStudentCard';
import { Plus } from 'lucide-react';
import type { ScheduleEntry } from '@/types/schedule';

/** 講師ブロックをドロップ先として識別するID（生徒D&D用） */
const TEACHER_SLOT_DROP_PREFIX = 'teacher-slot-';

export function getTeacherSlotId(date: string, slotId: string, teacherId: string): string {
  return `${TEACHER_SLOT_DROP_PREFIX}${date}|${slotId}|${teacherId}`;
}

export function parseTeacherSlotId(
  id: string
): { date: string; slotId: string; teacherId: string } | null {
  if (!id.startsWith(TEACHER_SLOT_DROP_PREFIX)) return null;
  const rest = id.slice(TEACHER_SLOT_DROP_PREFIX.length);
  const parts = rest.split('|');
  if (parts.length !== 3) return null;
  return { date: parts[0], slotId: parts[1], teacherId: parts[2] };
}

/** 旧講師カードドラッグ用（互換のため残す） */
export function getTeacherCardId(date: string, slotId: string, teacherId: string): string {
  return `teacher-card-${date}|${slotId}|${teacherId}`;
}

export function parseTeacherCardId(
  id: string
): { date: string; slotId: string; teacherId: string } | null {
  if (!id.startsWith('teacher-card-')) return null;
  const rest = id.slice('teacher-card-'.length);
  const parts = rest.split('|');
  if (parts.length !== 3) return null;
  return { date: parts[0], slotId: parts[1], teacherId: parts[2] };
}

export interface TeacherCardProps {
  teacher: { id: string; display_name: string | null; email: string | null };
  entries: ScheduleEntry[];
  /** true = 出勤可能だが授業なし */
  isAvailableOnly?: boolean;
  date: string;
  timeSlotId: string;
  maxStudents: number;
  isClosed: boolean;
  onAddStudent: () => void;
  onRemoveTeacher: () => void;
  onStudentClick: (entry: ScheduleEntry, e: React.MouseEvent) => void;
  onTransferClick?: (entry: ScheduleEntry) => void;
  activeDragId: string | null;
  /** ドラッグ中の生徒エントリ（ドロップ可否・視覚フィードバック用） */
  activeDragEntry: ScheduleEntry | null;
  /** 振替モード時: この講師ブロックをクリックで振替先に選ぶ */
  transferMode?: boolean;
  onTransferTargetClick?: (date: string, slotId: string, teacherId: string) => void;
  /** 講習モード: 生徒IDから申し込み情報を返すコールバック */
  getKoushuInfo?: (studentId: string) => { enrolled: number; scheduled: number } | null;
}

export const TeacherCard = React.memo(function TeacherCard({
  teacher,
  entries,
  isAvailableOnly = false,
  date,
  timeSlotId,
  maxStudents,
  isClosed,
  onAddStudent,
  onRemoveTeacher,
  onStudentClick,
  onTransferClick,
  activeDragId: _activeDragId,
  activeDragEntry,
  transferMode,
  onTransferTargetClick,
  getKoushuInfo,
}: TeacherCardProps) {
  const dropId = getTeacherSlotId(date, timeSlotId, teacher.id);
  const { isOver, setNodeRef } = useDroppable({ id: dropId });

  // 表示対象: キャンセル以外すべて（振替元 transferred_out も表示して取り消し線スタイルで見せる）
  const displayEntries = entries.filter((e) => e.status !== 'cancelled');
  // 有効生徒数（満員・残席カウント用: 振替元は除く）
  const activeEntries = displayEntries.filter((e) => e.status !== 'transferred_out');
  const canAddStudent = !isClosed && activeEntries.length < maxStudents;
  const displayName = teacher.display_name || teacher.email || '—';

  const canDrop = useMemo(() => {
    if (!activeDragEntry) return false;
    const isSourceBlock =
      activeDragEntry.entry_date === date &&
      activeDragEntry.time_slot_id === timeSlotId &&
      activeDragEntry.teacher_id === teacher.id;
    if (isSourceBlock) return false;
    const hasStudent = activeEntries.some((e) => e.student_id === activeDragEntry.student_id);
    if (hasStudent) return false;
    if (activeEntries.length >= maxStudents) return false;
    return true;
  }, [activeDragEntry, date, timeSlotId, teacher.id, activeEntries, maxStudents]);

  const remaining = maxStudents - activeEntries.length;
  const slotLabel = remaining === 0 ? '満員' : `残${remaining}`;

  const isOverAndCanDrop = isOver && canDrop;
  const isOverAndCannotDrop = isOver && !canDrop && activeDragEntry;

  const handleTransferClick = () => {
    if (transferMode && onTransferTargetClick) onTransferTargetClick(date, timeSlotId, teacher.id);
  };

  // 出勤可能だが授業なし → コンパクトな1行バッジ表示
  if (isAvailableOnly) {
    return (
      <div
        className={`
          flex items-center gap-1 px-2 py-1 rounded-lg border border-dashed border-gray-200
          bg-gray-50/50 text-gray-400
          ${transferMode ? 'cursor-pointer hover:border-[var(--primary)]/40 hover:bg-gray-50' : ''}
        `}
        onClick={transferMode ? handleTransferClick : undefined}
        role={transferMode ? 'button' : undefined}
      >
        <span className="text-xs truncate flex-1 min-w-0">{displayName}</span>
        <span className="text-[10px] text-gray-300 flex-shrink-0 tabular-nums">{slotLabel}</span>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemoveTeacher(); }}
          className="flex-shrink-0 w-4 h-4 flex items-center justify-center rounded text-gray-300 hover:text-red-400 text-xs"
          aria-label="講師を削除"
        >
          ×
        </button>
      </div>
    );
  }

  return (
    <div
      className={`
        group relative rounded-xl border transition-all duration-150
        border-[color:color-mix(in_oklch,var(--primary)_25%,#e5e7eb)] bg-white shadow-sm hover:shadow-md hover:bg-gray-50
        ${transferMode ? 'cursor-pointer hover:border-[var(--primary)]/40 hover:bg-gray-50/50' : ''}
        ${isOverAndCanDrop ? 'ring-2 ring-green-400 bg-green-50/50' : ''}
        ${isOverAndCannotDrop ? 'ring-2 ring-red-200 bg-red-50/50 cursor-not-allowed' : ''}
      `}
      onClick={transferMode && onTransferTargetClick ? handleTransferClick : undefined}
      role={transferMode && onTransferTargetClick ? 'button' : undefined}
    >
      {/* ヘッダー：振替モード中もクリックで振替先を選べるよう onClick を設定 */}
      <div
        className="flex justify-between items-center px-2 py-1.5 border-b border-gray-100"
        onClick={(e) => {
          if (transferMode) {
            e.stopPropagation();
            if (onTransferTargetClick) onTransferTargetClick(date, timeSlotId, teacher.id);
          }
        }}
      >
        <span className="min-w-0 truncate flex-1 text-sm font-medium text-gray-700">
          {displayName}
        </span>
        <span className="flex-shrink-0 ml-2 text-right tabular-nums text-xs text-gray-400">
          {slotLabel}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRemoveTeacher();
          }}
          className="flex-shrink-0 ml-1 w-5 h-5 flex items-center justify-center rounded text-gray-400 hover:text-red-500 hover:bg-red-50 text-xs"
          aria-label="講師を削除"
        >
          ×
        </button>
      </div>

      <div ref={setNodeRef} className="relative p-1.5 rounded-b-xl">
        <div className="space-y-1">
          {displayEntries.map((entry) => {
            const ki = getKoushuInfo?.(entry.student_id);
            return (
              <DraggableStudentCard
                key={entry.id}
                entry={entry}
                onStudentClick={onStudentClick}
                onTransferClick={onTransferClick}
                koushuEnrolled={ki?.enrolled}
                koushuScheduled={ki?.scheduled}
              />
            );
          })}
        </div>

        {canAddStudent && !transferMode && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onAddStudent();
            }}
            className="absolute bottom-1 right-1 w-6 h-6 rounded-full flex items-center justify-center bg-white border border-gray-200 text-gray-500 hover:text-[var(--primary)] hover:border-[var(--primary)]/30 opacity-0 group-hover:opacity-100 transition-opacity duration-200 shadow-sm"
            aria-label="生徒を追加"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
});
