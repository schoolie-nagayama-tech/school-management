'use client';

import Link from 'next/link';
import { AdminLayout } from '@/components/layouts';
import { useAuth } from '@/contexts/AuthContext';
import { EmbedTokenManager } from '@/components/settings/EmbedTokenManager';
import { ChevronRight } from 'lucide-react';
import { ContextHelp } from '@/components/help/ContextHelp';
import {
  User,
  Users,
  School,
  FileText,
  Globe,
  Calendar,
  Shield,
  Clock,
  Link2,
  BookOpen,
  Bell,
  ListChecks,
  ClipboardList,
  Link as LinkIcon,
  MessageSquare,
  Wand2,
  BarChart3,
  LogIn,
  LayoutDashboard,
} from 'lucide-react';

interface SettingsItem {
  href: string;
  icon: React.ReactNode;
  label: string;
  description: string;
  requiresAdmin?: boolean;
  requiresManager?: boolean;
}

interface SettingsGroup {
  title: string;
  items: SettingsItem[];
}

// カテゴリごとに設定項目をグルーピング
const settingsGroups: SettingsGroup[] = [
  {
    title: 'アカウント・教室',
    items: [
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
        href: '/users',
        icon: <Users className="w-5 h-5" />,
        label: 'ユーザー管理',
        description: 'スタッフの追加・権限設定・教室割り当て',
        requiresManager: true,
      },
      {
        href: '/settings/quick-links',
        icon: <LinkIcon className="w-5 h-5" />,
        label: 'クイックリンク',
        description: '生徒管理ページ上部に表示する外部ツール（Grow・らくプリ等）へのリンク',
        requiresManager: true,
      },
      {
        href: '/settings/login-links',
        icon: <LogIn className="w-5 h-5" />,
        label: 'ログイン画面のリンク',
        description: 'ログイン画面に表示する、ログイン不要でアクセスできる業務用サイトへのリンク',
        requiresManager: true,
      },
      {
        href: '/settings/school-metrics',
        icon: <BarChart3 className="w-5 h-5" />,
        label: '月次経営指標の入力',
        description: '教室長ダッシュボードで使う入会・退会・在籍の月次実績/予算データの入力',
        requiresManager: true,
      },
      {
        href: '/settings/dashboard-widgets',
        icon: <Wand2 className="w-5 h-5" />,
        label: 'ダッシュボード表示設定',
        description: '生徒管理ページ上部の講習進捗サマリーなど、ウィジェットの表示ON/OFF',
        requiresManager: true,
      },
      {
        // 試用中のためヘッダーには出さず、ここが唯一の入口（navConfig のコメント参照）。
        href: '/dashboard',
        icon: <LayoutDashboard className="w-5 h-5" />,
        label: '教室長ダッシュボード（試用中）',
        description:
          '要対応・本日の授業・業務の進捗を1画面に集約。通塾日程の運用開始後に本領を発揮します',
        requiresManager: true,
      },
    ],
  },
  {
    title: '授業・教材',
    items: [
      {
        href: '/settings/subjects',
        icon: <ListChecks className="w-5 h-5" />,
        label: '科目設定',
        description: '成績ページで使う科目の追加・編集・削除',
        requiresManager: true,
      },
      {
        href: '/settings/textbooks',
        icon: <BookOpen className="w-5 h-5" />,
        label: '教材マスタ',
        description: '教材・カリキュラムの登録・編集',
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
        // 旧「コマ時間設定」「授業生徒数設定」はここに統合した（座席表の管理メニューからも辿れる）
        href: '/schedule/special-courses',
        icon: <Clock className="w-5 h-5" />,
        label: '授業の設定',
        description: '指導形態・コマ時間・定員・講座をまとめて設定',
        requiresManager: true,
      },
      {
        href: '/settings/exam-types',
        icon: <ClipboardList className="w-5 h-5" />,
        label: '試験名マスタ',
        description: '進行表の目標設定・試験範囲で使う試験名の管理',
        requiresManager: true,
      },
    ],
  },
  {
    title: '講習',
    items: [
      {
        href: '/settings/seasonal-shifts',
        icon: <Calendar className="w-5 h-5" />,
        label: '講習シフト設定',
        description: '季節講習のシフト管理',
        requiresManager: true,
      },
    ],
  },
  {
    title: '外部サイト自動入力',
    items: [
      {
        href: '/settings/automation',
        icon: <Wand2 className="w-5 h-5" />,
        label: '自動入力ローダー',
        description:
          '取次発注・スクールIE座席表など外部サイトへの自動入力に使う共通ブックマークレットの発行',
        requiresManager: true,
      },
    ],
  },
  {
    title: '保護者ポータル',
    items: [
      {
        href: '/settings/portal',
        icon: <Globe className="w-5 h-5" />,
        label: 'ポータル・フォーム設定',
        description: '保護者ポータルのメニュー・公開設定',
        requiresManager: true,
      },
      {
        // 教室長も自教室の棚卸しに使うので requiresManager（APIも manager＋自教室スコープ）。
        href: '/settings/line-status',
        icon: <MessageSquare className="w-5 h-5" />,
        label: 'LINE連携状況',
        description: '保護者にLINE通知が届く状態か・誰が何名紐づいているかの確認',
        requiresManager: true,
      },
      {
        href: '/settings/forms/moshi',
        icon: <FileText className="w-5 h-5" />,
        label: 'フォーム期間設定',
        description: '模試・模擬・集回数・曜日・相談・増コマの受付期間',
        requiresManager: true,
      },
    ],
  },
  {
    // 教室長以上（manager/owner/admin）に表示する。トップナビからも入れるが、
    // 設定一覧にも掲載しておき横断的に機能を見つけられるようにする。
    title: '問合せ管理',
    items: [
      {
        href: '/admin/inquiries',
        icon: <MessageSquare className="w-5 h-5" />,
        label: '問合せ管理',
        description: 'HPからの問合せを取り込み・追客・分析・発送まで一元管理',
        requiresManager: true,
      },
    ],
  },
  {
    title: '通知・セキュリティ',
    items: [
      {
        href: '/settings/alerts',
        icon: <Bell className="w-5 h-5" />,
        label: 'アラート設定',
        description: '成績低下・面談・申込・宿題未実施・遅刻などの発火条件',
        requiresManager: true,
      },
      {
        href: '/admin/settings/security',
        icon: <Shield className="w-5 h-5" />,
        label: 'セキュリティ設定',
        description: 'プライバシースクリーン・セッション管理',
        requiresAdmin: true,
      },
      {
        href: '/settings/integrations',
        icon: <Link2 className="w-5 h-5" />,
        label: '外部サービス連携',
        description: 'Googleカレンダー連携状況の確認',
        requiresAdmin: true,
      },
    ],
  },
];

