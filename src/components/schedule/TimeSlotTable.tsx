'use client';

import {
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Switch,
  Loading,
} from '@/components/ui';
import { Pencil, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import type { ScheduleTimeSlot } from '@/types/schedule';

function timeLabel(t: string): string {
  if (!t) return '—';
  return t.slice(0, 5);
}

interface TimeSlotTableProps {
  slots: ScheduleTimeSlot[];
  onEdit: (slot: ScheduleTimeSlot) => void;
  onDelete: (slot: ScheduleTimeSlot) => void;
  onAdd: () => void;
  onMove?: (index: number, direction: 'up' | 'down') => void;
  /** 有効/無効バッジのインライントグル。編集ダイアログを開かず即切替する */
  onToggleActive?: (slot: ScheduleTimeSlot) => void;
  isLoading?: boolean;
}

export function TimeSlotTable({
  slots,
  onEdit,
  onDelete,
  onAdd,
  onMove,
  onToggleActive,
  isLoading,
}: TimeSlotTableProps) {
  if (isLoading) {
    return <Loading size="md" />;
  }
  if (slots.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <p className="text-[var(--paragraph)] mb-4">コマ時間が登録されていません</p>
        <Button onClick={onAdd}>最初のコマを追加</Button>
      </div>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-20">コマ番号</TableHead>
          <TableHead>開始時刻</TableHead>
          <TableHead>終了時刻</TableHead>
          <TableHead className="text-center">有効</TableHead>
          <TableHead className="w-20">順序</TableHead>
          <TableHead className="w-24">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {slots.map((slot, index) => (
          <TableRow key={slot.id}>
            <TableCell className="font-medium">{slot.slot_number}限</TableCell>
            <TableCell>{timeLabel(slot.start_time)}</TableCell>
            <TableCell>{timeLabel(slot.end_time)}</TableCell>
            <TableCell className="text-center">
              {/* 編集ダイアログを開かずに有効/無効を即切替できるインライントグル */}
              <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                <Switch checked={slot.is_active} onCheckedChange={() => onToggleActive?.(slot)} />
                <span className="text-xs text-[var(--paragraph)]">
                  {slot.is_active ? '有効' : '無効'}
                </span>
              </label>
            </TableCell>
            <TableCell>
              <div className="flex items-center gap-0.5">
                <Button
                  variant="ghost"
                  size="sm"
                  className="p-1 h-7 w-7"
                  disabled={index === 0}
                  onClick={() => onMove?.(index, 'up')}
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="p-1 h-7 w-7"
                  disabled={index === slots.length - 1}
                  onClick={() => onMove?.(index, 'down')}
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </Button>
              </div>
            </TableCell>
            <TableCell>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" onClick={() => onEdit(slot)} className="p-2">
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onDelete(slot)}
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
  );
}
