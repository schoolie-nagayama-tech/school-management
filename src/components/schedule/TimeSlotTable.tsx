'use client';

import { Button, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Badge } from '@/components/ui';
import { Pencil, Trash2 } from 'lucide-react';
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
  isLoading?: boolean;
}

export function TimeSlotTable({ slots, onEdit, onDelete, onAdd, isLoading }: TimeSlotTableProps) {
  if (isLoading) {
    return (
      <div className="py-8 text-center text-[#2a2a2a]">読み込み中...</div>
    );
  }
  if (slots.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <p className="text-[#2a2a2a] mb-4">コマ時間が登録されていません</p>
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
          <TableHead className="w-24">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {slots.map((slot) => (
          <TableRow key={slot.id}>
            <TableCell className="font-medium">{slot.slot_number}限</TableCell>
            <TableCell>{timeLabel(slot.start_time)}</TableCell>
            <TableCell>{timeLabel(slot.end_time)}</TableCell>
            <TableCell className="text-center">
              {slot.is_active ? (
                <Badge variant="default">有効</Badge>
              ) : (
                <Badge variant="secondary">無効</Badge>
              )}
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
