'use client';

import { useEffect, useMemo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useMasterData } from '@/contexts/MasterDataContext';
import { useClassroomDevice } from '@/contexts/ClassroomDeviceContext';
import { isManagerOrAbove, isTeacher } from '@/lib/utils/roles';
import {
  Users,
  ClipboardList,
  ListChecks,
  MessageSquare,
  CalendarCheck,
  CalendarDays,
  CalendarRange,
  Menu,
  type LucideIcon,
} from 'lucide-react';

interface MobileBottomNavProps {
  /** メニューシートが開いているか（「メニュー」タブのアクティブ表示に使う） */
  menuOpen: boolean;
  /** 「メニュー」タブのタップでシートを開閉する */
  onMenuToggle: () => void;
}

interface BottomTab {
  key: string;
  label: string;
  href: string;
  icon: LucideIcon;
  /** active 判定の前方一致パス（既定は href） */
  match?: string;
}

/**
 * スマホ専用のボトムタブナビ（PWA Phase 1）。
 *
 * PCのフルナビをそのまま縮めると埋もれて使いにくいため、スマホでは
 * 「ちら見・即対応」で使う頻度の高い画面だけを親指の届く下部バーに出す。
 * 5つ目の「メニュー」で全機能（navConfig のグループ）をボトムシートで開く。
 *
 * lg 未満でのみ表示。固定配置のためコンテンツに隠れないよう、body へ
 * `has-bottom-nav` クラスを付けて下部余白を確保する（globals.css）。
 */
export function MobileBottomNav({ menuOpen, onMenuToggle }: MobileBottomNavProps) {
  const pathname = usePathname();
  const { profile, permissions, schoolIds } = useAuth();
  const { schools: masterSchools } = useMasterData();
  // 教室端末の判定は ClassroomDeviceContext に一元化（PCナビ・ページゲートと同じ材料）
  const { outsideClassroom } = useClassroomDevice();

  // 講師の自分の出勤簿リンク用に担当教室コードを取得（AppHeader と同じ算出）
  const homeSchoolCode = useMemo(() => {
    const mine = masterSchools.filter((s) => schoolIds.includes(s.id));
    return mine[0]?.code ?? null;
  }, [masterSchools, schoolIds]);

  // 固定バー分の下部余白を body に確保（モバイルのみ。globals.css 側で媒体クエリ）
  useEffect(() => {
    document.body.classList.add('has-bottom-nav');
    return () => document.body.classList.remove('has-bottom-nav');
  }, []);

  const tabs = useMemo<BottomTab[]>(() => {
    if (!profile) return [];
    const teacher = isTeacher(profile.role);

    if (teacher) {
      // 講師の親指導線は「本日 / 予定 / 生徒 / 出勤簿」。
      // 着地を /today に変えた（正典 §1-7）のに合わせ、本日・予定を常設に格上げした。
      // 申込・テスト対策は下部バーからは外し「メニュー」シート（navConfig）へ集約する
      // （5タブの制約内に収め、教室外の端末でも並びが崩れないようにするため）。
      const list: BottomTab[] = [
        { key: 'today', label: '本日', href: '/today', icon: CalendarDays },
        { key: 'my-schedule', label: '予定', href: '/my-schedule', icon: CalendarRange },
      ];
      // 教室外の端末では生徒情報系を出さない（開いてもゲートで止まる死にリンクになるため）
      if (!outsideClassroom) {
        list.push({ key: 'students', label: '生徒', href: '/students', icon: Users });
      }
      if (homeSchoolCode && profile.id) {
        list.push({
          key: 'my-attendance',
          label: '出勤簿',
          href: `/attendance/${homeSchoolCode}/${profile.id}`,
          icon: CalendarCheck,
          match: '/attendance/',
        });
      }
      return list;
    }

    // 教室長以上: 生徒 / 回答一覧 / 進行表 / 問合せ
    const list: BottomTab[] = [{ key: 'students', label: '生徒', href: '/students', icon: Users }];
    if (permissions?.canAccessPortal) {
      list.push({
        key: 'responses',
        label: '回答一覧',
        href: '/responses',
        icon: ClipboardList,
        match: '/responses',
      });
    }
    list.push({ key: 'progress-feed', label: '進行表', href: '/progress-feed', icon: ListChecks });
    if (isManagerOrAbove(profile.role)) {
      list.push({
        key: 'inquiries',
        label: '問合せ',
        href: '/admin/inquiries',
        icon: MessageSquare,
        match: '/admin/inquiries',
      });
    }
    return list;
  }, [profile, permissions, homeSchoolCode, outsideClassroom]);

  // 未ログイン等でタブが無ければ何も描画しない
  if (!profile || tabs.length === 0) return null;

  const isTabActive = (tab: BottomTab): boolean => {
    if (!pathname) return false;
    const prefix = tab.match ?? tab.href;
    return pathname === prefix || pathname.startsWith(prefix + '/') || pathname.startsWith(prefix);
  };

  const itemClass = (active: boolean) =>
    `flex-1 flex flex-col items-center justify-center gap-0.5 py-1.5 transition-[color,transform] duration-150 ease-out active:scale-[0.94] ${
      active ? 'text-primary' : 'text-gray-400 hover:text-gray-600'
    }`;

  return (
    <nav
      aria-label="メインナビゲーション"
      className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-gray-200 pb-[env(safe-area-inset-bottom,0px)] print:hidden"
    >
      <div className="flex items-stretch h-14">
        {tabs.map((tab) => {
          const active = isTabActive(tab);
          const Icon = tab.icon;
          return (
            <Link
              key={tab.key}
              href={tab.href}
              className={itemClass(active)}
              aria-current={active ? 'page' : undefined}
            >
              <Icon className="w-5 h-5" aria-hidden />
              <span className="text-[10px] font-medium leading-none">{tab.label}</span>
            </Link>
          );
        })}
        {/* メニュー: 全機能のボトムシートを開く */}
        <button
          type="button"
          onClick={onMenuToggle}
          aria-expanded={menuOpen}
          className={itemClass(menuOpen)}
        >
          <Menu className="w-5 h-5" aria-hidden />
          <span className="text-[10px] font-medium leading-none">メニュー</span>
        </button>
      </div>
    </nav>
  );
}
