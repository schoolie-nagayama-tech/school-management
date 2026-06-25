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
      // 空状態: 軽い fade-in
      <div className="stagger-item bg-white rounded-xl border border-[#e5e7eb] p-8 text-center">
        <p className="text-[#6b7280] text-sm">現在利用可能なメニューはありません。</p>
        <p className="text-[#9ca3af] text-xs mt-1">受付期間外の可能性があります。</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {menus.map(({ menu, isFormActive, isVisible }, index) => (
        // stagger-item: 各カードを 40ms 刻みでフェードイン（8件超はクランプ）
        <div
          key={menu.id}
          className="stagger-item"
          style={{ '--stagger-index': Math.min(index, 7) } as React.CSSProperties}
        >
          <PortalMenuCard
            menu={menu}
            schoolCode={schoolCode}
            isFormActive={isFormActive}
            isVisible={isVisible}
          />
        </div>
      ))}
    </div>
  );
}
