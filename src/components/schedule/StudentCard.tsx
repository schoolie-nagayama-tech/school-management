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
  /** 講習モード: 申し込みコマ数 */
  koushuEnrolled?: number;
  /** 講習モード: 期間内の受講済みコマ数 */
  koushuScheduled?: number;
}

export const StudentCard = React.memo(function StudentCard({
  entry,
  onClick,
  onTransferClick,
  koushuEnrolled,
  koushuScheduled,
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
    .join('/') || '—';

  const isTransferredOut = entry.status === 'transferred_out';
  const isTransferredIn = entry.status === 'transferred_in';
  const isDraft = !!entry.isDraft;
  const canTransfer = onTransferClick && !isTransferredOut && entry.status !== 'cancelled' && !isDraft;

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
      title={isDraft ? '自動マッチングの仮配置（未公開）。コントロールパネルで公開すると確定します' : undefined}
      className={`
        px-1.5 py-1 rounded-lg border text-left shadow-sm
        cursor-pointer hover:shadow-md transition-[box-shadow,border-color,background-color] duration-150
        ${isDraft ? 'border-dashed border-2 border-info bg-info-subtle' : colorClass}
        ${isTransferredOut ? 'opacity-60 line-through' : ''}
      `}
    >
      {/* 1行目: 生徒名 + 学年 + 操作アイコン */}
      <div className="flex items-center gap-1">
        {isDraft && (
          <span
            className="flex-shrink-0 px-1 py-0.5 rounded text-[9px] font-bold bg-info text-white leading-none"
            title="自動マッチングの仮配置（未公開）"
          >
            仮
          </span>
        )}
        <p className={`text-sm font-semibold leading-tight truncate flex-1 min-w-0 ${isTransferredOut ? 'text-gray-500' : 'text-gray-900'}`}>
          {studentName}
          {/* 学年は名前のすぐ右に括弧書きでくっつける。
              フォントは少し小さく抑えるが、視認できる程度のコントラストを保つ。 */}
          <span className="ml-1 text-xs font-normal text-gray-500">({grade})</span>
        </p>
        {canTransfer && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onTransferClick(entry);
            }}
            className="flex-shrink-0 p-0.5 rounded hover:bg-gray-100 text-gray-400 hover:text-[var(--primary)]"
            title="振替"
            aria-label="振替"
          >
            <ArrowRightLeft className="w-3 h-3" />
          </button>
        )}
        <span
          className={`flex-shrink-0 text-xs ${
            statusKey === 'present' ? 'text-green-600' :
            statusKey === 'absent' ? 'text-red-600' :
            statusKey === 'late' ? 'text-yellow-600' : 'text-gray-400'
          }`}
        >
          {icon}
        </span>
      </div>
      {/* 2行目: 科目 + 講習残コマバッジ */}
      <div className="flex items-center gap-1">
        <p className="text-xs text-gray-700 font-medium leading-tight truncate flex-1 min-w-0">
          {subjectNames}
          {isTransferredIn && <span className="ml-1 text-blue-500 font-normal">振替</span>}
          {isTransferredOut && <span className="ml-1 text-gray-400 font-normal">→振替済</span>}
        </p>
        {koushuEnrolled !== undefined && (
          <span className="flex-shrink-0 text-[10px] font-semibold text-blue-600 bg-blue-50 px-1 py-0.5 rounded leading-none">
            残{Math.max(0, koushuEnrolled - (koushuScheduled ?? 0))}
          </span>
        )}
      </div>
    </div>
  );
});
