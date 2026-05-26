'use client';

import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
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
import { Printer } from 'lucide-react';

/** 表示用：ローカル日付で解釈して日付・曜日を返す */
function formatDayHeader(dateStr: string): { dayNum: number; dateLong: string; weekday: string } {
  const d = new Date(dateStr + 'T12:00:00');
  const month = d.getMonth() + 1;
  const date = d.getDate();
  const week = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
  return {
    dayNum: date,
    dateLong: `${month}月${date}日`,
    weekday: week,
  };
}

function getTodayLocalDateStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const SLOT_ROW_MIN_H = 'min-h-[60px]';

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
  onDragStart: (e: DragStartEvent) => void;
  onDragEnd: (event: DragEndEvent) => void;
  onAddTeacher: (date: string, slotId: string, existingTeacherIds: string[]) => void;
  onAddStudent: (date: string, slotId: string, teacherId: string) => void;
  onRemoveTeacher: (date: string, slotId: string, teacherId: string, entryCount: number) => void;
  onStudentClick: (entry: ScheduleEntry, e: React.MouseEvent) => void;
  onTransferClick?: (entry: ScheduleEntry) => void;
  onTransferTargetClick?: (date: string, slotId: string, teacherId: string) => void;
  onPrintDay?: (date: string) => void;
  /** 日付横のブース番号設定アイコン。印刷時に講師名の隣に表示される番号を編集するモーダルを開く */
  onBoothAssign?: (date: string) => void;
  /** 曜日ヘッダー行の一番右に表示する要素（例: 通塾日程ボタン） */
  headerRightContent?: React.ReactNode;
  getKoushuInfo?: (studentId: string) => { enrolled: number; scheduled: number } | null;
}

