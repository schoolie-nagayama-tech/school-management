'use client';

/**
 * 集団レーン（週グリッド）
 *
 * 行 = 集団コマ時間（formation='group'）、列 = 表示日。
 * 各セルに、その (日付・コマ) の集団クラスを (講師ごとにまとめた) GroupCard で表示。
 * 同時開催数 (maxConcurrentGroups) 未満なら「+ 集団コマ」ボタンを出す。
 * 集団は手動編成なので D&D は無し（作成はモーダル）。
 */

import React from 'react';
import { Plus } from 'lucide-react';
import { GroupCard } from './GroupCard';
import type { ScheduleEntry, ScheduleTimeSlot } from '@/types/schedule';

interface Props {
  weekDates: string[];
  groupSlots: ScheduleTimeSlot[];
  /** 集団の講習エントリ（kind='koushu', formation='group'）。subjects 付きでも可 */
  entries: ScheduleEntry[];
  maxStudentsPerGroup: number;
  maxConcurrentGroups: number;
  closedDates?: string[];
  subjectNameById?: Map<string, string>;
  onCreate: (date: string, slotId: string) => void;
  onStudentClick?: (entry: ScheduleEntry, e: React.MouseEvent) => void;
  onRemoveEntry?: (entry: ScheduleEntry) => void;
}

const DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

function dateHeader(dateStr: string): { day: number; dow: string } {
  const d = new Date(dateStr + 'T12:00:00');
  return { day: d.getDate(), dow: DOW_LABELS[d.getDay()] };
}

export function GroupLaneGrid({
  weekDates,
  groupSlots,
  entries,
  maxStudentsPerGroup,
  maxConcurrentGroups,
  closedDates = [],
  subjectNameById,
  onCreate,
  onStudentClick,
  onRemoveEntry,
}: Props) {
  const closedSet = new Set(closedDates);
  const gridCols = `5rem repeat(${weekDates.length}, minmax(0, 1fr))`;

  // (date, slotId) → teacherId → エントリ群（キャンセル/振替元は除く）
  const visible = entries.filter((e) => e.status !== 'cancelled' && e.status !== 'transferred_out');
  const cellGroups = (date: string, slotId: string): Map<string, ScheduleEntry[]> => {
    const m = new Map<string, ScheduleEntry[]>();
    for (const e of visible) {
      if (e.entry_date !== date || e.time_slot_id !== slotId) continue;
      const tid = e.teacher_id ?? '__unassigned__';
      if (!m.has(tid)) m.set(tid, []);
      m.get(tid)!.push(e);
    }
    return m;
  };

  if (groupSlots.length === 0) return null;

  return (
    <div className="mt-6">
      <div className="flex items-center gap-2 mb-2">
        <h3 className="text-sm font-semibold text-accent-ink">集団指導</h3>
        <span className="text-xs text-accent-ink/70">
          1コマ最大{maxStudentsPerGroup}名・同時{maxConcurrentGroups}コマ
        </span>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[640px]">
          {/* ヘッダー行 */}
          <div
            className="grid border-b border-border-default"
            style={{ gridTemplateColumns: gridCols }}
          >
            <div className="px-1 py-1.5 text-[10px] text-text-muted">コマ</div>
            {weekDates.map((d) => {
              const { day, dow } = dateHeader(d);
              const closed = closedSet.has(d);
              return (
                <div
                  key={d}
                  className={`px-1 py-1.5 text-center text-xs font-medium ${closed ? 'text-text-faint' : 'text-text-body'}`}
                >
                  {day}（{dow}）
                </div>
              );
            })}
          </div>

          {/* コマごとの行 */}
          {groupSlots.map((slot) => (
            <div
              key={slot.id}
              className="grid border-b border-border-subtle"
              style={{ gridTemplateColumns: gridCols }}
            >
              {/* 時間ラベル */}
              <div className="px-1 py-1.5 border-r border-border-subtle">
                <div className="text-xs font-bold leading-none">{slot.slot_number}限</div>
                <div className="text-[9px] text-text-muted tabular-nums mt-0.5">
                  {slot.start_time?.slice(0, 5)}〜{slot.end_time?.slice(0, 5)}
                </div>
              </div>

              {/* 各日付のセル */}
              {weekDates.map((date) => {
                const closed = closedSet.has(date);
                const groups = cellGroups(date, slot.id);
                const canAdd = !closed && groups.size < maxConcurrentGroups;
                return (
                  <div
                    key={date}
                    className={`p-1 border-r border-border-subtle last:border-r-0 space-y-1 ${closed ? 'bg-surface/50' : ''}`}
                  >
                    {Array.from(groups.entries()).map(([tid, list]) => (
                      <GroupCard
                        key={tid}
                        entries={list}
                        maxStudents={maxStudentsPerGroup}
                        subjectNameById={subjectNameById}
                        onStudentClick={onStudentClick}
                        onRemoveEntry={onRemoveEntry}
                      />
                    ))}
                    {canAdd && (
                      <button
                        type="button"
                        onClick={() => onCreate(date, slot.id)}
                        className="w-full py-1 text-[10px] text-accent-ink/60 hover:text-accent-ink hover:bg-accent-ink-subtle rounded transition-colors"
                      >
                        <Plus className="w-3 h-3 inline -mt-0.5" /> 集団コマ
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
