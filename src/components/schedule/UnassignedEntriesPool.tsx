'use client';

/**
 * 担当未決定エントリのプール（座席表上部に集約表示）
 *
 * 設計意図:
 *  - 担当未決定エントリを座席表本体から取り出し、上部にまとめて1箇所に集約する
 *  - 各エントリはドラッグ可能なミニカードとして表示
 *  - ユーザーはここから生徒カードをドラッグして、座席表内の講師セルにドロップする
 *  - 制約チェック（指導科目・性別・除外）は TeacherCard 側で既に実装済（K-1）
 *
 * UI:
 *  - 件数バッジ + 折り畳み可能なバナー
 *  - 開くと曜日順 → コマ順で生徒チップ
 *  - 0 件のときは何も表示しない
 */

import React, { useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';
import type { ScheduleEntry, ScheduleTimeSlot } from '@/types/schedule';

const DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

interface UnassignedChipProps {
  entry: ScheduleEntry;
  timeSlot?: ScheduleTimeSlot;
  subjectNameById?: Map<string, string>;
  dow: number;
}

function UnassignedChip({ entry, timeSlot, subjectNameById, dow }: UnassignedChipProps) {
  // dnd-kit: ドラッグソースID は entry.id (DraggableStudentCard と同じ形式)。
  // これにより WeeklyScheduleGrid.handleDragEnd の生徒ドロップ処理がそのまま動く。
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
  const slotLabel = timeSlot ? `${timeSlot.slot_number}限` : '';

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`group inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border border-dashed border-warning bg-warning-subtle/60 text-warning-dark cursor-grab active:cursor-grabbing text-xs transition-all duration-150 ${
        isDragging ? 'opacity-30' : 'hover:bg-warning-subtle hover:shadow-sm'
      }`}
      title={`${DAY_LABELS[dow]}曜 ${slotLabel} ${studentName} ${gradeLabel} ${subjects.join('・')}`}
    >
      <span className="text-[10px] font-semibold text-warning tabular-nums flex-shrink-0">
        {DAY_LABELS[dow]} {slotLabel}
      </span>
      <span className="font-semibold text-text-body truncate max-w-[8rem]">{studentName}</span>
      {gradeLabel && <span className="text-[10px] text-text-muted">{gradeLabel}</span>}
      {subjects.length > 0 && (
        <span className="text-[10px] text-sky-700 truncate max-w-[6rem]">
          {subjects.join('・')}
        </span>
      )}
    </div>
  );
}

export interface UnassignedEntriesPoolProps {
  entries: ScheduleEntry[];
  timeSlots: ScheduleTimeSlot[];
  weekDates: string[];
  subjectNameById?: Map<string, string>;
}

export function UnassignedEntriesPool({
  entries,
  timeSlots,
  weekDates,
  subjectNameById,
}: UnassignedEntriesPoolProps) {
  const [isOpen, setIsOpen] = useState(true);

  // 担当未決定のみフィルタ（cancelled/transferred_out は除外）
  const unassigned = entries.filter(
    (e) => !e.teacher_id && e.status !== 'cancelled' && e.status !== 'transferred_out'
  );
  if (unassigned.length === 0) return null;

  const timeSlotById = new Map(timeSlots.map((s) => [s.id, s]));
  const weekDateSet = new Set(weekDates);

  // 曜日 (date 由来) → コマ番号順でソート
  const sorted = [...unassigned]
    .filter((e) => weekDateSet.has(e.entry_date))
    .sort((a, b) => {
      const slotA = timeSlotById.get(a.time_slot_id)?.slot_number ?? 999;
      const slotB = timeSlotById.get(b.time_slot_id)?.slot_number ?? 999;
      if (a.entry_date !== b.entry_date) return a.entry_date.localeCompare(b.entry_date);
      return slotA - slotB;
    });

  if (sorted.length === 0) return null;

  return (
    <div className="border border-warning/40 bg-warning-subtle/30 rounded-xl overflow-hidden print:hidden">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-warning-subtle/60 transition-colors text-left"
      >
        {isOpen ? (
          <ChevronDown className="w-4 h-4 text-warning" />
        ) : (
          <ChevronRight className="w-4 h-4 text-warning" />
        )}
        <AlertTriangle className="w-4 h-4 text-warning" />
        <span className="text-sm font-semibold text-warning">担当未決定プール</span>
        <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-warning text-white font-bold tabular-nums">
          {sorted.length}
        </span>
        <span className="text-xs text-text-muted ml-1">ドラッグして座席表の講師セルにドロップ</span>
      </button>

      {isOpen && (
        <div className="px-3 py-2 border-t border-warning/30 flex flex-wrap gap-1.5">
          {sorted.map((entry) => {
            const dow = new Date(entry.entry_date + 'T12:00:00').getDay();
            return (
              <UnassignedChip
                key={entry.id}
                entry={entry}
                timeSlot={timeSlotById.get(entry.time_slot_id)}
                subjectNameById={subjectNameById}
                dow={dow}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
