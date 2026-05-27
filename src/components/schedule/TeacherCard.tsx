'use client';

import React, { useMemo } from 'react';
import { useDroppable, useDraggable } from '@dnd-kit/core';
import { DraggableStudentCard } from './DraggableStudentCard';
import { Plus, GripVertical } from 'lucide-react';
import type { ScheduleEntry } from '@/types/schedule';

/** 講師ブロックをドロップ先として識別するID（生徒D&D用） */
const TEACHER_SLOT_DROP_PREFIX = 'teacher-slot-';

/**
 * 「出勤可能だが授業なし」講師カードをドラッグソースとして識別するID。
 * D&Dで担当未決定セルに割当できるようにするため。
 * ドラッグペイロードは teacherId そのもの。
 */
const AVAIL_TEACHER_DRAG_PREFIX = 'avail-teacher-';

export function getAvailableTeacherDragId(
  date: string,
  slotId: string,
  teacherId: string
): string {
  return `${AVAIL_TEACHER_DRAG_PREFIX}${date}|${slotId}|${teacherId}`;
}

export function parseAvailableTeacherDragId(
  id: string
): { date: string; slotId: string; teacherId: string } | null {
  if (!id.startsWith(AVAIL_TEACHER_DRAG_PREFIX)) return null;
  const rest = id.slice(AVAIL_TEACHER_DRAG_PREFIX.length);
  const parts = rest.split('|');
  if (parts.length !== 3) return null;
  return { date: parts[0], slotId: parts[1], teacherId: parts[2] };
}

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
  teacher: {
    id: string;
    display_name: string | null;
    email: string | null;
    /** D&D制約チェックに使用：指導可能科目 (空/未設定なら全科目可) */
    teachable_subject_ids?: string[] | null;
    /** D&D制約チェックに使用：性別 */
    gender?: 'male' | 'female' | 'other' | null;
  };
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

  // 「出勤可能だが授業なし」のカードはドラッグ可能（担当未決定セルへ割当する用途）。
  // ドラッグソースID には date / slotId / teacherId を埋め込み、ドロップ受け側で同期解析できる形に。
  const dragId = getAvailableTeacherDragId(date, timeSlotId, teacher.id);
  const {
    attributes: dragAttrs,
    listeners: dragListeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({
    id: dragId,
    disabled:
      !isAvailableOnly ||
      teacher.id === '__unassigned__' ||
      teacher.id.startsWith('__unassigned__:'),
  });

  // 表示対象: キャンセル以外すべて（振替元 transferred_out も表示して取り消し線スタイルで見せる）
  const displayEntries = entries.filter((e) => e.status !== 'cancelled');
  // 有効生徒数（満員・残席カウント用: 振替元は除く）
  const activeEntries = displayEntries.filter((e) => e.status !== 'transferred_out');
  const canAddStudent = !isClosed && activeEntries.length < maxStudents;
  // 担当未決定エントリのグループは特殊ID (__unassigned__ または __unassigned__:<entryId>) で識別。
  // 「講師」ではなく「担当未決定」の枠として配色を変えて見せる。
  const isUnassigned =
    teacher.id === '__unassigned__' || teacher.id.startsWith('__unassigned__:');
  const displayName = isUnassigned
    ? teacher.display_name || '担当未決定'
    : (teacher.display_name || teacher.email || '—');

  // D&D 制約チェック。基本制約 + 講師×生徒の相性制約。
  // 不一致なら canDrop=false で赤 ring 表示、ドロップ無効。
  const dropConstraint = useMemo<{
    canDrop: boolean;
    reason: string | null;
  }>(() => {
    if (!activeDragEntry) return { canDrop: false, reason: null };
    // 同じセル（移動元）にドロップ → 無意味
    const isSourceBlock =
      activeDragEntry.entry_date === date &&
      activeDragEntry.time_slot_id === timeSlotId &&
      activeDragEntry.teacher_id === teacher.id;
    if (isSourceBlock) return { canDrop: false, reason: null };
    // 既に同生徒がこの講師にいる → 二重不可
    const hasStudent = activeEntries.some((e) => e.student_id === activeDragEntry.student_id);
    if (hasStudent) return { canDrop: false, reason: '同じ生徒が既に在籍' };
    // 満員
    if (activeEntries.length >= maxStudents) return { canDrop: false, reason: '満員' };

    // 担当未決定セルへの講師D&D（旧フロー）はそもそも生徒エントリでないのでここに来ない

    // 講師の指導可能科目チェック (生徒の subject_ids と1つも重複しなければ不可)
    // teachable_subject_ids が空/未設定の講師は「全科目可」扱い
    const teachable = teacher.teachable_subject_ids ?? [];
    if (teachable.length > 0 && activeDragEntry.subject_ids?.length > 0) {
      const teachableSet = new Set(teachable);
      const matches = activeDragEntry.subject_ids.some((sid) => teachableSet.has(sid));
      if (!matches) return { canDrop: false, reason: '指導科目外' };
    }

    // 担当除外講師にこの講師が含まれていれば不可
    const excluded = activeDragEntry.student?.excluded_teacher_ids ?? [];
    if (excluded.includes(teacher.id)) return { canDrop: false, reason: '担当除外指定' };

    // 性別希望チェック (希望ありで講師性別が不一致なら不可)
    const preferred = activeDragEntry.student?.preferred_teacher_gender;
    if (preferred && teacher.gender && teacher.gender !== preferred) {
      return { canDrop: false, reason: `${preferred === 'male' ? '男性' : '女性'}講師希望` };
    }
    return { canDrop: true, reason: null };
  }, [
    activeDragEntry,
    date,
    timeSlotId,
    teacher.id,
    teacher.teachable_subject_ids,
    teacher.gender,
    activeEntries,
    maxStudents,
  ]);
  const canDrop = dropConstraint.canDrop;

  // 「出勤可能講師カードを担当未決定セルにドロップする」ためのフラグ。
  // この間は対象セルをハイライトして「ここに落とせる」と伝える。
  const isUnassignedDropTarget =
    teacher.id === '__unassigned__' || teacher.id.startsWith('__unassigned__:');
  const isTeacherDragActive = _activeDragId?.startsWith('avail-teacher-') ?? false;
  const canAcceptTeacherDrop = isUnassignedDropTarget && isTeacherDragActive;

  const remaining = maxStudents - activeEntries.length;
  const slotLabel = remaining === 0 ? '満員' : `残${remaining}`;

  const isOverAndCanDrop = isOver && (canDrop || canAcceptTeacherDrop);
  const isOverAndCannotDrop = isOver && !canDrop && !canAcceptTeacherDrop && activeDragEntry;

  const handleTransferClick = () => {
    if (transferMode && onTransferTargetClick) onTransferTargetClick(date, timeSlotId, teacher.id);
  };

  // 出勤可能だが授業なし → コンパクトな1行バッジ表示。
  // ドラッグ可能。担当未決定セル（破線warningの「未定: 生徒名」）にドロップすると割当できる。
  if (isAvailableOnly) {
    return (
      <div
        ref={setDragRef}
        {...dragAttrs}
        {...dragListeners}
        className={`
          flex items-center gap-0.5 px-1.5 py-0.5 rounded-md border border-dashed border-gray-200
          bg-gray-50/50 text-gray-400 cursor-grab active:cursor-grabbing
          transition-[opacity,box-shadow,background-color] duration-150
          ${isDragging ? 'opacity-40' : 'hover:bg-white hover:border-gray-300 hover:text-gray-600 hover:shadow-sm'}
          ${transferMode ? 'cursor-pointer hover:border-[var(--primary)]/40 hover:bg-gray-50' : ''}
        `}
        onClick={transferMode ? handleTransferClick : undefined}
        role={transferMode ? 'button' : undefined}
        title="ドラッグして担当未決定セルに割当できます"
      >
        <GripVertical className="w-2.5 h-2.5 text-gray-300 flex-shrink-0" />
        <span className="text-[11px] truncate flex-1 min-w-0">{displayName}</span>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemoveTeacher(); }}
          className="flex-shrink-0 w-3.5 h-3.5 flex items-center justify-center rounded text-gray-300 hover:text-red-400 text-[10px]"
          aria-label="講師を削除"
        >
          ×
        </button>
      </div>
    );
  }

  return (
    // 担当未決定セルのときは「セル全体」をドロップターゲットにする (ヘッダーも含む)。
    // 通常の TeacherCard は body 内部 (.setNodeRef) だけが droppable で問題ないが、
    // 担当未決定は学生1名で隙間が狭く、ヘッダー上に落としやすいので拡張する。
    <div
      ref={isUnassigned ? setNodeRef : undefined}
      className={`
        group relative rounded-xl border transition-[box-shadow,background-color,border-color] duration-150 ease-out
        ${isUnassigned
          // 担当未決定: 破線ボーダー + 薄い warning 着色で「決まっていない」を視覚化
          ? 'border-dashed border-warning bg-warning-subtle/40 shadow-sm hover:shadow-md hover:bg-warning-subtle/60'
          : 'border-[color:color-mix(in_oklch,var(--primary)_25%,#e5e7eb)] bg-white shadow-sm hover:shadow-md hover:bg-gray-50'}
        ${transferMode ? 'cursor-pointer hover:border-[var(--primary)]/40 hover:bg-gray-50/50' : ''}
        ${canAcceptTeacherDrop && !isOver ? 'ring-1 ring-info/30 ring-offset-1' : ''}
        ${isOverAndCanDrop ? 'ring-2 ring-green-400 bg-green-50/50' : ''}
        ${isOverAndCannotDrop ? 'ring-2 ring-red-400 bg-red-50/50 cursor-not-allowed' : ''}
      `}
      onClick={transferMode && onTransferTargetClick ? handleTransferClick : undefined}
      role={transferMode && onTransferTargetClick ? 'button' : undefined}
      title={isOverAndCannotDrop && dropConstraint.reason ? `この講師には割当不可: ${dropConstraint.reason}` : undefined}
    >
      {/* ドロップ拒否時に理由バッジを表示。短時間だけ出すミニトースト的な見せ方。 */}
      {isOverAndCannotDrop && dropConstraint.reason && (
        <div className="absolute -top-2 left-1/2 -translate-x-1/2 z-10 px-2 py-0.5 rounded-full bg-red-500 text-white text-[10px] font-semibold shadow whitespace-nowrap pointer-events-none">
          {dropConstraint.reason}
        </div>
      )}
      {/* ヘッダー：振替モード中もクリックで振替先を選べるよう onClick を設定 */}
      <div
        className="flex justify-between items-center px-1.5 py-1 border-b border-gray-100"
        onClick={(e) => {
          if (transferMode) {
            e.stopPropagation();
            if (onTransferTargetClick) onTransferTargetClick(date, timeSlotId, teacher.id);
          }
        }}
      >
        <span className={`min-w-0 truncate flex-1 text-xs font-medium ${isUnassigned ? 'text-warning' : 'text-gray-700'}`}>
          {displayName}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRemoveTeacher();
          }}
          className="flex-shrink-0 ml-1 w-4 h-4 flex items-center justify-center rounded text-gray-300 hover:text-red-500 hover:bg-red-50 text-[10px]"
          aria-label="講師を削除"
        >
          ×
        </button>
      </div>

      <div ref={setNodeRef} className="relative p-1 rounded-b-xl">
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
