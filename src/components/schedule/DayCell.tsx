'use client';

import React, { useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { Plus } from 'lucide-react';
import { TeacherCard } from './TeacherCard';
import { getSubjectChip } from './scheduleBadges';
import { computeSeatOccupancy } from '@/lib/utils/seatOccupancy';
import { formatGradeLabelOrEmpty } from '@/lib/utils/gradeLabel';
import styles from './scheduleDensity.module.css';
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
 * セル内の未配置エントリミニチップ（ドラッグソース）。
 * ID は entry.id で、既存「生徒エントリ → 講師セル」ドロップ処理がそのまま流れる。
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
  const gradeLabel = formatGradeLabelOrEmpty(grade);
  const firstSubject = (entry.subject_ids ?? [])
    .map((sid) => subjectNameById?.get(sid))
    .find((n): n is string => !!n);
  const chip = firstSubject ? getSubjectChip(firstSubject) : null;
  return (
    <span
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      title={`未設定 ${studentName} ${gradeLabel} ${firstSubject ?? ''}`}
      className={`${styles.unplacedChip}${isDragging ? ' ' + styles.dragging : ''}`}
    >
      {studentName}
      {gradeLabel && <span className={styles.sGrade}> {gradeLabel}</span>}
      {chip && ` ${chip.label}`}
    </span>
  );
}

/** 順序保存の二分割: 講師の表示順を保ち、累積高さが半分の位置で分ける。 */
function splitPreservingOrder<T extends { estHeight: number }>(blocks: T[]): [T[], T[]] {
  if (blocks.length <= 1) return [blocks, []];
  const total = blocks.reduce((s, b) => s + b.estHeight, 0);
  let acc = 0;
  let splitIdx = blocks.length;
  let bestDiff = Infinity;
  blocks.forEach((b, i) => {
    acc += b.estHeight;
    const diff = Math.abs(acc - total / 2);
    if (diff < bestDiff) {
      bestDiff = diff;
      splitIdx = i + 1;
    }
  });
  return [blocks.slice(0, splitIdx), blocks.slice(splitIdx)];
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
  /** セル内レイアウト: 'pack'=横パッキング(転置) / 'col1'/'col2'=順序保存分割(日=列) */
  layout: 'pack' | 'col1' | 'col2';
  onAddTeacher: (existingTeacherIds: string[]) => void;
  onAddStudent: (teacherId: string) => void;
  onRemoveTeacher: (teacherId: string, entryCount: number) => void;
  onStudentClick: (entry: ScheduleEntry, e: React.MouseEvent) => void;
  onTransferTargetClick?: (date: string, slotId: string, teacherId: string) => void;
  getKoushuInfo?: (studentId: string) => { enrolled: number; scheduled: number } | null;
  subjectNameById?: Map<string, string>;
  /** 講師欠勤マップ。キー: `${date}|${timeSlotId}|${userId}` */
  absenceKeySet?: Set<string>;
  onToggleAbsence?: (date: string, slotId: string, teacherId: string) => void;
  /** 講習の手動配置モード中か */
  koushuPlacing?: boolean;
  /** 配置モード中に講師カードをクリック→その講師で配置 */
  onKoushuPlaceWithTeacher?: (teacherId: string) => void;
  /** 座席番号マップ（この日付の 講師ID → 番号）。印刷用ブース番号のインライン編集に使う */
  boothMap?: Map<string, number>;
  /** 座席番号の保存（講師ID, 値） */
  onSeatNoChange?: (teacherId: string, value: string) => void;
  /** 当日行/列か（薄青ハイライト） */
  isToday?: boolean;
  /** 配置モード中の配置可否（緑=可 / 淡色=不可）。未指定なら配置モードでない */
  placeability?: { ok: boolean; reason: string | null };
  /** 配置モード中、セル背景クリックで担当未決定として落とす */
  onCellPlace?: () => void;
  /**
   * P2改訂: 汎用配置（adhoc）モード中、各講師カードの配置可否。
   * 講習/テスト対策では渡さない（未指定＝全カードクリック可の従来挙動）。
   */
  getTeacherPlaceConstraint?: (teacherId: string) => { ok: boolean; reason: string | null };
  /** §2.12 入れ替えモードの選択中エントリ（生徒A）。生徒行のハイライト算出に使う。 */
  swapSource?: ScheduleEntry | null;
}

