'use client';

import React from 'react';
import { Button } from '@/components/ui';
import { RefreshCw } from 'lucide-react';
import type { ScheduleEntry } from '@/types/schedule';

function gradeLabel(g: number): string {
  if (g <= 6) return `小${g}`;
  if (g <= 9) return `中${g - 6}`;
  return `高${g - 9}`;
}

export interface TransferModeBarProps {
  entry: ScheduleEntry;
  slotLabel?: string;
  onCancel: () => void;
}

export function TransferModeBar({ entry, slotLabel, onCancel }: TransferModeBarProps) {
  const studentName = entry.student
    ? `${entry.student.last_name}${entry.student.first_name}（${gradeLabel(entry.student.grade)}）`
    : entry.student_id;
  const dateLabel = entry.entry_date
    ? (() => {
        const d = new Date(entry.entry_date + 'Z');
        const week = ['日', '月', '火', '水', '木', '金', '土'][d.getUTCDay()];
        return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${week})`;
      })()
    : '';
  const slot = slotLabel ?? (entry.time_slot ? `${entry.time_slot.slot_number}限` : '');

  return (
    <div className="bg-blue-50 border border-blue-200 rounded px-2 py-1.5 mb-2 flex flex-wrap justify-between items-center gap-2">
      <div className="flex items-center gap-1.5">
        <RefreshCw className="text-blue-600 w-4 h-4" />
        <span className="text-xs text-[var(--headline)]">
          <strong>振替モード:</strong> {studentName} {dateLabel} {slot} → 振替先の講師ブロックをクリック
        </span>
      </div>
      <Button variant="secondary" size="sm" className="text-xs h-7" onClick={onCancel}>
        キャンセル
      </Button>
    </div>
  );
}
