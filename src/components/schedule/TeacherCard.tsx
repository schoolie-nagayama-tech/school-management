'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useDroppable, useDraggable } from '@dnd-kit/core';
import { DraggableStudentCard } from './DraggableStudentCard';
import { UserX, UserCheck, X, Plus } from 'lucide-react';
import type { ScheduleEntry } from '@/types/schedule';
import { getSurname } from '@/lib/utils/teacherName';
import {
  computeSeatOccupancy,
  canPlaceEntry,
  type SeatEntryInput,
} from '@/lib/utils/seatOccupancy';
import styles from './scheduleDensity.module.css';

/** ScheduleEntry → 席計算入力（ratio/half_position）。 */
function toSeatInput(e: ScheduleEntry): SeatEntryInput {
  return { ratio: e.ratio === 1 ? 1 : 2, halfPosition: e.half_position ?? null };
}

/** 講師ブロックをドロップ先として識別するID（生徒D&D用） */
const TEACHER_SLOT_DROP_PREFIX = 'teacher-slot-';

/**
 * 「出勤可能だが授業なし」講師カードをドラッグソースとして識別するID。
 * D&Dで担当未決定セルに割当できるようにするため。ドラッグペイロードは teacherId そのもの。
 */
const AVAIL_TEACHER_DRAG_PREFIX = 'avail-teacher-';

