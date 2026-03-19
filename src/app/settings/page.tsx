'use client';

import Link from 'next/link';
import { AdminLayout } from '@/components/layouts';
import { useAuth } from '@/contexts/AuthContext';
import {
  User,
  School,
  FileText,
  Globe,
  Calendar,
  Shield,
  BookOpen,
  Clock,
} from 'lucide-react';

interface SettingsItem {
  href: string;
  icon: React.ReactNode;
  label: string;
  description: string;
  requiresAdmin?: boolean;
  requiresManager?: boolean;
}

const settingsItems: SettingsItem[] = [
  {
    href: '/settings/account',
    icon: <User className="w-5 h-5" />,
    label: 'アカウント設定',
    description: 'プロフィール・パスワード・Google連携',
  },
  {
    href: '/settings/school',
    icon: <School className="w-5 h-5" />,
    label: '教室情報',
    description: '教室名・住所・連絡先',
    requiresManager: true,
  },
  {
    href: '/settings/portal',
    icon: <Globe className="w-5 h-5" />,
    label: 'ポータル・フォーム設定',
    description: '保護者ポータルのメニュー・公開設定',
    requiresManager: true,
  },
  {
    href: '/settings/forms/moshi',
    icon: <FileText className="w-5 h-5" />,
    label: 'フォーム期間設定',
    description: '模試・模擬・集回数・曜日・相談・増コマの受付期間',
    requiresManager: true,
  },
  {
    href: '/settings/seasonal-shifts',
    icon: <Calendar className="w-5 h-5" />,
    label: '講習シフト設定',
    description: '季節講習のシフト管理',
    requiresManager: true,
  },
  {
    href: '/settings/attendance-types',
    icon: <Clock className="w-5 h-5" />,
    label: 'コマ種別設定',
    description: '授業コマの種別（通常・補習など）',
    requiresManager: true,
  },
  {
    href: '/admin/settings/security',
    icon: <Shield className="w-5 h-5" />,
    label: 'セキュリティ設定',
    description: 'プライバシースクリーン・セッション管理',
    requiresAdmin: true,
  },
];

export default function SettingsPage() {
  const { profile, permissions } = useAuth();
  const isAdmin = profile?.role === 'admin' || profile?.role === 'owner';
  const isManager = isAdmin || profile?.role === 'manager';

  const visibleItems = settingsItems.filter((item) => {
    if (item.requiresAdmin && !isAdmin) return false;
    if (item.requiresManager && !isManager) return false;
    return true;
  });

  return (
    <AdminLayout>
      <div className="max-w-3xl mx-auto py-8 px-4">
        <h1 className="text-2xl font-bold text-[#1a1a1a] mb-6">設定</h1>
        <div className="space-y-2">
          {visibleItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-4 p-4 bg-white border border-[#e5e7eb] rounded-lg hover:bg-[#f9fafb] hover:border-[#d1d5db] transition-colors"
            >
              <div className="flex-shrink-0 w-10 h-10 bg-[#f3f4f6] rounded-lg flex items-center justify-center text-[#4b5563]">
                {item.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-[#1f2937]">{item.label}</div>
                <div className="text-sm text-[#6b7280]">{item.description}</div>
              </div>
              <svg className="w-5 h-5 text-[#9ca3af] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          ))}
        </div>
      </div>
    </AdminLayout>
  );
}
