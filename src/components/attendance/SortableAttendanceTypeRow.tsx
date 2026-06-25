'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Pencil, Trash2 } from 'lucide-react';
import { TableCell } from '@/components/ui';
import type { AttendanceType } from '@/types/attendance';

interface SortableAttendanceTypeRowProps {
  item: AttendanceType;
  onEdit: (item: AttendanceType) => void;
  onDeleteClick: (item: AttendanceType) => void;
  isSubmitting: boolean;
}

export function SortableAttendanceTypeRow({
  item,
  onEdit,
  onDeleteClick,
  isSubmitting,
}: SortableAttendanceTypeRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <tr
      ref={setNodeRef}
      style={style}
      className={`border-b border-[#e5e7eb]/20 ${isDragging ? 'opacity-50 bg-white' : ''}`}
    >
      <TableCell className="w-12 border border-[#e5e7eb] px-4 py-3">
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="p-1 text-[#9ca3af] hover:text-[#6b7280] cursor-grab active:cursor-grabbing disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={isSubmitting}
          title="ドラッグして並び替え"
        >
          <GripVertical className="h-5 w-5" />
        </button>
      </TableCell>
      <TableCell className="border border-[#e5e7eb] px-4 py-3">
        <span className="font-medium text-[#1f2937]">{item.name}</span>
      </TableCell>
      <TableCell className="border border-[#e5e7eb] px-4 py-3">
        <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium border border-[#3b82f6] text-[#3b82f6] bg-white">
          {item.unit === 'count' ? 'コマ' : '時間'}
        </span>
      </TableCell>
      <TableCell className="text-right border border-[#e5e7eb] px-4 py-3">
        ¥{item.unit_price.toLocaleString()}
      </TableCell>
      <TableCell className="text-center border border-[#e5e7eb] px-4 py-3">
        <span
          className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
            item.is_active ? 'bg-[#3b82f6] text-white' : 'bg-[#f3f4f6] text-[#6b7280]'
          }`}
        >
          {item.is_active ? '有効' : '無効'}
        </span>
      </TableCell>
      <TableCell className="w-24 border border-[#e5e7eb] px-4 py-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onEdit(item)}
            disabled={isSubmitting}
            className="p-2 text-[#4b5563] hover:bg-[#f3f4f6] rounded-lg transition-[transform,background-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97] disabled:opacity-50"
            title="編集"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onDeleteClick(item)}
            disabled={isSubmitting}
            className="p-2 text-[#4b5563] hover:text-[#ef4444] hover:bg-[#fef2f2] rounded-lg transition-[transform,color,background-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97] disabled:opacity-50"
            title="削除"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </TableCell>
    </tr>
  );
}
