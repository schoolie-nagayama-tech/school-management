'use client';

import { PortalMenuCard } from './PortalMenuCard';
import type { PortalMenu } from '@/types/database';

interface MenuWithActiveStatus {
  menu: PortalMenu;
  isFormActive: boolean;
}

interface PortalMenuListProps {
  menus: MenuWithActiveStatus[];
  schoolCode: string;
}

export function PortalMenuList({ menus, schoolCode }: PortalMenuListProps) {
  if (menus.length === 0) {
    return (
      <div className="bg-[#fffffe] rounded-xl border border-[#0d0d0d] p-8 text-center">
        <p className="text-[#2a2a2a]">現在利用可能なメニューはありません</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {menus.map(({ menu, isFormActive }) => (
        <PortalMenuCard
          key={menu.id}
          menu={menu}
          schoolCode={schoolCode}
          isFormActive={isFormActive}
        />
      ))}
    </div>
  );
}
