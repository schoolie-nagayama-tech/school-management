'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Printer, Hash } from 'lucide-react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import { DayCell } from './DayCell';
import { StudentCard } from './StudentCard';
import type { ScheduleEntry, ScheduleTimeSlot } from '@/types/schedule';
import type { TeacherGroup } from './DayCell';
import styles from './scheduleDensity.module.css';

/** 表示用：ローカル日付で解釈して日付・曜日を返す */
function formatDayHeader(dateStr: string): { dayNum: number; dateLong: string; weekday: string } {
  const d = new Date(dateStr + 'T12:00:00');
  const month = d.getMonth() + 1;
  const date = d.getDate();
  const week = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
  return { dayNum: date, dateLong: `${month}月${date}日`, weekday: week };
}

function getTodayLocalDateStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export type ScheduleOrientation = 'cols' | 'rows';

export interface WeeklyScheduleGridViewProps {
  schoolId: string;
  weekDates: string[];
  timeSlots: ScheduleTimeSlot[];
  entries: ScheduleEntry[];
  closedDates: string[];
  emptyTeacherSlots: Record<string, string[]>;
  maxStudentsPerTeacher: number;
  transferMode: { sourceEntry: ScheduleEntry } | null;
  activeId: string | null;
  activeEntry: ScheduleEntry | null;
  groupEntriesByTeacher: (entries: ScheduleEntry[], date: string, slotId: string) => TeacherGroup[];
  getTeacherGroupsForCell: (dateStr: string, slotId: string, slotNumber: number) => TeacherGroup[];
  getUnassignedEntriesForCell?: (dateStr: string, slotId: string) => ScheduleEntry[];
  onDragStart: (e: DragStartEvent) => void;
  onDragEnd: (event: DragEndEvent) => void;
  onAddTeacher: (date: string, slotId: string, existingTeacherIds: string[]) => void;
  onAddStudent: (date: string, slotId: string, teacherId: string) => void;
  onRemoveTeacher: (date: string, slotId: string, teacherId: string, entryCount: number) => void;
  onStudentClick: (entry: ScheduleEntry, e: React.MouseEvent) => void;
  onTransferTargetClick?: (date: string, slotId: string, teacherId: string) => void;
  onPrintDay?: (date: string) => void;
  onBoothAssign?: (date: string) => void;
  headerRightContent?: React.ReactNode;
  getKoushuInfo?: (studentId: string) => { enrolled: number; scheduled: number } | null;
  subjectNameById?: Map<string, string>;
  absenceKeySet?: Set<string>;
  onToggleAbsence?: (date: string, slotId: string, teacherId: string) => void;
  koushuPlacing?: boolean;
  getKoushuPlaceability?: (date: string, slotId: string) => { ok: boolean; reason: string | null };
  onKoushuPlace?: (date: string, slotId: string) => void;
  onKoushuPlaceWithTeacher?: (date: string, slotId: string, teacherId: string) => void;
  /** 向き: 'cols'=日=列(週俯瞰) / 'rows'=日=行(転置・既定) */
  orientation: ScheduleOrientation;
  /** 日=列モードのセル内カラム数（1 or 2）。転置モードでは無視 */
  colMode: 1 | 2;
  /** 座席番号（印刷ブース番号）: 日付 → 講師ID → 番号 */
  boothMapByDate?: Map<string, Map<string, number>>;
  /** 座席番号の保存（日付, 講師ID, 値） */
  onSeatNoChange?: (date: string, teacherId: string, value: string) => void;
  /** sticky ツールバーの実測高さ(px)。時限見出しの sticky top / 日行スナップの頭出しに使う */
  stickyOffset?: number;
}

