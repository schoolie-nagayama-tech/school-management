'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button, Badge } from '@/components/ui';
import { GripVertical, Pencil, Trash2 } from 'lucide-react';
import type { AttendanceType } from '@/types/attendance';

interface SortableAttendanceTypeRowProps {
  item: AttendanceType;
  onEdit: (item: AttendanceType) => void;
  onDeleteClick: (item: AttendanceType) => void;
  isSubmitting?: boolean;
}

export function SortableAttendanceTypeRow({
  item,
  onEdit,
  onDeleteClick,
  isSubmitting = false,
}: SortableAttendanceTypeRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <tr
      ref={setNodeRef}
      style={style}
      className={`border-b border-[#e5e7eb]/20 ${isDragging ? 'z-50 bg-white' : ''}`}
    >
      <td className="px-4 py-3 text-sm text-[#4b5563]">
        <button
          {...attributes}
          {...listeners}
          className="p-1 rounded hover:bg-[#f3f4f6] cursor-grab active:cursor-grabbing disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={isSubmitting}
          title="ドラッグして並び替え"
        >
          <GripVertical className="h-4 w-4 text-[#4b5563]" />
        </button>
      </td>
      <td className="px-4 py-3 text-sm font-medium text-[#4b5563]">{item.name}</td>
      <td className="px-4 py-3 text-sm text-[#4b5563]">
        <Badge variant="outline">
          {item.unit === 'count' ? 'コマ' : '時間'}
        </Badge>
      </td>
      <td className="px-4 py-3 text-sm text-right text-[#4b5563]">
        ¥{item.unit_price.toLocaleString()}
      </td>
      <td className="px-4 py-3 text-sm text-center text-[#4b5563]">
        {item.is_active ? (
          <Badge variant="default">有効</Badge>
        ) : (
          <Badge variant="secondary">無効</Badge>
        )}
      </td>
      <td className="px-4 py-3 text-sm text-[#4b5563]">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            onClick={() => onEdit(item)}
            className="p-2"
            disabled={isSubmitting}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            onClick={() => onDeleteClick(item)}
            className="p-2"
            disabled={isSubmitting}
          >
            <Trash2 className="h-4 w-4 text-[#ef4444]" />
          </Button>
        </div>
      </td>
    </tr>
  );
}
