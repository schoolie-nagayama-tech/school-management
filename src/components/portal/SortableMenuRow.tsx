'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Link from 'next/link';
import { Button } from '@/components/ui';
import { VisibilityBadge } from './VisibilityBadge';
import type { PortalMenu } from '@/types/database';
import type { FormType, FormPeriod } from '@/types/database';

interface SortableMenuRowProps {
  menu: PortalMenu;
  index: number;
  formType: FormType | null;
  settingsPath?: string;
  activePeriodTitle: string | null;
  isSubmitting: boolean;
  onToggleVisibility: (menu: PortalMenu) => void;
  onEdit: (menu: PortalMenu) => void;
  onEditPeriod?: (menu: PortalMenu) => void; // 公開期間を編集するコールバック
}

export function SortableMenuRow({
  menu,
  index,
  formType,
  settingsPath,
  activePeriodTitle,
  isSubmitting,
  onToggleVisibility,
  onEdit,
  onEditPeriod,
}: SortableMenuRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: menu.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <tr
      ref={setNodeRef}
      style={style}
      className={`table-row-hover ${isDragging ? 'z-50' : ''}`}
    >
      <td className="border border-[#0d0d0d] px-4 py-3">
        <div>
          <div className="font-medium text-[#0d0d0d]">{menu.title}</div>
          {menu.description && (
            <div className="text-xs text-[#2a2a2a] mt-1">
              {menu.description}
            </div>
          )}
        </div>
      </td>
      <td className="border border-[#0d0d0d] px-4 py-3">
        <VisibilityBadge
          itemType={menu.link_type}
          isVisible={menu.is_visible}
          activePeriodTitle={activePeriodTitle}
          externalUrl={menu.link_url}
          onToggle={() => onToggleVisibility(menu)}
          onEditPeriod={onEditPeriod ? () => onEditPeriod(menu) : undefined}
        />
      </td>
      <td className="border border-[#0d0d0d] px-4 py-3">
        <div className="flex items-center gap-2">
          <button
            {...attributes}
            {...listeners}
            className="px-2 py-1 text-xs bg-[#eff0f3] text-[#2a2a2a] rounded hover:bg-[#0d0d0d]/10 cursor-grab active:cursor-grabbing disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={isSubmitting}
            title="ドラッグして並び替え"
          >
            ⋮⋮
          </button>
          {menu.link_type === 'internal' && onEditPeriod ? (
            <Button
              onClick={() => onEditPeriod(menu)}
              variant="secondary"
              size="sm"
              disabled={isSubmitting}
            >
              詳細設定
            </Button>
          ) : menu.link_type === 'internal' && settingsPath ? (
            <Link
              href={settingsPath}
              className="px-3 py-1 text-xs bg-[#ff8e3c] text-[#0d0d0d] font-medium rounded hover:bg-[#ff9e5c] transition-colors"
            >
              設定
            </Link>
          ) : (
            <Button
              onClick={() => onEdit(menu)}
              variant="secondary"
              size="sm"
              disabled={isSubmitting}
            >
              編集
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}
