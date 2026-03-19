'use client';

import { PortalMenuCard } from './PortalMenuCard';
import type { PortalMenu } from '@/types/database';

interface MenuWithActiveStatus {
  menu: PortalMenu;
  isFormActive: boolean;
  isVisible: boolean;
}

interface PortalMenuListProps {
  menus: MenuWithActiveStatus[];
  schoolCode: string;
}

export function PortalMenuList({ menus, schoolCode }: PortalMenuListProps) {
  if (menus.length === 0) {
    return (
      <div className="bg-white/70 backdrop-blur-sm rounded-2xl border border-emerald-200/50 p-6 sm:p-8 text-center shadow-sm">
        <p className="text-slate-600 text-sm sm:text-base">現在利用可能なメニューはありません。受付期間外の可能性があります。</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 sm:space-y-4">
      {menus.map(({ menu, isFormActive, isVisible }) => (
        <PortalMenuCard
          key={menu.id}
          menu={menu}
          schoolCode={schoolCode}
          isFormActive={isFormActive}
          isVisible={isVisible}
        />
      ))}
    </div>
  );
}
