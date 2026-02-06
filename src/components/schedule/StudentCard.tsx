'use client';

import React from 'react';
import { ArrowRightLeft } from 'lucide-react';
import type { ScheduleEntry } from '@/types/schedule';

function gradeLabel(grade: number): string {
  if (grade <= 6) return `小${grade}`;
  if (grade <= 9) return `中${grade - 6}`;
  return `高${grade - 9}`;
}

const STATUS_ICON: Record<string, string> = {
  present: '■',
  absent: '×',
  late: '△',
  null: '□',
};

const STATUS_COLOR: Record<string, string> = {
  present: 'bg-green-50 border-green-200 text-green-800',
  absent: 'bg-red-50 border-red-200 text-red-800',
  late: 'bg-yellow-50 border-yellow-200 text-yellow-800',
  null: 'bg-white border-[var(--surface)] text-[var(--headline)]',
};

export interface StudentCardProps {
  entry: ScheduleEntry;
  onClick: (e: React.MouseEvent) => void;
  onTransferClick?: (entry: ScheduleEntry) => void;
}

export const StudentCard = React.memo(function StudentCard({
  entry,
  onClick,
  onTransferClick,
}: StudentCardProps) {
  const status = entry.attendance_status ?? null;
  const statusKey = status === null ? 'null' : status;
  const icon = STATUS_ICON[statusKey] ?? '□';
  const colorClass = STATUS_COLOR[statusKey] ?? STATUS_COLOR.null;

  const studentName = entry.student
    ? `${entry.student.last_name}${entry.student.first_name}`
    : entry.student_id;
  const grade = entry.student ? gradeLabel(entry.student.grade) : '—';
  const subjectNames = (entry.subjects ?? [])
    .map((s) => (typeof s === 'object' && s && 'name' in s ? s.name : String(s)))
    .filter(Boolean)
    .join('/') || (entry.subject_ids?.length ? '—' : '—');

  const isTransferredOut = entry.status === 'transferred_out';
  const isTransferredIn = entry.status === 'transferred_in';
  const canTransfer = onTransferClick && !isTransferredOut && entry.status !== 'cancelled';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick(e as unknown as React.MouseEvent);
        }
      }}
      className={`
        px-1.5 py-1 rounded border text-[10px] cursor-pointer hover:shadow transition-shadow
        ${colorClass}
        ${isTransferredOut ? 'opacity-50 line-through' : ''}
      `}
    >
      <div className="flex justify-between items-center gap-1">
        <span className="font-medium truncate min-w-0">
          {studentName}
          <span className="text-[var(--paragraph)] font-normal ml-1">({grade})</span>
        </span>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          {canTransfer && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onTransferClick(entry);
              }}
              className="p-0.5 rounded hover:bg-[var(--surface)] text-[var(--paragraph-light)] hover:text-[var(--primary)]"
              title="振替"
              aria-label="振替"
            >
              <ArrowRightLeft className="w-3.5 h-3.5" />
            </button>
          )}
          <span
            className={`${
              statusKey === 'present'
                ? 'text-green-600'
                : statusKey === 'absent'
                  ? 'text-red-600'
                  : statusKey === 'late'
                    ? 'text-yellow-600'
                    : 'text-[var(--paragraph-light)]'
            }`}
          >
            {icon}
          </span>
        </div>
      </div>
      <div className="text-[var(--paragraph)] mt-0.5 truncate">{subjectNames || '—'}</div>
      {isTransferredIn && (
        <div className="text-blue-600 text-[10px] mt-0.5">振替</div>
      )}
      {isTransferredOut && (
        <div className="text-[var(--paragraph-light)] text-[10px] mt-0.5">→ 振替済</div>
      )}
    </div>
  );
});
