'use client';

import React from 'react';
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
}

export const StudentCard = React.memo(function StudentCard({ entry, onClick }: StudentCardProps) {
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
        p-2 rounded border text-xs cursor-pointer hover:shadow-md transition-shadow
        ${colorClass}
        ${isTransferredOut ? 'opacity-50 line-through' : ''}
      `}
    >
      <div className="flex justify-between items-center gap-1">
        <span className="font-medium truncate">
          {studentName}
          <span className="text-[var(--paragraph)] font-normal ml-1">({grade})</span>
        </span>
        <span
          className={`flex-shrink-0 ${
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
