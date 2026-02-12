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
  null: 'bg-white border-gray-200 text-gray-900',
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
    ? `${entry.student.last_name} ${entry.student.first_name}`
    : entry.student_id;
  const grade = entry.student ? gradeLabel(entry.student.grade) : '—';
  const subjectNames = (entry.subjects ?? [])
    .map((s) => (typeof s === 'object' && s && 'name' in s ? s.name : String(s)))
    .filter(Boolean)
    .join(' / ') || (entry.subject_ids?.length ? '—' : '—');

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
        px-2 py-1.5 rounded-lg border text-left shadow-sm
        cursor-pointer hover:bg-gray-50 hover:shadow-md transition-all duration-150
        ${colorClass}
        ${isTransferredOut ? 'opacity-60 line-through' : ''}
      `}
    >
      {/* 生徒名（最優先・強） */}
      <div className="flex justify-between items-start gap-2">
        <p className="text-base font-semibold text-gray-900 leading-relaxed break-words min-w-0">
          {studentName}
        </p>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          {canTransfer && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onTransferClick(entry);
              }}
              className="p-0.5 rounded hover:bg-gray-100 text-gray-400 hover:text-[var(--primary)]"
              title="振替"
              aria-label="振替"
            >
              <ArrowRightLeft className="w-3.5 h-3.5" />
            </button>
          )}
          <span
            className={
              statusKey === 'present'
                ? 'text-green-600'
                : statusKey === 'absent'
                  ? 'text-red-600'
                  : statusKey === 'late'
                    ? 'text-yellow-600'
                    : 'text-gray-400'
            }
          >
            {icon}
          </span>
        </div>
      </div>
      {/* 学年（中） */}
      <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{grade}</p>
      {/* 科目（弱） */}
      <p className="text-xs text-gray-400 mt-0.5 leading-relaxed break-words">
        {subjectNames || '—'}
      </p>
      {isTransferredIn && (
        <p className="text-xs text-blue-600 mt-0.5">振替</p>
      )}
      {isTransferredOut && (
        <p className="text-xs text-gray-400 mt-0.5">→ 振替済</p>
      )}
    </div>
  );
});