export function getAvailableTeacherDragId(date: string, slotId: string, teacherId: string): string {
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
    /** 姓（座席表ボードは密度優先で姓のみ表示） */
    last_name?: string | null;
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
  activeDragId: string | null;
  /** ドラッグ中の生徒エントリ（ドロップ可否・視覚フィードバック用） */
  activeDragEntry: ScheduleEntry | null;
  /** 振替モード時: この講師ブロックをクリックで振替先に選ぶ */
  transferMode?: boolean;
  onTransferTargetClick?: (date: string, slotId: string, teacherId: string) => void;
  /** 講習モード: 生徒IDから申し込み情報を返すコールバック */
  getKoushuInfo?: (studentId: string) => { enrolled: number; scheduled: number } | null;
  /** この講師がこのコマで欠勤か */
  isAbsent?: boolean;
  /** 欠勤トグル（未指定なら欠勤ボタンを出さない＝担当未決定セル等） */
  onToggleAbsence?: () => void;
  /** 講習の手動配置モード中か（true でカードクリックがその講師への配置になる） */
  koushuPlacing?: boolean;
  /** 配置モード中にこのカードをクリック→この講師で配置 */
  onKoushuPlaceClick?: () => void;
  /** 座席番号（講師×日付、schedule_daily_booth_assignments 由来）。未指定なら入力欄を出さない */
  seatNo?: string;
  /** 座席番号の変更（保存）。未指定なら入力欄を出さない */
  onSeatNoChange?: (value: string) => void;
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
  activeDragId: _activeDragId,
  activeDragEntry,
  transferMode,
  onTransferTargetClick,
  getKoushuInfo,
  isAbsent = false,
  onToggleAbsence,
  koushuPlacing,
  onKoushuPlaceClick,
  seatNo,
  onSeatNoChange,
}: TeacherCardProps) {
  const dropId = getTeacherSlotId(date, timeSlotId, teacher.id);
  const { isOver, setNodeRef } = useDroppable({ id: dropId });

  // 「出勤可能だが授業なし」のカードはドラッグ可能（担当未決定セルへ割当する用途）。
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
      !!koushuPlacing ||
      teacher.id === '__unassigned__' ||
      teacher.id.startsWith('__unassigned__:'),
  });

  // 表示対象: キャンセル以外すべて（振替元 transferred_out も取り消し線で見せる）
  const displayEntries = entries.filter((e) => e.status !== 'cancelled');
  // 有効生徒数（満員・残席カウント用: 振替元は除く）
  const activeEntries = displayEntries.filter((e) => e.status !== 'transferred_out');
  // Phase R: 席占有（1対1/1対2・45分半コマ）。空席プレースホルダはこの vacancies を描画する。
  const occupancy = useMemo(
    () => computeSeatOccupancy(activeEntries.map(toSeatInput), maxStudents),
    [activeEntries, maxStudents]
  );
  const canAddStudent = !isClosed && !occupancy.isFull;
  const isUnassigned = teacher.id === '__unassigned__' || teacher.id.startsWith('__unassigned__:');
  // 座席表ボードは密度優先のため姓のみ表示（フルネームは title 属性で確認できる）
  const fullName = isUnassigned
    ? teacher.display_name || '担当未決定'
    : teacher.display_name || teacher.email || '—';
  const displayName = isUnassigned ? fullName : getSurname(teacher) || fullName;

  // D&D 制約チェック。基本制約 + 講師×生徒の相性制約。
  const dropConstraint = useMemo<{ canDrop: boolean; reason: string | null }>(() => {
    if (!activeDragEntry) return { canDrop: false, reason: null };
    const isSourceBlock =
      activeDragEntry.entry_date === date &&
      activeDragEntry.time_slot_id === timeSlotId &&
      activeDragEntry.teacher_id === teacher.id;
    if (isSourceBlock) return { canDrop: false, reason: null };
    const hasStudent = activeEntries.some((e) => e.student_id === activeDragEntry.student_id);
    if (hasStudent) return { canDrop: false, reason: '同じ生徒が既に在籍' };
    // Phase R: 単純な人数比較ではなく席占有で判定（1対1は満席・45分は前後半で1席共有）。
    if (!canPlaceEntry(activeEntries.map(toSeatInput), toSeatInput(activeDragEntry), maxStudents)) {
      return {
        canDrop: false,
        reason: activeEntries.some((e) => e.ratio === 1) ? '1対1のため不可' : '満員',
      };
    }
    const teachable = teacher.teachable_subject_ids ?? [];
    if (teachable.length > 0 && activeDragEntry.subject_ids?.length > 0) {
      const teachableSet = new Set(teachable);
      const matches = activeDragEntry.subject_ids.some((sid) => teachableSet.has(sid));
      if (!matches) return { canDrop: false, reason: '指導科目外' };
    }
    const excluded = activeDragEntry.student?.excluded_teacher_ids ?? [];
    if (excluded.includes(teacher.id)) return { canDrop: false, reason: '担当除外指定' };
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

  const isUnassignedDropTarget =
    teacher.id === '__unassigned__' || teacher.id.startsWith('__unassigned__:');
  const isTeacherDragActive = _activeDragId?.startsWith('avail-teacher-') ?? false;
  const canAcceptTeacherDrop = isUnassignedDropTarget && isTeacherDragActive;

  const hasVacancy = !occupancy.isFull;

  const genderLabel = teacher.gender === 'male' ? '男' : teacher.gender === 'female' ? '女' : '';

  const isOverAndCanDrop = isOver && (canDrop || canAcceptTeacherDrop);
  const isOverAndCannotDrop = isOver && !canDrop && !canAcceptTeacherDrop && activeDragEntry;

  const isDragInProgress = !!activeDragEntry;
  const isSameCell =
    activeDragEntry &&
    activeDragEntry.entry_date === date &&
    activeDragEntry.time_slot_id === timeSlotId &&
    activeDragEntry.teacher_id === teacher.id;
  const isDimmedDuringDrag = isDragInProgress && !canDrop && !canAcceptTeacherDrop && !isSameCell;

  const handleTransferClick = () => {
    if (transferMode && onTransferTargetClick) onTransferTargetClick(date, timeSlotId, teacher.id);
  };

  // 講習配置モード：このカードをクリック→この講師で配置
  const handleKoushuPlaceClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onKoushuPlaceClick?.();
  };

  // 座席番号のローカル状態（外部値が変わったら同期）。onBlur / Enter で親へ保存。
  const [seatValue, setSeatValue] = useState(seatNo ?? '');
  useEffect(() => {
    setSeatValue(seatNo ?? '');
  }, [seatNo]);
  const commitSeat = () => {
    if (onSeatNoChange && (seatValue ?? '') !== (seatNo ?? '')) onSeatNoChange(seatValue.trim());
  };

  const showSeatInput = !!onSeatNoChange && !isUnassigned && !isAvailableOnly;

  const blockClass = [
    styles.tBlock,
    hasVacancy && !isUnassigned ? styles.hasVacancy : '',
    isUnassigned ? styles.unassigned : '',
    isAvailableOnly ? styles.availableOnly : '',
    isAbsent ? styles.absentTeacher : '',
    isOverAndCanDrop ? styles.dropOk : '',
    isOverAndCannotDrop ? styles.dropNg : '',
    (canDrop || canAcceptTeacherDrop) && !isOver ? styles.dropCandidate : '',
    isDimmedDuringDrag ? styles.dropDim : '',
    koushuPlacing && (onKoushuPlaceClick || isAvailableOnly) ? styles.placeTarget : '',
  ]
    .filter(Boolean)
    .join(' ');

  const clickable = koushuPlacing
    ? onKoushuPlaceClick
      ? handleKoushuPlaceClick
      : undefined
    : transferMode && onTransferTargetClick
      ? handleTransferClick
      : undefined;

  // 「出勤可能だが授業なし」→ ドラッグ可能ソース。ドロップターゲットも兼ねる（combinedRef）。
  const combinedRef = (node: HTMLDivElement | null) => {
    if (isAvailableOnly) setDragRef(node);
    setNodeRef(node);
  };

  return (
    <div
      ref={isUnassigned || isAvailableOnly ? combinedRef : undefined}
      {...(isAvailableOnly ? dragAttrs : {})}
      {...(isAvailableOnly && !koushuPlacing ? dragListeners : {})}
      className={`${blockClass}${isDragging ? ' ' + styles.dropDim : ''}`}
      onClick={clickable}
      role={clickable ? 'button' : undefined}
      title={
        koushuPlacing && (onKoushuPlaceClick || isAvailableOnly)
          ? 'クリックでこの講師に配置する'
          : isOverAndCannotDrop && dropConstraint.reason
            ? `割当不可: ${dropConstraint.reason}`
            : isAvailableOnly
              ? 'ドラッグして担当未決定セルに割当できます'
              : undefined
      }
    >
      {isAbsent && <div className={styles.absentBadge}>欠勤</div>}
      {isOverAndCannotDrop && dropConstraint.reason && (
        <div className={styles.reasonBadge}>{dropConstraint.reason}</div>
      )}

      {/* ヘッダー：講師名は中央寄せ、背景は生徒行より濃い（--sd-head-bg） */}
      <div
        className={`${styles.tHead} ${isUnassigned ? styles.unassignedHead : ''}`}
        onClick={(e) => {
          if (transferMode && onTransferTargetClick) {
            e.stopPropagation();
            onTransferTargetClick(date, timeSlotId, teacher.id);
          }
        }}
      >
        <span
          className={`${styles.tName} ${isUnassigned ? styles.unassignedName : ''}`}
          title={isUnassigned ? undefined : fullName}
        >
          {displayName}
          {genderLabel && (
            <span
              className={`${styles.genderMark} ${teacher.gender === 'male' ? styles.genderMale : styles.genderFemale}`}
              title={`${genderLabel}性`}
            >
              {genderLabel}
            </span>
          )}
        </span>
        <span className={styles.headRight}>
          {showSeatInput && (
            <input
              className={styles.seatInput}
              title="座席番号（印刷時に講師名の隣に表示）"
              maxLength={2}
              placeholder="-"
              value={seatValue}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setSeatValue(e.target.value.replace(/[^0-9]/g, ''))}
              onBlur={commitSeat}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
            />
          )}
          {onToggleAbsence && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onToggleAbsence();
              }}
              className={`${styles.headBtn} ${styles.absenceBtn} ${isAbsent ? styles.on : ''}`}
              aria-label={isAbsent ? '出勤に戻す' : '欠勤にする'}
              title={isAbsent ? '出勤に戻す' : 'このコマを欠勤にする'}
            >
              {isAbsent ? <UserCheck size={11} /> : <UserX size={11} />}
            </button>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onRemoveTeacher();
            }}
            className={`${styles.headBtn} ${styles.tCloseBtn}`}
            aria-label="講師を削除"
            title="この講師枠を削除"
          >
            <X size={11} />
          </button>
        </span>
      </div>

      {/* 本体（ドロップターゲット）。availableOnly は combinedRef で既にドロップ可能なので二重指定しない */}
      <div ref={isUnassigned || isAvailableOnly ? undefined : setNodeRef}>
        {displayEntries.map((entry) => {
          const ki = getKoushuInfo?.(entry.student_id);
          return (
            <DraggableStudentCard
              key={entry.id}
              entry={entry}
              onStudentClick={onStudentClick}
              koushuEnrolled={ki?.enrolled}
              koushuScheduled={ki?.scheduled}
            />
          );
        })}

        {/* 空席プレースホルダ行（破線+緑面）。Phase R: 席占有の vacancies を描画する。
            'full'=丸ごと空き / 'first'=前半だけ空き / 'second'=後半だけ空き。
            D&D のドロップ先はカード本体全体なので、この行に落としても割当が成立する。 */}
        {!transferMode &&
          !koushuPlacing &&
          canAddStudent &&
          occupancy.vacancies.map((v, i) => {
            const label =
              v.kind === 'first' ? '空席（前45）' : v.kind === 'second' ? '空席（後45）' : '空席';
            const title =
              v.kind === 'full'
                ? '空席（クリックで生徒を追加 / 生徒行をドラッグしてここに割当）'
                : `${label}（クリックで生徒を追加）`;
            return (
              <div
                key={`empty-${v.kind}-${i}`}
                className={`${styles.seatEmpty}${v.kind !== 'full' ? ' ' + styles.seatEmptyHalf : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onAddStudent();
                }}
                role="button"
                title={title}
              >
                <Plus size={10} />
                {label}
              </div>
            );
          })}
      </div>
    </div>
  );
});
