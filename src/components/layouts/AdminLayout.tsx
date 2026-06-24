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
  narrow?: boolean; // 従来の max-w-7xl 幅（フォーム系ページ向け）
}

export function AdminLayout({
  children,
  headerTitle,
  headerOnSettingsClick,
  headerSettingsLabel,
  headerOnBulkGradeUpdateClick,
  title,
  actions,
  fullWidth,
  narrow,
}: AdminLayoutProps) {
  useAuth();

  return (
    <div className="min-h-screen bg-bg">
      {headerTitle && (
        <AppHeader
          title={headerTitle}
          onSettingsClick={headerOnSettingsClick}
          settingsLabel={headerSettingsLabel}
          onBulkGradeUpdateClick={headerOnBulkGradeUpdateClick}
        />
      )}
      <div
        className={`${
          fullWidth
            ? 'max-w-full px-4'
            : narrow
              ? 'max-w-7xl px-4 sm:px-6 lg:px-8'
              : 'max-w-[1600px] px-4 sm:px-6 lg:px-8'
        } mx-auto py-6`}
      >
        {/* ページヘッダー */}
        {(title || actions) && (
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
            {title && <h1 className="text-xl sm:text-2xl font-bold text-text-heading">{title}</h1>}
            {actions && <div className="flex flex-wrap gap-2 shrink-0">{actions}</div>}
          </div>
        )}

        {/* コンテンツ */}
        {children}
      </div>
      <PrivacyScreen />
    </div>
  );
}
