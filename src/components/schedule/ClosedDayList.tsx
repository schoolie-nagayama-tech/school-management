'use client';

import { Button, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Badge } from '@/components/ui';
import { Trash2, Plus } from 'lucide-react';
import type { ScheduleClosedDay } from '@/types/schedule';

function formatDate(d: string): string {
  const date = new Date(d + 'Z');
  const week = ['日', '月', '火', '水', '木', '金', '土'][date.getUTCDay()];
  return `${d}（${week}）`;
}

interface ClosedDayListProps {
  closedDays: ScheduleClosedDay[];
  onDelete: (id: string) => void;
  onAdd: () => void;
  isLoading?: boolean;
}

export function ClosedDayList({ closedDays, onDelete, onAdd, isLoading }: ClosedDayListProps) {
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
          休講日を追加
        </Button>
      </div>
      {closedDays.length === 0 ? (
        <div className="py-8 text-center text-[var(--paragraph)]">
          休講日が登録されていません
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>日付</TableHead>
              <TableHead>理由</TableHead>
              <TableHead className="w-24">種別</TableHead>
              <TableHead className="w-20">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {closedDays.map((row) => (
              <TableRow key={row.id}>
                <TableCell>{formatDate(row.closed_date)}</TableCell>
                <TableCell>{row.reason || '—'}</TableCell>
                <TableCell>
                  {row.is_global ? (
                    <Badge variant="default">全教室共通</Badge>
                  ) : (
                    <Badge variant="secondary">教室別</Badge>
                  )}
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onDelete(row.id)}
                    className="p-2 text-[#d9376e]"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
