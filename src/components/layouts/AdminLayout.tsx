'use client';

import { ReactNode } from 'react';
import { AppHeader } from '@/components/layout';
import { PrivacyScreen } from '@/components/privacy-screen';
import { useAuth } from '@/contexts/AuthContext';

interface AdminLayoutProps {
  children: ReactNode;
  headerTitle?: string;
  headerOnSettingsClick?: () => void;
  headerSettingsLabel?: string;
  headerOnBulkGradeUpdateClick?: () => void;
  title?: string;
  actions?: ReactNode; // 右上のボタン類
  fullWidth?: boolean; // コンテナ幅制限を解除
}

export function AdminLayout({
  children,
  headerTitle,
  headerOnSettingsClick,
  headerSettingsLabel,
  headerOnBulkGradeUpdateClick,
  title,
  actions,
  fullWidth
}: AdminLayoutProps) {
  useAuth();

  return (
    <div className="min-h-screen bg-white">
      {headerTitle && (
        <AppHeader
          title={headerTitle}
          onSettingsClick={headerOnSettingsClick}
          settingsLabel={headerSettingsLabel}
          onBulkGradeUpdateClick={headerOnBulkGradeUpdateClick}
        />
      )}
      <div className={`${fullWidth ? 'max-w-full px-4' : 'max-w-7xl px-4 sm:px-6 lg:px-8'} mx-auto py-6`}>
        {/* ページヘッダー */}
        {(title || actions) && (
          <div className="flex justify-between items-center mb-6">
            {title && <h1 className="text-2xl font-bold text-[#1a1a1a]">{title}</h1>}
            {actions && <div className="flex gap-2">{actions}</div>}
          </div>
        )}
        
        {/* コンテンツ */}
        {children}
      </div>
      <PrivacyScreen />
    </div>
  );
}
