'use client';

import React from 'react';
import { Button } from '@/components/ui';
import { RefreshCw } from 'lucide-react';
import type { ScheduleEntry } from '@/types/schedule';
import { formatGradeLabel } from '@/lib/utils/gradeLabel';

export interface TransferModeBarProps {
  entry: ScheduleEntry;
  slotLabel?: string;
  onCancel: () => void;
  /** Phase P2: 振替先を決めずに保留プールへ入れる。指定時のみボタンを表示。 */
  onHold?: () => void;
}

export function TransferModeBar({ entry, slotLabel, onCancel, onHold }: TransferModeBarProps) {
  const studentName = entry.student
    ? `${entry.student.last_name}${entry.student.first_name}（${formatGradeLabel(entry.student.grade)}）`
    : entry.student_id;
  const dateLabel = entry.entry_date
    ? (() => {
        const d = new Date(entry.entry_date + 'Z');
        const week = ['日', '月', '火', '水', '木', '金', '土'][d.getUTCDay()];
        return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${week})`;
      })()
    : '';
  const slot = slotLabel ?? (entry.time_slot ? `${entry.time_slot.slot_number}限` : '');
  // 振替元は「誰の・いつの・誰が見ていた・何の授業か」まで出す。生徒名と日付だけだと
  // 同じ生徒の別コマを動かしていても気付けない。
  const teacherName = entry.teacher?.display_name || entry.teacher?.email || '';
  const subjectNames = (entry.subjects ?? [])
    .map((s) => (typeof s === 'object' && s && 'name' in s ? s.name : String(s)))
    .filter(Boolean)
    .join('・');

  return (
    <div className="bg-blue-50 border border-blue-200 rounded px-2 py-1.5 mb-2 flex flex-wrap justify-between items-center gap-2">
      <div className="flex items-center gap-1.5">
        <RefreshCw className="text-blue-600 w-4 h-4" />
        <span className="text-xs text-[var(--headline)]">
          <strong>振替モード:</strong> {studentName} {dateLabel} {slot}
          {teacherName && ` ・ ${teacherName}`}
          {subjectNames && ` ・ ${subjectNames}`} → 振替先の講師ブロックをクリック
        </span>
      </div>
      <div className="flex items-center gap-2">
        {onHold && (
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-7"
            onClick={onHold}
            title="振替先を決めずに保留プールに入れる（後で座席表から配置）"
          >
            保留にする
          </Button>
        )}
        <Button variant="secondary" size="sm" className="text-xs h-7" onClick={onCancel}>
          キャンセル
        </Button>
      </div>
    </div>
  );
}
