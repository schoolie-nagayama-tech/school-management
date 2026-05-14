'use client';

import Link from 'next/link';
import { AdminLayout } from '@/components/layouts';
import { useAuth } from '@/contexts/AuthContext';
import { EmbedTokenManager } from '@/components/settings/EmbedTokenManager';
import { ChevronRight } from 'lucide-react';
import {
  User,
  School,
  FileText,
  Globe,
  Calendar,
  Shield,
  Clock,
  Link2,
  BookOpen,
  GraduationCap,
  Bell,
  ListChecks,
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
    href: '/settings/textbooks',
    icon: <BookOpen className="w-5 h-5" />,
    label: '教材マスタ管理',
    description: '教材・カリキュラムの登録・編集',
    requiresManager: true,
  },
  {
    href: '/settings/trainings',
    icon: <GraduationCap className="w-5 h-5" />,
    label: '研修マスタ管理',
    description: '研修・講習のマスタ登録',
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
    href: '/settings/time-slots',
    icon: <Clock className="w-5 h-5" />,
    label: 'コマ時間設定',
    description: 'コマ番号・開始時刻・終了時刻の管理',
    requiresManager: true,
  },
  {
    href: '/admin/settings/attendance-types',
    icon: <Clock className="w-5 h-5" />,
    label: 'コマ種別設定',
    description: '授業コマの種別（通常・補習など）',
    requiresManager: true,
  },
  {
    href: '/settings/subjects',
    icon: <ListChecks className="w-5 h-5" />,
    label: '成績表科目マスタ',
    description: '成績ページで使う科目の追加・編集・削除',
    requiresManager: true,
  },
  {
    href: '/settings/alerts',
    icon: <Bell className="w-5 h-5" />,
    label: 'アラート設定',
    description: '成績低下・面談・申込・宿題未実施・遅刻などの発火条件',
    requiresManager: true,
  },
  {
    href: '/settings/integrations',
    icon: <Link2 className="w-5 h-5" />,
    label: '外部サービス連携',
    description: 'Googleカレンダー連携状況の確認',
    requiresAdmin: true,
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
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin' || profile?.role === 'owner';
  const isManager = isAdmin || profile?.role === 'manager';

  const visibleItems = settingsItems.filter((item) => {
    if (item.requiresAdmin && !isAdmin) return false;
    if (item.requiresManager && !isManager) return false;
    return true;
  });

  return (
    <AdminLayout headerTitle="設定">
      <div className="max-w-5xl mx-auto py-8 px-4">
        <div className="space-y-2">
          {visibleItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-4 p-4 bg-surface-raised border border-border rounded-lg hover:bg-surface hover:border-border transition-colors duration-150"
            >
              <div className="flex-shrink-0 w-10 h-10 bg-surface-hover rounded-lg flex items-center justify-center text-text-body">
                {item.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-text-heading">{item.label}</div>
                <div className="text-sm text-text-muted">{item.description}</div>
              </div>
              <ChevronRight className="w-5 h-5 text-text-faint flex-shrink-0" />
            </Link>
          ))}
        </div>

        {/* 埋め込みウィジェット管理 */}
        {isManager && (
          <div className="mt-8 p-4 bg-surface-raised border border-border rounded-lg">
            <EmbedTokenManager />
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
