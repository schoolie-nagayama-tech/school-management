'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Edit2, Trash2 } from 'lucide-react';
import type { CurriculumItem } from '@/types/database';

interface SortableCurriculumRowProps {
  item: CurriculumItem;
  typeLabel: string;
  typeColor: string;
  isChapter: boolean;
  // 並び順保存中はドラッグを無効化する
  disabled?: boolean;
  onEdit: (item: CurriculumItem) => void;
  onDelete: (id: number) => void;
}

/**
 * 教材目次（カリキュラム）の並べ替え可能な行。
 * 左端のグリップをドラッグして sort_order を変更する。dnd-kit の useSortable で配線。
 */
export function SortableCurriculumRow({
  item,
  typeLabel,
  typeColor,
  isChapter,
  disabled = false,
  onEdit,
  onDelete,
}: SortableCurriculumRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <tr
      ref={setNodeRef}
      style={style}
      className={`hover:bg-surface transition-colors ${isChapter ? 'bg-surface-hover' : ''} ${
        isDragging ? 'relative z-10 opacity-80 bg-surface-raised shadow-md' : ''
      }`}
    >
      {/* ドラッグハンドル */}
      <td className="px-2 text-center">
        <button
          type="button"
          {...attributes}
          {...listeners}
          disabled={disabled}
          className="p-1 text-text-muted hover:text-ink cursor-grab active:cursor-grabbing disabled:opacity-50 disabled:cursor-not-allowed touch-none"
          title="ドラッグして並び替え"
        >
          <GripVertical className="w-4 h-4 inline" />
        </button>
      </td>
      <td className="px-3 py-2.5 text-center text-sm text-text-muted">{item.item_number || '-'}</td>
      <td
        className={`px-3 py-2.5 text-sm ${isChapter ? 'font-bold text-text-heading' : 'text-text-heading'}`}
      >
        {item.title}
      </td>
      <td className="px-3 py-2.5 text-center">
        <span className={`text-xs px-2 py-0.5 rounded ${typeColor}`}>{typeLabel}</span>
      </td>
      <td className="px-3 py-2.5 text-center">
        <div className="flex items-center justify-center gap-1">
          <button
            onClick={() => onEdit(item)}
            className="p-1.5 text-text-muted hover:text-ink hover:bg-surface-hover rounded transition-colors duration-150"
          >
            <Edit2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onDelete(item.id)}
            className="p-1.5 text-text-muted hover:text-red-600 hover:bg-red-50 rounded transition-colors duration-150"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </td>
    </tr>
  );
}
