'use client';

import React from 'react';
import { Button } from '@/components/ui';
import { ArrowLeftRight } from 'lucide-react';
import type { ScheduleEntry } from '@/types/schedule';
import { formatGradeLabel } from '@/lib/utils/gradeLabel';

export interface SwapModeBarProps {
  /** 入れ替え元（選択中の生徒A）のエントリ */
  entry: ScheduleEntry;
  /** 講師名（元エントリの担当講師） */
  teacherName?: string;
  onCancel: () => void;
}

/**
 * §2.12 生徒の入れ替えモードのバー。TransferModeBar と同系（emerald 系で振替の青と区別）。
 * 「入れ替え中: 生徒A（講師名） — 交換する相手の生徒をクリック」＋キャンセル。
 */
export function SwapModeBar({ entry, teacherName, onCancel }: SwapModeBarProps) {
  const studentName = entry.student
    ? `${entry.student.last_name}${entry.student.first_name}（${formatGradeLabel(entry.student.grade)}）`
    : (entry.student_id ?? '生徒');
  const teacher = teacherName ?? entry.teacher?.display_name ?? entry.teacher?.email ?? '';

  return (
    <div className="bg-emerald-50 border border-emerald-200 rounded px-2 py-1.5 mb-2 flex flex-wrap justify-between items-center gap-2">
      <div className="flex items-center gap-1.5">
        <ArrowLeftRight className="text-emerald-600 w-4 h-4" />
        <span className="text-xs text-[var(--headline)]">
          <strong>入れ替え中:</strong> {studentName}
          {teacher ? `（${teacher}）` : ''} — 交換する相手の生徒をクリック
        </span>
      </div>
      <Button variant="secondary" size="sm" className="text-xs h-7" onClick={onCancel}>
        キャンセル
      </Button>
    </div>
  );
}
