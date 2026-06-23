'use client';

import React from 'react';
import { Badge } from '@/components/ui';
import type { ScheduleEntry, ScheduleTimeSlot } from '@/types/schedule';

function gradeLabel(g: number): string {
  if (g <= 6) return `小${g}`;
  if (g <= 9) return `中${g - 6}`;
  return `高${g - 9}`;
}

/**
 * 今日からターゲット日付までの日数。
 * 正の値：未来、0：今日、負の値：過去（期限切れ）
 * ローカルタイムゾーンで日単位に切り下げて比較する。
 */
function daysUntil(targetDateStr: string): number {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const target = new Date(targetDateStr + 'T12:00:00');
  const tgt = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
  return Math.round((tgt - today) / (24 * 60 * 60 * 1000));
}

const ATTENDANCE_BG: Record<string, string> = {
  present: 'bg-success-subtle',
  absent: 'bg-danger-subtle',
  late: 'bg-warning-subtle',
};
const DEFAULT_BG = 'bg-white';

interface ScheduleCellProps {
  entries: ScheduleEntry[];
  timeSlot?: ScheduleTimeSlot;
  isDragging?: boolean;
  onClick: (e: React.MouseEvent) => void;
  onEntryClick?: (entry: ScheduleEntry, e: React.MouseEvent) => void;
  isClosed?: boolean;
}

export const ScheduleCell = React.memo(function ScheduleCell({
  entries,
  timeSlot: _timeSlot,
  isDragging,
  onClick,
  onEntryClick,
  isClosed,
}: ScheduleCellProps) {
  const visibleEntries = entries.filter((e) => e.status !== 'cancelled');
  const activeEntries = visibleEntries.filter((e) => e.status !== 'transferred_out');
  const transferredOutEntries = visibleEntries.filter((e) => e.status === 'transferred_out');

  if (isClosed) {
    return (
      <td
        className="border border-[var(--surface)] p-1 bg-[var(--surface)] text-[var(--paragraph-light)] text-center min-w-[120px]"
        onClick={onClick}
      >
        休講
      </td>
    );
  }

  return (
    <td
      className={`border border-[var(--surface)] p-1 min-w-[120px] align-top ${
        isDragging ? 'opacity-50' : ''
      }`}
      onClick={(e) => {
        if (activeEntries.length === 0) onClick(e);
      }}
    >
      <div className="min-h-[44px] space-y-1">
        {transferredOutEntries.map((entry) => {
          const studentName = entry.student
            ? `${entry.student.last_name} ${entry.student.first_name}（${gradeLabel(entry.student.grade)}）`
            : entry.student_id;
          // 振替期限チップ表示用：未消化（transfer_to_id 無し）かつ期限ありのものだけ
          const isUnresolved = !entry.transfer_to_id;
          const deadline = entry.transfer_deadline ?? null;
          const daysLeft = isUnresolved && deadline ? daysUntil(deadline) : null;
          // 期限切れ=赤、7日以内=黄、それ以外=灰
          const chipClass = (() => {
            if (daysLeft == null) return '';
            if (daysLeft < 0) return 'bg-danger-subtle text-danger border border-danger';
            if (daysLeft <= 7) return 'bg-warning-subtle text-warning border border-warning';
            return 'bg-surface text-text-body border border-border-default';
          })();
          const chipLabel = (() => {
            if (daysLeft == null) return null;
            if (daysLeft < 0) return `期限切れ (${-daysLeft}日経過)`;
            if (daysLeft === 0) return '期限：今日';
            return `振替期限 ${daysLeft}日`;
          })();
          return (
            <div
              key={entry.id}
              className="rounded px-2 py-1 text-xs bg-[var(--stroke)] text-[var(--paragraph-light)]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="truncate line-through">{studentName}</div>
              <div className="text-[10px] line-through">→ 振替先へ</div>
              {chipLabel && (
                <div
                  className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${chipClass}`}
                >
                  {chipLabel}
                </div>
              )}
            </div>
          );
        })}
        {activeEntries.map((entry) => {
          const isTransferIn = entry.status === 'transferred_in';
          const bg = entry.attendance_status
            ? (ATTENDANCE_BG[entry.attendance_status] ?? DEFAULT_BG)
            : DEFAULT_BG;
          const studentName = entry.student
            ? `${entry.student.last_name} ${entry.student.first_name}（${gradeLabel(entry.student.grade)}）`
            : entry.student_id;
          const subjectNames =
            (entry.subject_ids || [])
              .map((id) => entry.subjects?.find((s) => s.id === id)?.name ?? '')
              .filter(Boolean)
              .join('・') || '—';

          return (
            <div
              key={entry.id}
              className={`rounded px-2 py-1 text-xs cursor-pointer ${bg} border border-transparent hover:border-[var(--primary)]`}
              onClick={(e) => {
                e.stopPropagation();
                onEntryClick?.(entry, e);
              }}
            >
              {isTransferIn && (
                <Badge variant="outline" className="mb-1 text-[10px] bg-blue-100 border-blue-300">
                  振替
                </Badge>
              )}
              <div className="font-medium truncate" title={studentName}>
                {studentName}
              </div>
              <div className="text-[10px] text-[#2a2a2a] truncate">{subjectNames}</div>
              {entry.seat_label && (
                <div className="text-[10px] text-[var(--paragraph-light)]">
                  [{entry.seat_label}]
                </div>
              )}
            </div>
          );
        })}
        {activeEntries.length === 0 && (
          <div
            className="min-h-[40px] rounded border border-dashed border-[var(--stroke)] flex items-center justify-center text-[var(--paragraph-light)] text-xs hover:border-[var(--primary)] hover:text-[var(--primary)] cursor-pointer"
            onClick={onClick}
          >
            ＋ 追加
          </div>
        )}
      </div>
    </td>
  );
});
