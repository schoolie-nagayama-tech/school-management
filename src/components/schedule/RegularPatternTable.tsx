'use client';

import { Button, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Badge } from '@/components/ui';
import { Pencil, Trash2, Plus } from 'lucide-react';
import { DAY_OF_WEEK_LABELS, SCHEDULE_PERIOD_LABELS } from '@/types/schedule';
import type { ScheduleRegularPattern } from '@/types/schedule';

function gradeLabel(g: number): string {
  if (g <= 6) return `小${g}`;
  if (g <= 9) return `中${g - 6}`;
  return `高${g - 9}`;
}

interface RegularPatternTableProps {
  patterns: ScheduleRegularPattern[];
  subjectNames: Record<string, string>;
  onEdit: (p: ScheduleRegularPattern) => void;
  onDelete: (p: ScheduleRegularPattern) => void;
  onAdd: () => void;
  isLoading?: boolean;
}

export function RegularPatternTable({
  patterns,
  subjectNames,
  onEdit,
  onDelete,
  onAdd,
  isLoading,
}: RegularPatternTableProps) {
  if (isLoading) {
    return (
      <div className="py-8 text-center text-[var(--paragraph)]">読み込み中...</div>
    );
  }
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={onAdd}>
          <Plus className="mr-2 h-4 w-4" />
          通塾日程を追加
        </Button>
      </div>
      {patterns.length === 0 ? (
        <div className="py-8 text-center text-[var(--paragraph)]">
          通塾日程が登録されていません
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>生徒</TableHead>
              <TableHead>曜日</TableHead>
              <TableHead>コマ</TableHead>
              <TableHead>講師</TableHead>
              <TableHead>科目</TableHead>
              <TableHead>座席</TableHead>
              <TableHead>期間</TableHead>
              <TableHead className="w-24">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {patterns.map((p) => (
              <TableRow key={p.id}>
                <TableCell>
                  {p.student
                    ? `${p.student.last_name} ${p.student.first_name}（${gradeLabel(p.student.grade)}）`
                    : p.student_id}
                </TableCell>
                <TableCell>{DAY_OF_WEEK_LABELS[p.day_of_week] ?? p.day_of_week}</TableCell>
                <TableCell>
                  {p.time_slot
                    ? `${p.time_slot.slot_number}限 ${p.time_slot.start_time?.slice(0, 5)}-${p.time_slot.end_time?.slice(0, 5)}`
                    : '—'}
                </TableCell>
                <TableCell>
                  {p.teacher?.display_name || p.teacher?.email || p.teacher_id}
                </TableCell>
                <TableCell>
                  {(p.subject_ids || [])
                    .map((id) => subjectNames[id] || id)
                    .filter(Boolean)
                    .join(' / ') || '—'}
                </TableCell>
                <TableCell>{p.seat_label || '—'}</TableCell>
                <TableCell>
                  <Badge variant="outline">{SCHEDULE_PERIOD_LABELS[p.period_type]}</Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" onClick={() => onEdit(p)} className="p-2">
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onDelete(p)}
                      className="p-2 text-[#d9376e]"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
