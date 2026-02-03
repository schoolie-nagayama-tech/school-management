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
  /** 登録済み期間一覧（フォーム作成有無の確認用） */
  registeredPeriods?: FormPeriod[];
  isSubmitting: boolean;
  onToggleVisibility: (menu: PortalMenu) => void;
  onEdit: (menu: PortalMenu) => void;
  onEditPeriod?: (menu: PortalMenu) => void; // 公開期間を編集するコールバック
}

function formatPeriodPublishInfo(period: FormPeriod): string {
  const start = period.publish_start ? new Date(period.publish_start).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '未設定';
  const end = period.publish_end ? new Date(period.publish_end).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '未設定';
  return `公開開始: ${start} / 公開終了: ${end}`;
}

export function SortableMenuRow({
  menu,
  formType,
  settingsPath,
  activePeriodTitle,
  registeredPeriods = [],
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
      <td className="border border-[#e5e7eb] px-4 py-3">
        <div>
          <div className="font-medium text-[#1f2937]">{menu.title}</div>
          {menu.description && (
            <div className="text-xs text-[#4b5563] mt-1">
              {menu.description}
            </div>
          )}
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
            onEditPeriod={onEditPeriod ? () => onEditPeriod(menu) : undefined}
          />
          {formType && registeredPeriods.length >= 0 && (
            <div className="text-xs text-[#6b7280] mt-1">
              登録済み期間: {registeredPeriods.length}件
              {registeredPeriods.length > 0 &&
                registeredPeriods.slice(0, 3).map((p) => (
                  <div key={p.id} className="mt-0.5 pl-2 border-l-2 border-[#e5e7eb]">
                    <span className="font-mono">{p.period_key}</span> — {formatPeriodPublishInfo(p)}
                  </div>
                ))}
              {registeredPeriods.length === 0 && (
                <span className="text-[#9ca3af]">「詳細設定」で期間を作成してください</span>
              )}
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
              className="px-3 py-1 text-xs bg-[#3b82f6] text-white font-medium rounded hover:bg-[#60a5fa] transition-colors"
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