export function WeeklyScheduleGridView(props: WeeklyScheduleGridViewProps) {
  const {
    weekDates,
    timeSlots,
    closedDates,
    maxStudentsPerTeacher,
    transferMode,
    activeId,
    activeEntry,
    getTeacherGroupsForCell,
    getUnassignedEntriesForCell,
    onDragStart,
    onDragEnd,
    onAddTeacher,
    onAddStudent,
    onRemoveTeacher,
    onStudentClick,
    onTransferTargetClick,
    onPrintDay,
    onBoothAssign,
    getKoushuInfo,
    subjectNameById,
    absenceKeySet,
    onToggleAbsence,
    koushuPlacing,
    getKoushuPlaceability,
    onKoushuPlace,
    onKoushuPlaceWithTeacher,
    orientation,
    colMode,
    boothMapByDate,
    onSeatNoChange,
    stickyOffset = 0,
  } = props;

  const todayLocal = getTodayLocalDateStr();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  // 転置モードの日行スナップはページ全体（document）スクロールに載せる。
  // mandatory はツールバーやパネルが絡むページ全体では引っかかりやすいため proximity で運用。
  // アンマウント・向き切替時は必ず元へ戻す（他ページに snap を残さない）。
  useEffect(() => {
    if (orientation !== 'rows') return;
    const el = document.documentElement;
    const prev = el.style.scrollSnapType;
    el.style.scrollSnapType = 'y proximity';
    return () => {
      el.style.scrollSnapType = prev;
    };
  }, [orientation]);

  // 手動で開いた「授業なし」スロット（slot.id をキー）
  const [expandedEmptySlots, setExpandedEmptySlots] = useState<Set<string>>(new Set());
  const toggleEmptySlot = (slotId: string) => {
    setExpandedEmptySlots((prev) => {
      const next = new Set(prev);
      if (next.has(slotId)) next.delete(slotId);
      else next.add(slotId);
      return next;
    });
  };

  // 各スロットが「授業あり」か（週内のどこかに生徒/未配置があるか）を判定
  const slotHasContent = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const slot of timeSlots) {
      let has = false;
      for (const d of weekDates) {
        const groups = getTeacherGroupsForCell(d, slot.id, slot.slot_number);
        const students = groups.reduce(
          (s, g) =>
            s +
            g.entries.filter((e) => e.status !== 'cancelled' && e.status !== 'transferred_out')
              .length,
          0
        );
        const un = getUnassignedEntriesForCell?.(d, slot.id).length ?? 0;
        if (students + un > 0) {
          has = true;
          break;
        }
      }
      map.set(slot.id, has);
    }
    return map;
  }, [timeSlots, weekDates, getTeacherGroupsForCell, getUnassignedEntriesForCell]);

  // 表示するスロット（授業あり / 手動展開 / 配置モードは全表示）と折りたたむスロット
  const shownSlots = timeSlots.filter(
    (s) => koushuPlacing || slotHasContent.get(s.id) || expandedEmptySlots.has(s.id)
  );
  const collapsedSlots = timeSlots.filter((s) => !shownSlots.includes(s));

  const cellLayout: 'pack' | 'col1' | 'col2' =
    orientation === 'rows' ? 'pack' : colMode === 2 ? 'col2' : 'col1';

  // 1セルを描画する共通関数
  const renderCell = (dateStr: string, slot: ScheduleTimeSlot) => {
    const isClosed = closedDates.includes(dateStr);
    const teacherGroups = getTeacherGroupsForCell(dateStr, slot.id, slot.slot_number);
    const place = koushuPlacing ? getKoushuPlaceability?.(dateStr, slot.id) : undefined;
    return (
      <DayCell
        key={`${dateStr}-${slot.id}`}
        date={dateStr}
        timeSlot={slot}
        isClosed={isClosed}
        teacherGroups={teacherGroups}
        unassignedEntries={getUnassignedEntriesForCell?.(dateStr, slot.id) ?? []}
        maxStudentsPerTeacher={maxStudentsPerTeacher}
        activeDragId={activeId}
        activeDragEntry={activeEntry}
        transferMode={!!transferMode}
        layout={cellLayout}
        onAddTeacher={(existingIds) => onAddTeacher(dateStr, slot.id, existingIds)}
        onAddStudent={(teacherId) => onAddStudent(dateStr, slot.id, teacherId)}
        onRemoveTeacher={(teacherId, entryCount) =>
          onRemoveTeacher(dateStr, slot.id, teacherId, entryCount)
        }
        onStudentClick={onStudentClick}
        onTransferTargetClick={
          onTransferTargetClick
            ? (_, slotId, teacherId) => onTransferTargetClick(dateStr, slotId, teacherId)
            : undefined
        }
        getKoushuInfo={getKoushuInfo}
        subjectNameById={subjectNameById}
        absenceKeySet={absenceKeySet}
        onToggleAbsence={onToggleAbsence}
        koushuPlacing={koushuPlacing}
        onKoushuPlaceWithTeacher={
          onKoushuPlaceWithTeacher
            ? (teacherId) => onKoushuPlaceWithTeacher(dateStr, slot.id, teacherId)
            : undefined
        }
        boothMap={boothMapByDate?.get(dateStr)}
        onSeatNoChange={
          onSeatNoChange
            ? (teacherId, value) => onSeatNoChange(dateStr, teacherId, value)
            : undefined
        }
        isToday={dateStr === todayLocal}
        placeability={place}
        onCellPlace={onKoushuPlace ? () => onKoushuPlace(dateStr, slot.id) : undefined}
      />
    );
  };

  const slotTimeLabel = (slot: ScheduleTimeSlot) =>
    `${slot.start_time?.slice(0, 5) ?? ''}〜${slot.end_time?.slice(0, 5) ?? ''}`;

  // ============ 日=列（週俯瞰） ============
  const renderColsBoard = () => {
    const gridCols = `44px repeat(${weekDates.length}, minmax(0, 1fr))`;
    return (
      <div className={styles.weekGrid} style={{ gridTemplateColumns: gridCols }}>
        {/* 曜日ヘッダー行 */}
        <div className={styles.cornerCell} />
        {weekDates.map((dateStr) => {
          const { dayNum, dateLong, weekday } = formatDayHeader(dateStr);
          const isToday = dateStr === todayLocal;
          return (
            <div
              key={dateStr}
              className={`${styles.dayHead} ${isToday ? styles.today : ''}`}
              title={dateLong}
            >
              <span className={styles.dDate}>{dayNum}</span>
              <span className={styles.dDay}>{weekday}</span>
              {onBoothAssign && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onBoothAssign(dateStr);
                  }}
                  className={styles.headBtn}
                  title={`${dateLong} のブース番号を一括設定`}
                >
                  <Hash size={11} />
                </button>
              )}
              {onPrintDay && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onPrintDay(dateStr);
                  }}
                  className={styles.headBtn}
                  title={`${dateLong} を印刷`}
                >
                  <Printer size={11} />
                </button>
              )}
            </div>
          );
        })}

        {/* スロット行（授業ありは全開、授業なしは折りたたみバー） */}
        {timeSlots.map((slot) => {
          const shown = shownSlots.includes(slot);
          if (!shown) {
            return (
              <div
                key={slot.id}
                className={styles.slotCollapsed}
                style={{ gridTemplateColumns: gridCols }}
              >
                <div className={styles.slotCollapsedLabel}>{slot.slot_number}限</div>
                <button
                  type="button"
                  onClick={() => toggleEmptySlot(slot.id)}
                  className={styles.collapsedBar}
                  style={{ gridColumn: `2 / -1` }}
                >
                  <span className={styles.chev}>▸</span>
                  {slot.slot_number}限 {slotTimeLabel(slot)} — 授業なし（クリックで開く）
                </button>
              </div>
            );
          }
          return (
            <React.Fragment key={slot.id}>
              <div className={styles.slotLabelMain}>
                {slot.slot_number}限
                <span className={styles.slotTime}>
                  {slot.start_time?.slice(0, 5)}
                  <br />
                  <span className={styles.slotTimeArrow}>↓</span>
                  <br />
                  {slot.end_time?.slice(0, 5)}
                </span>
              </div>
              {weekDates.map((dateStr) => renderCell(dateStr, slot))}
            </React.Fragment>
          );
        })}
      </div>
    );
  };

  // ============ 日=行（転置・既定） ============
  const renderRowsBoard = () => {
    const hasCollapsed = collapsedSlots.length > 0;
    const gridCols = `44px ${hasCollapsed ? '24px ' : ''}repeat(${shownSlots.length}, minmax(0, 1fr))`;
    return (
      <>
        {/* sticky 時限ヘッダー（本体と同じ列定義） */}
        <div
          className={`${styles.weekGridT} ${styles.tStickyHead}`}
          style={{ gridTemplateColumns: gridCols }}
        >
          <div className={styles.cornerCell} />
          {hasCollapsed && <div className={styles.vbarHead} />}
          {shownSlots.map((slot) => (
            <div key={slot.id} className={styles.slotHeadT}>
              {slot.slot_number}限<span className={styles.slotHeadTime}>{slotTimeLabel(slot)}</span>
            </div>
          ))}
        </div>

        {/* 本体グリッド：折りたたみ縦バー（日行を縦断）＋ 各曜日行 */}
        <div className={styles.weekGridT} style={{ gridTemplateColumns: gridCols }}>
          {hasCollapsed && (
            <button
              type="button"
              className={styles.collapsedVbar}
              style={{ gridColumn: 2, gridRow: `1 / ${weekDates.length + 1}` }}
              onClick={() => collapsedSlots.forEach((s) => toggleEmptySlot(s.id))}
              title={`${collapsedSlots.map((s) => `${s.slot_number}限`).join('・')} — 授業なし（クリックで開く）`}
            >
              {collapsedSlots.map((s) => `${s.slot_number}限`).join('・')} — 授業なし
            </button>
          )}
          {weekDates.map((dateStr) => {
            const { dayNum, dateLong, weekday } = formatDayHeader(dateStr);
            const isToday = dateStr === todayLocal;
            return (
              <React.Fragment key={dateStr}>
                <div
                  className={`${styles.dayLabelT} ${isToday ? styles.today : ''}`}
                  title={dateLong}
                >
                  <span className={styles.dDate}>{dayNum}</span>
                  <span className={styles.dDay}>{weekday}</span>
                  {onPrintDay && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onPrintDay(dateStr);
                      }}
                      className={styles.headBtn}
                      title={`${dateLong} を印刷`}
                    >
                      <Printer size={10} />
                    </button>
                  )}
                </div>
                {shownSlots.map((slot) => renderCell(dateStr, slot))}
              </React.Fragment>
            );
          })}
        </div>
      </>
    );
  };

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      {/* --sd-sticky-top: sticky ツールバーの実測高さ。時限見出しの top / 日行 scroll-margin が参照 */}
      <div
        className={`${styles.root} ${styles.boardCanvas}`}
        style={{ '--sd-sticky-top': `${stickyOffset}px` } as React.CSSProperties}
      >
        <div className={styles.boardArea}>
          {orientation === 'rows' ? renderRowsBoard() : renderColsBoard()}
        </div>
      </div>

      <DragOverlay>
        {activeEntry ? (
          <div className={styles.root} style={{ opacity: 0.95 }}>
            <StudentCard entry={activeEntry} onClick={() => {}} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
