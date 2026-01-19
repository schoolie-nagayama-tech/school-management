'use client';

import { ReactNode } from 'react';
import { AppHeader } from '@/components/layout';
import { SchoolSelector } from '@/components/SchoolSelector';
import { useAuth } from '@/contexts/AuthContext';

interface AdminLayoutProps {
  children: ReactNode;
  headerTitle?: string;
  headerOnSettingsClick?: () => void;
  title?: string;
  actions?: ReactNode; // 右上のボタン類
}

export function AdminLayout({ 
  children, 
  headerTitle,
  headerOnSettingsClick,
  title, 
  actions
}: AdminLayoutProps) {
  const { schoolIds, selectedSchoolId, isLoading } = useAuth();

  // ログイン済みで、複数教室があり、まだ教室が選択されていない場合は教室選択画面を表示
  if (!isLoading && schoolIds.length > 1 && selectedSchoolId === null) {
    return <SchoolSelector />;
  }

  return (
    <div className="min-h-screen bg-[#eff0f3]">
      {headerTitle && (
        <AppHeader title={headerTitle} onSettingsClick={headerOnSettingsClick} />
      )}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* ページヘッダー */}
        {(title || actions) && (
          <div className="flex justify-between items-center mb-6">
            {title && <h1 className="text-2xl font-bold text-[#0d0d0d]">{title}</h1>}
            {actions && <div className="flex gap-2">{actions}</div>}
          </div>
        )}
        
        {/* コンテンツ */}
        {children}
      </div>
    </div>
  );
}