export const DayCell = React.memo(function DayCell(props: DayCellProps) {
  const {
    date,
    timeSlot,
    isClosed,
    teacherGroups,
    unassignedEntries,
    maxStudentsPerTeacher,
    activeDragId,
    activeDragEntry,
    transferMode,
    layout,
    onAddTeacher,
    onAddStudent,
    onRemoveTeacher,
    onStudentClick,
    onTransferTargetClick,
    getKoushuInfo,
    subjectNameById,
    absenceKeySet,
    onToggleAbsence,
    koushuPlacing,
    onKoushuPlaceWithTeacher,
    boothMap,
    onSeatNoChange,
    isToday,
    placeability,
    onCellPlace,
    getTeacherPlaceConstraint,
    swapSource,
  } = props;

  const [unplacedOpen, setUnplacedOpen] = useState(false);

  if (isClosed) {
    return <div className={styles.dayCellClosed}>休講日</div>;
  }

  const unassigned = unassignedEntries ?? [];

  const renderBlock = (group: TeacherGroup) => (
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
          group.entries.filter((e) => e.status !== 'cancelled' && e.status !== 'transferred_out')
            .length
        )
      }
      onStudentClick={onStudentClick}
      activeDragId={activeDragId}
      activeDragEntry={activeDragEntry}
      transferMode={transferMode}
      onTransferTargetClick={onTransferTargetClick}
      getKoushuInfo={getKoushuInfo}
      isAbsent={absenceKeySet?.has(`${date}|${timeSlot.id}|${group.teacher.id}`) ?? false}
      onToggleAbsence={
        onToggleAbsence && !group.teacher.id.startsWith('__unassigned__')
          ? () => onToggleAbsence(date, timeSlot.id, group.teacher.id)
          : undefined
      }
      koushuPlacing={koushuPlacing}
      onKoushuPlaceClick={
        onKoushuPlaceWithTeacher && !group.teacher.id.startsWith('__unassigned__')
          ? () => onKoushuPlaceWithTeacher(group.teacher.id)
          : undefined
      }
      seatNo={boothMap?.get(group.teacher.id) != null ? String(boothMap.get(group.teacher.id)) : ''}
      onSeatNoChange={
        onSeatNoChange && !group.teacher.id.startsWith('__unassigned__')
          ? (value) => onSeatNoChange(group.teacher.id, value)
          : undefined
      }
      placeConstraint={
        // 汎用配置モード中のみ、担当未決定以外の講師カードに可否を渡す（担当未決定は背景配置扱い）。
        koushuPlacing && getTeacherPlaceConstraint && !group.teacher.id.startsWith('__unassigned__')
          ? getTeacherPlaceConstraint(group.teacher.id)
          : undefined
      }
      swapSource={swapSource}
    />
  );

  // 分割用の推定高さ（生徒行 + 空席プレースホルダ行）。
  // Phase R: 空席数は席占有（1対1/1対2・45分半コマ）の vacancies 数と一致させる。
  const withHeight = teacherGroups.map((g) => {
    const displayCount = g.entries.filter((e) => e.status !== 'cancelled').length;
    const active = g.entries.filter(
      (e) => e.status !== 'cancelled' && e.status !== 'transferred_out'
    );
    const occ = computeSeatOccupancy(
      active.map((e) => ({ ratio: e.ratio === 1 ? 1 : 2, halfPosition: e.half_position ?? null })),
      maxStudentsPerTeacher
    );
    const rows = displayCount + occ.vacancies.length;
    return { group: g, estHeight: 24 + 18 * Math.max(1, rows) };
  });

  let blocksNode: React.ReactNode;
  if (layout === 'pack') {
    blocksNode = <div className={styles.tPack}>{teacherGroups.map(renderBlock)}</div>;
  } else if (layout === 'col2') {
    const [left, right] = splitPreservingOrder(withHeight);
    blocksNode = (
      <div className={styles.cellCols}>
        <div className={styles.cellCol}>{left.map((x) => renderBlock(x.group))}</div>
        {right.length > 0 && (
          <div className={styles.cellCol}>{right.map((x) => renderBlock(x.group))}</div>
        )}
      </div>
    );
  } else {
    blocksNode = (
      <div className={styles.cellCols}>
        <div className={styles.cellCol}>{teacherGroups.map(renderBlock)}</div>
      </div>
    );
  }

  const isEmptyCell = teacherGroups.length === 0 && unassigned.length === 0;
  const cellClass = [
    styles.dayCell,
    isEmptyCell ? styles.empty : '',
    isToday ? styles.todayRow : '',
    // 実機フィードバック①: 可のセルは無装飾（緑枠廃止）。不可セルのみ全体を淡色化。
    koushuPlacing && !placeability?.ok ? styles.dropDim : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={cellClass}
      onClick={koushuPlacing && onCellPlace ? () => onCellPlace() : undefined}
      title={
        koushuPlacing
          ? placeability?.ok
            ? '背景クリックで担当未決定として落とす／講師カードをクリックするとその講師で配置'
            : (placeability?.reason ?? '配置できません')
          : undefined
      }
    >
      {/* 未配置カウントバッジ（セル最上部）。クリックでチップ展開 */}
      {unassigned.length > 0 && (
        <>
          <button
            type="button"
            className={styles.unplacedBadge}
            onClick={(e) => {
              e.stopPropagation();
              setUnplacedOpen((v) => !v);
            }}
            title="このコマの未配置生徒。展開してチップを講師カードへドラッグ"
          >
            <span className={styles.unplacedDot} />
            未配置 {unassigned.length}
          </button>
          {unplacedOpen && (
            <div className={styles.unplacedChips}>
              {unassigned.map((entry) => (
                <UnassignedChip key={entry.id} entry={entry} subjectNameById={subjectNameById} />
              ))}
            </div>
          )}
        </>
      )}

      {blocksNode}

      {/* 配置モード中・配置可能セルのみ: 「＋ 担当未決定で配置」の細い緑破線バー。
          セル背景クリックと同じハンドラ（onCellPlace）を呼ぶ視覚的受け皿。 */}
      {koushuPlacing && placeability?.ok && onCellPlace && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onCellPlace();
          }}
          className={styles.placeUnassignedBar}
          title="担当未決定として配置する"
        >
          <Plus size={9} /> 担当未決定で配置
        </button>
      )}

      {!transferMode && !koushuPlacing && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onAddTeacher(teacherGroups.map((g) => g.teacher.id));
          }}
          className={styles.addTeacherBar}
        >
          <Plus size={9} /> 講師
        </button>
      )}
    </div>
  );
});