export function WeeklyScheduleGridView(props: WeeklyScheduleGridViewProps) {
  const {
    schoolId: _schoolId,
    weekDates,
    timeSlots,
    entries: _entries,
    closedDates,
    emptyTeacherSlots: _emptyTeacherSlots,
    maxStudentsPerTeacher,
    transferMode,
    activeId,
    activeEntry,
    groupEntriesByTeacher: _groupEntriesByTeacher,
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
    onBoothAssign,
    headerRightContent,
    getKoushuInfo,
  } = props;

  const todayLocal = getTodayLocalDateStr();

  // 「生徒0コマのスロット」をアコーディオン折りたたみする状態。
  // デフォルトは折りたたみ。ユーザーが手動で開いたものだけ記録する（slot.id をキーに）
  const [expandedEmptySlots, setExpandedEmptySlots] = useState<Set<string>>(new Set());
  const toggleEmptySlot = (slotId: string) => {
    setExpandedEmptySlots((prev) => {
      const next = new Set(prev);
      if (next.has(slotId)) next.delete(slotId);
      else next.add(slotId);
      return next;
    });
  };
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const gridCols = headerRightContent
    ? `5rem repeat(${weekDates.length}, minmax(0, 1fr)) auto`
    : `5rem repeat(${weekDates.length}, minmax(0, 1fr))`;

  return (
    <DndContext
      sensors={sensors}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <div className="flex flex-col gap-0 w-full">
        {/* Header row: 縦ミニカード型の日付（Apple × Notion 風ミニマル） */}
        <div
          className="grid gap-x-4 py-3 pr-2 border-b border-gray-200"
          style={{ gridTemplateColumns: gridCols }}
        >
          <div className="text-xs text-gray-500 font-medium self-center">コマ</div>
          {weekDates.map((dateStr) => {
            const { dayNum, dateLong, weekday } = formatDayHeader(dateStr);
            const isToday = dateStr === todayLocal;
            return (
              <div
                key={dateStr}
                className={`relative min-w-0 rounded-xl border px-3 py-2 flex flex-row items-center justify-center gap-1.5 transition-[background-color,border-color,box-shadow] duration-150 ease-out ${
                  isToday
                    ? 'bg-gray-100 text-gray-900 border-gray-300 scale-105'
                    : 'border-gray-200 bg-white hover:bg-gray-50 text-gray-700'
                }`}
                title={dateLong}
              >
                {isToday && (
                  <span
                    className="absolute top-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-gray-700"
                    aria-hidden
                  />
                )}
                <span className={`text-lg tabular-nums ${isToday ? 'font-bold' : 'font-semibold'}`}>{dayNum}</span>
                <span className="text-xs text-gray-500">{weekday}</span>
                {onBoothAssign && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onBoothAssign(dateStr);
                    }}
                    className="ml-0.5 p-0.5 rounded text-gray-400 hover:text-indigo-600 hover:bg-gray-200/80 no-print transition-colors duration-150 text-[10px] font-bold w-5 h-5 flex items-center justify-center border border-gray-300"
                    title={`${dateLong} のブース番号を設定`}
                    aria-label={`${dateLong} のブース番号を設定`}
                  >
                    #
                  </button>
                )}
                {onPrintDay && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onPrintDay(dateStr);
                    }}
                    className="ml-0.5 p-0.5 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-200/80 no-print transition-colors duration-150"
                    title={`${dateLong} を印刷`}
                    aria-label={`${dateLong} を印刷`}
                  >
                    <Printer className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            );
          })}
          {headerRightContent && (
            <div className="flex items-center justify-end pl-2 border-b border-transparent">
              {headerRightContent}
            </div>
          )}
        </div>

        {/* 時間帯ごとに横セクション（横ライン・zebra・余白） */}
        {timeSlots.map((slot, slotIndex) => {
          // この slot で1週間分のすべてのセルに生徒が居るか先に判定。
          // 全部 empty なら折りたたみ表示（ノイズになる空白行を抑える）
          const slotTotalStudents = weekDates.reduce((sum, d) => {
            const groups = getTeacherGroupsForCell(d, slot.id, slot.slot_number);
            return (
              sum +
              groups.reduce(
                (s, g) => s + g.entries.filter((e) => e.status !== 'cancelled' && e.status !== 'transferred_out').length,
                0
              )
            );
          }, 0);
          const isEmptySlot = slotTotalStudents === 0;
          const isExpanded = expandedEmptySlots.has(slot.id);

          // 空コマ × 折りたたみ中 → コンパクトな見出し1行だけ
          if (isEmptySlot && !isExpanded) {
            return (
              <button
                key={slot.id}
                type="button"
                onClick={() => toggleEmptySlot(slot.id)}
                className={`w-full text-left border-t border-gray-200 px-2 py-1.5 flex items-center gap-2 hover:bg-gray-50 transition-[background-color] duration-150 ease-[var(--ease-out)] ${slotIndex % 2 === 1 ? 'bg-gray-50' : ''}`}
                aria-expanded={false}
              >
                <ChevronDown className="w-3.5 h-3.5 text-gray-300 -rotate-90 transition-transform duration-150" />
                <span className="text-sm font-semibold text-gray-500">
                  <span className="tabular-nums">{slot.slot_number}</span>限
                </span>
                <span className="text-[10px] text-gray-400 tabular-nums">
                  {slot.start_time?.slice(0, 5)}〜{slot.end_time?.slice(0, 5)}
                </span>
                <span className="ml-auto text-[11px] text-gray-400">授業なし（クリックで開く）</span>
              </button>
            );
          }

          return (
          <div
            key={slot.id}
            className={`border-t border-gray-200 pt-2 pb-3 ${slotIndex % 2 === 1 ? 'bg-gray-50' : ''}`}
          >
            <div
              className="grid gap-x-6 w-full"
              style={{ gridTemplateColumns: gridCols }}
            >
              {/* 時間ラベル */}
              <div className="flex flex-col justify-center pl-0 pr-2 border-r border-gray-200">
                <div className="text-sm font-semibold text-gray-700 flex items-center gap-1">
                  {/* 空コマ展開中は折りたたみアイコンを出す */}
                  {isEmptySlot && isExpanded && (
                    <button
                      type="button"
                      onClick={() => toggleEmptySlot(slot.id)}
                      className="text-gray-300 hover:text-gray-500 transition-colors duration-150"
                      aria-label="折りたたむ"
                    >
                      <ChevronDown className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <span className="tabular-nums">{slot.slot_number}</span>限
                </div>
                <div className="text-[10px] text-gray-400 mt-0.5 tabular-nums">
                  {slot.start_time?.slice(0, 5)}〜{slot.end_time?.slice(0, 5)}
                </div>
              </div>

              {/* 各日のセル */}
              {weekDates.map((dateStr) => {
                const isClosed = closedDates.includes(dateStr);
                const teacherGroups = getTeacherGroupsForCell(
                  dateStr,
                  slot.id,
                  slot.slot_number
                );
                const cellKey = `${dateStr}-${slot.id}`;

                return (
                  <div key={cellKey} className={`min-w-0 ${SLOT_ROW_MIN_H} border-l border-gray-100 pl-2`}>
                    <DayCell
                      date={dateStr}
                      timeSlot={slot}
                      isClosed={isClosed}
                      teacherGroups={teacherGroups}
                      maxStudentsPerTeacher={maxStudentsPerTeacher}
                      activeDragId={activeId}
                      activeDragEntry={activeEntry}
                      transferMode={!!transferMode}
                      onAddTeacher={(existingIds) => onAddTeacher(dateStr, slot.id, existingIds)}
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
                      getKoushuInfo={getKoushuInfo}
                    />
                  </div>
                );
              })}
              {headerRightContent && <div className="min-w-0" aria-hidden />}
            </div>
          </div>
          );
        })}
      </div>

      <DragOverlay>
        {activeEntry ? (
          <div className="opacity-95 shadow-sm cursor-grabbing rounded-xl border border-gray-200 bg-white">
            <StudentCard entry={activeEntry} onClick={() => {}} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