export default function SettingsPage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin' || profile?.role === 'owner';
  const isManager = isAdmin || profile?.role === 'manager';

  // 権限でフィルタしたグループ（項目が0件のグループは非表示）
  const visibleGroups = settingsGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (item.requiresAdmin && !isAdmin) return false;
        if (item.requiresManager && !isManager) return false;
        return true;
      }),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <AdminLayout headerTitle="設定">
      <div>
        {/* コンテキストヘルプ */}
        <div className="flex justify-end mb-2">
          <ContextHelp
            searchQuery="設定"
            topics={[
              {
                title: '教室情報を編集する',
                description: '教室名やメール通知先を変更します。',
                steps: [
                  '「教室情報」をクリック',
                  '教室名・通知メール・教室コードを編集',
                  '「保存」で変更を確定',
                ],
              },
              {
                title: 'フォーム期間を設定する',
                description: '保護者向けフォームの受付期間を管理します。',
                steps: [
                  '「保護者ポータル」セクションの「フォーム期間設定」をクリック',
                  '対象フォームの受付開始日・終了日を設定',
                  '「保存」で変更を確定',
                ],
              },
              {
                title: 'ポータルのURLを確認する',
                description: '保護者ポータルの公開リンクを取得します。',
                steps: ['「ポータル・フォーム設定」をクリック', '教室ごとのポータルURLをコピー'],
              },
            ]}
          />
        </div>

        <div className="space-y-8">
          {visibleGroups.map((group) => (
            <section key={group.title}>
              <h2 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2 px-1">
                {group.title}
              </h2>
              <div className="space-y-1.5">
                {group.items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="flex items-center gap-4 p-4 bg-surface-raised border border-border rounded-lg hover:bg-surface hover:border-border transition-[background-color,border-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97]"
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
            </section>
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
