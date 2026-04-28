'use client';

import Link from 'next/link';
import { ChevronRight as ChevronRightIcon, ExternalLink } from 'lucide-react';
import type { PortalMenu } from '@/types/database';

interface PortalMenuCardProps {
  menu: PortalMenu;
  schoolCode: string;
  isFormActive?: boolean;
  isVisible?: boolean;
}

// アクティブカード（白背景+左線アクセント）
function ActiveCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white rounded-xl border border-[#e5e7eb] shadow-sm hover:shadow-md hover:border-[#d1d5db] active:scale-[0.99] transition-[transform,box-shadow,border-color] duration-150 ease-out ${className}`}>
      {children}
    </div>
  );
}

// 非アクティブカード
function DisabledCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-[#f3f4f6] rounded-xl border border-[#e5e7eb] opacity-60 cursor-not-allowed">
      {children}
    </div>
  );
}

// ステータスバッジ
function StatusBadge({ active }: { active: boolean }) {
  if (active) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
        受付中
      </span>
    );
  }
  return (
    <span className="inline-flex px-2 py-0.5 text-[11px] font-medium rounded-full bg-[#f3f4f6] text-[#9ca3af] border border-[#e5e7eb]">
      受付期間外
    </span>
  );
}

export function PortalMenuCard({ menu, schoolCode, isFormActive = false, isVisible = true }: PortalMenuCardProps) {
  const isMendan = menu.menu_key === 'mendan';
  const showAsDisabled = isVisible !== true;

  // カード内部のコンテンツ
  const cardContent = (
    <div className="flex items-center gap-3 p-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <h2 className="text-[15px] font-bold text-[#1a1a1a] truncate">{menu.title}</h2>
        </div>
        {menu.description && (
          <p className="text-[13px] text-[#6b7280] truncate">{menu.description}</p>
        )}
      </div>
      <StatusBadge active={isFormActive && !showAsDisabled} />
      {isFormActive && !showAsDisabled && <ChevronRightIcon className="w-4 h-4 text-[#9ca3af] flex-shrink-0" />}
    </div>
  );

  // 非公開
  if (showAsDisabled) {
    return <DisabledCard>{cardContent}</DisabledCard>;
  }

  // 外部リンク：面談（複数リンク）
  if (menu.link_type === 'external' && isMendan && menu.link_urls && menu.link_urls.length > 0) {
    return (
      <div className="space-y-2">
        <div className="px-1">
          <h2 className="text-[15px] font-bold text-[#1a1a1a]">{menu.title}</h2>
          {menu.description && <p className="text-[13px] text-[#6b7280] mt-0.5">{menu.description}</p>}
        </div>
        {menu.link_urls.map((link, index) => (
          <ActiveCard key={index}>
            <a
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 p-4"
            >
              <span className="flex-1 text-[15px] font-medium text-[#1a1a1a]">{link.label}</span>
              <ExternalLink className="w-3.5 h-3.5 text-[#9ca3af] flex-shrink-0" />
            </a>
          </ActiveCard>
        ))}
      </div>
    );
  }

  // 外部リンク：単一
  if (menu.link_type === 'external' && menu.link_url) {
    return (
      <ActiveCard>
        <a
          href={menu.link_url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 p-4"
        >
          <div className="flex-1 min-w-0">
            <h2 className="text-[15px] font-bold text-[#1a1a1a] truncate">{menu.title}</h2>
            {menu.description && <p className="text-[13px] text-[#6b7280] truncate">{menu.description}</p>}
          </div>
          <StatusBadge active />
          <ExternalLink className="w-3.5 h-3.5 text-[#9ca3af] flex-shrink-0" />
        </a>
      </ActiveCard>
    );
  }

  // 外部リンク未設定
  if (menu.link_type === 'external') {
    return <DisabledCard>{cardContent}</DisabledCard>;
  }

  // 内部フォーム
  if (menu.link_type === 'internal') {
    const formUrl = menu.link_url?.startsWith('/portal/')
      ? menu.link_url
      : `/portal/${schoolCode}/${menu.menu_key}`;

    if (!isFormActive) {
      return <DisabledCard>{cardContent}</DisabledCard>;
    }

    return (
      <ActiveCard>
        <Link href={formUrl} className="flex items-center gap-3 p-4">
          <div className="flex-1 min-w-0">
            <h2 className="text-[15px] font-bold text-[#1a1a1a] truncate">{menu.title}</h2>
            {menu.description && <p className="text-[13px] text-[#6b7280] truncate">{menu.description}</p>}
          </div>
          <StatusBadge active />
          <ChevronRightIcon className="w-4 h-4 text-[#9ca3af] flex-shrink-0" />
        </Link>
      </ActiveCard>
    );
  }

  // fallback
  return <DisabledCard>{cardContent}</DisabledCard>;
}
