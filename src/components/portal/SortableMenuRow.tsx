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
  /** 期間管理ページへのパス（例: /settings/forms/moshi/periods） */
  periodsPath?: string;
  activePeriodTitle: string | null;
  /** 登録済み期間一覧（フォーム作成有無の確認用） */
  registeredPeriods?: FormPeriod[];
  isSubmitting: boolean;
  onToggleVisibility: (menu: PortalMenu) => void;
  onEdit: (menu: PortalMenu) => void;
}

export function SortableMenuRow({
  menu,
  formType,
  periodsPath,
  activePeriodTitle,
  registeredPeriods = [],
  isSubmitting,
  onToggleVisibility,
  onEdit,
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
      <td className="border border-[#e5e7eb] px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="font-medium text-[#1f2937]">{menu.title}</div>
            {menu.description && (
              <div className="text-xs text-[#4b5563] mt-1">
                {menu.description}
              </div>
            )}
          </div>
          <Button
            onClick={() => onEdit(menu)}
            variant="secondary"
            size="sm"
            disabled={isSubmitting}
            className="shrink-0"
          >
            編集
          </Button>
        </div>
      </td>
      <td className="border border-[#e5e7eb] px-4 py-3">
        <div className="space-y-1">
          <VisibilityBadge
            itemType={menu.link_type}
            isVisible={menu.is_visible}
            activePeriodTitle={activePeriodTitle}
            hasRegisteredPeriods={registeredPeriods.length > 0}
            externalUrl={menu.link_url}
            onToggle={() => onToggleVisibility(menu)}
          />
          {formType && (
            <div className="text-xs text-[#6b7280] mt-1">
              {activePeriodTitle ? (
                <span className="text-[#059669] font-medium">
                  🟢 公開中（{activePeriodTitle}）
                </span>
              ) : (
                <span className="text-[#6b7280]">⚪ 公開中の期間なし</span>
              )}
              <span className="ml-2">登録済み: {registeredPeriods.length}件</span>
            </div>
          )}
        </div>
      </td>
      <td className="border border-[#e5e7eb] px-4 py-3">
        <div className="flex items-center gap-2">
          <button
            {...attributes}
            {...listeners}
            className="px-2 py-1 text-xs bg-[#f3f4f6] text-[#4b5563] rounded hover:bg-[#e5e7eb] cursor-grab active:cursor-grabbing disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={isSubmitting}
            title="ドラッグして並び替え"
          >
            ⋮⋮
          </button>
          {menu.link_type === 'internal' && periodsPath && (
            <Link
              href={periodsPath}
              className="inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-lg bg-[#3b82f6] text-white hover:bg-[#2563eb] transition-colors"
            >
              期間管理
            </Link>
          )}
        </div>
      </td>
    </tr>
  );
}
