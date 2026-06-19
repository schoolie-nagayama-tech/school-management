'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getUnreadCount } from '@/lib/api/bulletin';
import { useAuth } from '@/contexts/AuthContext';
import { useMasterData } from '@/contexts/MasterDataContext';
import { USER_ROLE_LABELS } from '@/types/database';
import { Megaphone, ChevronDown, X, Menu, LogOut, Settings, LayoutDashboard, MessageSquare } from 'lucide-react';
import { TierMedal } from '@/components/teacher/TierMedal';
import { useTeacherBadgeCount } from '@/hooks/useTeacherBadgeCount';
import { BadgeFlowerField } from '@/components/badges/HiddenFlower';
import { HEADER_FLOWERS } from '@/components/badges/flowerPlacements';
import { ThemeToggle } from './ThemeToggle';
import { getSurname } from '@/lib/utils/teacherName';
import { PushNotificationButton } from '@/components/ui/PushNotificationButton';

interface AppHeaderProps {
  title: string;
  /** ページ固有の設定ボタン（申込項目管理など）*/
  onSettingsClick?: () => void;
  /** onSettingsClick のラベル（デフォルト: "ページ設定"）*/
  settingsLabel?: string;
  onBulkGradeUpdateClick?: () => void;
}

// ドロップダウンパネル共通クラス生成。
// 常時DOMに残し、opacity + scale の CSS transitionで開閉する。
// enter: 150ms ease-out（即時反応）/ exit: 100ms（より速く閉じて応答感を高める）
function dropdownPanelClass(open: boolean, align: 'left' | 'right' = 'left') {
  const base = 'absolute top-full mt-1 bg-white rounded-lg border border-gray-200 shadow-xl transition-[opacity,transform] ease-out';
  const origin = align === 'right' ? 'origin-top-right right-0' : 'origin-top-left left-0';
  // open: opacity 1 → full / closed: opacity 0 + scale 95 + pointer-events none（exit後クリック不可）
  const state = open
    ? 'opacity-100 scale-100 pointer-events-auto duration-150'
    : 'opacity-0 scale-95 pointer-events-none duration-100';
  return `${base} ${origin} ${state}`;
}

// ナビリンク共通クラス。hover + active:scale[0.97] で押した感を出す。
function navLinkClass(active: boolean) {
  return `px-2.5 py-1 rounded text-xs font-medium transition-[color,background-color,transform] duration-150 ease-out active:scale-[0.97] ${
    active
      ? 'bg-white text-primary font-semibold'
      : 'text-white/90 hover:bg-white/10 hover:text-white'
  }`;
}

// ドロップダウントリガーボタン共通クラス（上記 navLinkClass + flex）
function navDropdownTriggerClass(active: boolean) {
  return `px-2.5 py-1 rounded text-xs font-medium transition-[color,background-color,transform] duration-150 ease-out active:scale-[0.97] flex items-center gap-1 ${
    active
      ? 'bg-white text-primary font-semibold'
      : 'text-white/90 hover:bg-white/10 hover:text-white'
  }`;
}

// ドロップダウン内リンク / ボタン共通クラス
function dropdownItemClass(active: boolean) {
  return `block px-3 py-2 text-xs hover:bg-gray-50 transition-colors ${
    active ? 'bg-primary/10 text-primary font-semibold' : ''
  }`;
}

export function AppHeader({ title: _title, onSettingsClick, settingsLabel, onBulkGradeUpdateClick }: AppHeaderProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { profile, permissions, signOut, isLoading: authLoading, schoolIds, selectedSchoolId, setSelectedSchoolId, getSelectedSchoolIds } = useAuth();
  const { schools: masterSchools } = useMasterData();

  const handleSchoolChange = (schoolId: string | 'all') => {
    setSelectedSchoolId(schoolId);
    setShowSchoolDropdown(false);
    router.refresh();
  };
  // MasterData の教室一覧から担当教室だけを表示（getSchools の三重取得を避ける）
  const schools = useMemo(
    () => masterSchools.filter((school) => schoolIds.includes(school.id)),
    [masterSchools, schoolIds]
  );
  const displaySchools = schools;
  const [showSchoolDropdown, setShowSchoolDropdown] = useState(false);
  const [showSettingsDropdown, setShowSettingsDropdown] = useState(false);
  const [bulletinUnreadCount, setBulletinUnreadCount] = useState(0);
  const [showFormDropdown, setShowFormDropdown] = useState(false);
  const [showCourseDropdown, setShowCourseDropdown] = useState(false);
  const [showTeacherDropdown, setShowTeacherDropdown] = useState(false);
  const [showBusinessDropdown, setShowBusinessDropdown] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);

  // ナビドロップダウン: ホバーで開閉（150ms遅延で閉じる）
  const navCloseTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const navSetters = useMemo(() => ({
    form: setShowFormDropdown,
    course: setShowCourseDropdown,
    teacher: setShowTeacherDropdown,
    business: setShowBusinessDropdown,
  }), []);

  const handleNavEnter = useCallback((key: string) => {
    clearTimeout(navCloseTimers.current[key]);
    Object.entries(navSetters).forEach(([k, setter]) => {
      if (k !== key) { clearTimeout(navCloseTimers.current[k]); setter(false); }
    });
    navSetters[key as keyof typeof navSetters](true);
  }, [navSetters]);

  const handleNavLeave = useCallback((key: string) => {
    navCloseTimers.current[key] = setTimeout(() => {
      navSetters[key as keyof typeof navSetters](false);
    }, 150);
  }, [navSetters]);

  // ルート変更時にモバイルメニューを自動で閉じる
  useEffect(() => {
    setShowMobileMenu(false);
  }, [pathname]);

  // permissionsがnullの場合は、すべてのリンクを表示（ローディング中の場合）
  const showAllLinks = !permissions || authLoading;

  // 講師のみ: バッジ獲得数に応じてヘッダーにティアメダルを表示
  const isTeacher = profile?.role === 'teacher';
  const badgeCount = useTeacherBadgeCount();

  // 連絡掲示板未読件数（講師のみ）
  useEffect(() => {
    const schoolIdsList = getSelectedSchoolIds();
    if (profile?.role !== 'teacher' || !profile?.id || schoolIdsList.length === 0) {
      setBulletinUnreadCount(0);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const counts = await Promise.all(
          schoolIdsList.map((schoolId) => getUnreadCount(schoolId, profile.id))
        );
        const total = counts.reduce((a, b) => a + b, 0);
        if (!cancelled) setBulletinUnreadCount(total);
      } catch {
        if (!cancelled) setBulletinUnreadCount(0);
      }
    })();
    return () => { cancelled = true; };
  }, [getSelectedSchoolIds, profile?.id, profile?.role, selectedSchoolId, schoolIds]);

  useEffect(() => {
    if (profile?.role !== 'teacher') return;
    const refetch = () => {
      const schoolIdsList = getSelectedSchoolIds();
      if (!profile?.id || schoolIdsList.length === 0) return;
      (async () => {
        try {
          const counts = await Promise.all(
            schoolIdsList.map((schoolId) => getUnreadCount(schoolId, profile!.id))
          );
          setBulletinUnreadCount(counts.reduce((a, b) => a + b, 0));
        } catch {
          setBulletinUnreadCount(0);
        }
      })();
    };
    window.addEventListener('bulletin-unread-changed', refetch);
    return () => window.removeEventListener('bulletin-unread-changed', refetch);
  }, [getSelectedSchoolIds, profile?.id, profile?.role]);

  // 現在選択中の教室名を取得
  const getCurrentSchoolDisplayName = (): string => {
    if (selectedSchoolId === 'all') {
      return 'すべての教室';
    }
    if (selectedSchoolId) {
      const school = schools.find(s => s.id === selectedSchoolId);
      if (school) {
        return school.code === 'DEFAULT' ? 'デフォルト' : school.name;
      }
    }
    return '';
  };

  const schoolDisplayName = getCurrentSchoolDisplayName();

  // クリック外でドロップダウンを閉じる（教室選択・設定のみ — ナビはホバー制御）
  useEffect(() => {
    if (!showSchoolDropdown && !showSettingsDropdown) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (showSchoolDropdown && !target.closest('.school-dropdown-container')) {
        setShowSchoolDropdown(false);
      }
      if (showSettingsDropdown && !target.closest('.settings-dropdown-container')) {
        setShowSettingsDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showSchoolDropdown, showSettingsDropdown]);

  return (
    <header className="relative bg-primary shadow-md print:hidden">
      <BadgeFlowerField count={badgeCount ?? 0} placements={HEADER_FLOWERS} />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">
          <div className="flex items-center gap-4">
            {/* ハンバーガー（lg 未満で表示）
                Menu と X を両方常時renderし、rotate + opacity crossfade で切り替える。
                瞬間スワップより滑らかで、押した感を active:scale で補強する。 */}
            <button
              type="button"
              onClick={() => setShowMobileMenu((v) => !v)}
              aria-expanded={showMobileMenu}
              aria-controls="mobile-nav"
              aria-label={showMobileMenu ? 'メニューを閉じる' : 'メニューを開く'}
              className="lg:hidden p-1.5 text-white hover:bg-white/10 rounded-lg transition-[color,background-color,transform] duration-150 ease-out active:scale-[0.97]"
            >
              <div className="relative w-5 h-5">
                <Menu className={`absolute inset-0 w-5 h-5 transition-[opacity,transform] duration-150 ease-out ${showMobileMenu ? 'opacity-0 rotate-90 scale-75' : 'opacity-100 rotate-0 scale-100'}`} />
                <X className={`absolute inset-0 w-5 h-5 transition-[opacity,transform] duration-150 ease-out ${showMobileMenu ? 'opacity-100 rotate-0 scale-100' : 'opacity-0 -rotate-90 scale-75'}`} />
              </div>
            </button>
            {/* NESTロゴ */}
            <Link href="/students" className="shrink-0">
              <span className="text-white font-black text-2xl tracking-[0.4em] pr-[0.4em] select-none">
                NEST
              </span>
            </Link>
            <div className="hidden lg:block h-6 w-px bg-white/30"></div>
            <nav className="hidden lg:flex items-center gap-3">
              {(showAllLinks || permissions?.canAccessStudents) && (
                <Link
                  href="/students"
                  className={navLinkClass(pathname === '/students')}
                >
                  生徒管理
                </Link>
              )}
              {(showAllLinks || (permissions?.canAccessStudents && profile?.role !== 'teacher')) && (
                <Link
                  href="/progress-feed"
                  className={navLinkClass(pathname === '/progress-feed')}
                >
                  進行表確認
                </Link>
              )}
              {(showAllLinks || permissions?.canAccessApplications) && (
                <Link
                  href="/applications"
                  className={navLinkClass(pathname === '/applications')}
                >
                  申込状況
                </Link>
              )}
              {/* テスト対策（講師向けトップレベルリンク。教室長以上は講習管理ドロップダウン内に表示） */}
              {profile?.role === 'teacher' && (
                <Link
                  href="/test-prep-proposals"
                  className={navLinkClass(!!pathname?.startsWith('/test-prep-proposals'))}
                >
                  テスト対策
                </Link>
              )}
              {/* フォーム管理（教室長以上のみ）
                  ドロップダウンは常時DOMに残留。opacity + scale のCSS transitionで enter/exit を両方アニメートする。 */}
              {(showAllLinks || permissions?.canAccessPortal) && (
                <div
                  className="relative form-dropdown-container"
                  onMouseEnter={() => handleNavEnter('form')}
                  onMouseLeave={() => handleNavLeave('form')}
                >
                  <button
                    className={navDropdownTriggerClass(
                      !!(pathname?.startsWith('/responses') ||
                      pathname?.startsWith('/forms/responses') ||
                      pathname === '/settings/portal' ||
                      pathname?.startsWith('/settings/portal') ||
                      pathname?.startsWith('/transcriptions') ||
                      pathname?.startsWith('/test-prep-proposals'))
                    )}
                  >
                    フォーム管理
                    <ChevronDown className={`w-3 h-3 transition-[transform] duration-150 ease-out ${showFormDropdown ? 'rotate-180' : ''}`} />
                  </button>
                  <div
                    className={`${dropdownPanelClass(showFormDropdown)} z-50 min-w-[150px]`}
                    aria-hidden={!showFormDropdown}
                  >
                    <div className="py-1">
                      <Link
                        href="/responses"
                        className={dropdownItemClass(!!(pathname?.startsWith('/responses') || pathname?.startsWith('/forms/responses')))}
                      >
                        回答一覧
                      </Link>
                      <Link
                        href="/transcriptions"
                        className={dropdownItemClass(!!pathname?.startsWith('/transcriptions'))}
                      >
                        面談記録追加
                      </Link>
                      {(showAllLinks || permissions?.canAccessPortal) && (
                        <Link
                          href="/settings/portal"
                          className={dropdownItemClass(!!(pathname === '/settings/portal' || pathname?.startsWith('/settings/portal')))}
                        >
                          ポータル設定
                        </Link>
                      )}
                      <Link
                        href="/test-prep-proposals"
                        className={dropdownItemClass(!!pathname?.startsWith('/test-prep-proposals'))}
                      >
                        テスト対策
                      </Link>
                    </div>
                  </div>
                </div>
              )}
              {/* 講習管理 */}
              {(showAllLinks || permissions?.canAccessCourses) && (
                <div
                  className="relative course-dropdown-container"
                  onMouseEnter={() => handleNavEnter('course')}
                  onMouseLeave={() => handleNavLeave('course')}
                >
                  <button
                    className={navDropdownTriggerClass(!!(pathname === '/courses' || pathname?.startsWith('/courses/')))}
                  >
                    講習管理
                    <ChevronDown className={`w-3 h-3 transition-[transform] duration-150 ease-out ${showCourseDropdown ? 'rotate-180' : ''}`} />
                  </button>
                  <div
                    className={`${dropdownPanelClass(showCourseDropdown)} z-50 min-w-[150px]`}
                    aria-hidden={!showCourseDropdown}
                  >
                    <div className="py-1">
                      <Link
                        href="/courses"
                        className={dropdownItemClass(!!(pathname === '/courses' && !pathname?.startsWith('/courses/')))}
                      >
                        講習一覧
                      </Link>
                      <Link
                        href="/courses/progress"
                        className={dropdownItemClass(!!pathname?.startsWith('/courses/progress'))}
                      >
                        進捗管理
                      </Link>
                      <Link
                        href="/courses/schedule"
                        className={dropdownItemClass(!!pathname?.startsWith('/courses/schedule'))}
                      >
                        準備スケジュール
                      </Link>
                      <Link
                        href="/courses/proposals"
                        className={dropdownItemClass(!!pathname?.startsWith('/courses/proposals'))}
                      >
                        講習提案書
                      </Link>
                    </div>
                  </div>
                </div>
              )}
              {/* 講師メニュー（教室長以上のみ） */}
              {!profile || profile.role !== 'teacher' ? (
                <div
                  className="relative teacher-dropdown-container"
                  onMouseEnter={() => handleNavEnter('teacher')}
                  onMouseLeave={() => handleNavLeave('teacher')}
                >
                  <button
                    className={navDropdownTriggerClass(!!(
                      pathname?.startsWith('/admin/teachers') ||
                      pathname?.startsWith('/admin/attendance') ||
                      pathname?.startsWith('/admin/teacher-badges') ||
                      pathname === '/settings/seasonal-shifts' ||
                      pathname?.startsWith('/settings/seasonal-shifts')
                    ))}
                  >
                    講師
                    <ChevronDown className={`w-3 h-3 transition-[transform] duration-150 ease-out ${showTeacherDropdown ? 'rotate-180' : ''}`} />
                  </button>
                  <div
                    className={`${dropdownPanelClass(showTeacherDropdown)} z-50 min-w-[180px]`}
                    aria-hidden={!showTeacherDropdown}
                  >
                    <div className="py-1">
                      <Link
                        href="/admin/teachers"
                        className={dropdownItemClass(!!(pathname === '/admin/teachers' || pathname?.startsWith('/admin/teachers')))}
                      >
                        講師一覧
                      </Link>
                      <Link
                        href="/admin/attendance"
                        className={dropdownItemClass(!!(pathname === '/admin/attendance' || pathname?.startsWith('/admin/attendance/')))}
                      >
                        出勤簿管理
                      </Link>
                      <Link
                        href="/settings/seasonal-shifts"
                        className={dropdownItemClass(!!(pathname === '/settings/seasonal-shifts' || pathname?.startsWith('/settings/seasonal-shifts')))}
                      >
                        シフト設定
                      </Link>
                      <Link
                        href="/admin/teacher-badges"
                        className={dropdownItemClass(!!(pathname === '/admin/teacher-badges' || pathname?.startsWith('/admin/teacher-badges')))}
                      >
                        研修バッジ管理
                      </Link>
                    </div>
                  </div>
                </div>
              ) : (
                /* 講師は自分の出勤簿へのリンク（マイトロフィーは右上のバッジメダルから） */
                <>
                  {schools.length > 0 && schools[0]?.code && profile?.id && (
                    <Link
                      href={`/attendance/${schools[0].code}/${profile.id}`}
                      className={navLinkClass(!!pathname?.startsWith('/attendance/'))}
                    >
                      出勤簿
                    </Link>
                  )}
                </>
              )}
              {/* 業務管理（教室長以上のみ） */}
              {(showAllLinks || permissions?.canAccessBilling) && (
                <div
                  className="relative business-dropdown-container"
                  onMouseEnter={() => handleNavEnter('business')}
                  onMouseLeave={() => handleNavLeave('business')}
                >
                  <button
                    className={navDropdownTriggerClass(!!(
                      pathname?.startsWith('/billing') ||
                      pathname?.startsWith('/ordering') ||
                      pathname?.startsWith('/inventory') ||
                      pathname?.startsWith('/tasks')
                    ))}
                  >
                    業務管理
                    <ChevronDown className={`w-3 h-3 transition-[transform] duration-150 ease-out ${showBusinessDropdown ? 'rotate-180' : ''}`} />
                  </button>
                  <div
                    className={`${dropdownPanelClass(showBusinessDropdown)} z-[9999] min-w-[150px]`}
                    aria-hidden={!showBusinessDropdown}
                  >
                    <div className="py-1">
                      <Link
                        href="/billing"
                        className={dropdownItemClass(!!pathname?.startsWith('/billing'))}
                      >
                        請求管理
                      </Link>
                      <Link
                        href="/ordering"
                        className={dropdownItemClass(!!(pathname?.startsWith('/ordering') || pathname?.startsWith('/inventory')))}
                      >
                        教材・発注管理
                      </Link>
                      <Link
                        href="/tasks"
                        className={dropdownItemClass(!!pathname?.startsWith('/tasks'))}
                      >
                        業務進捗管理表
                      </Link>
                    </div>
                  </div>
                </div>
              )}
            </nav>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-3">
            {displaySchools.length > 1 && schoolDisplayName && (
              <div className="relative school-dropdown-container">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowSchoolDropdown(!showSchoolDropdown);
                  }}
                  className="text-white px-2.5 py-1.5 bg-white/20 rounded-lg hover:bg-white/30 transition-[color,background-color,transform] duration-150 ease-out active:scale-[0.97] flex items-center gap-1 text-xs font-medium shrink-0 whitespace-nowrap max-w-[110px] sm:max-w-none"
                >
                  <span className="truncate">{schoolDisplayName}</span>
                  <ChevronDown className={`w-3 h-3 transition-[transform] duration-150 ease-out ${showSchoolDropdown ? 'rotate-180' : ''}`} />
                </button>
                <div
                  className={`${dropdownPanelClass(showSchoolDropdown, 'right')} z-50 min-w-[200px] ring-1 ring-black/5`}
                  onClick={(e) => e.stopPropagation()}
                  aria-hidden={!showSchoolDropdown}
                >
                  <div className="py-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSchoolChange('all');
                      }}
                      className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-50 transition-colors ${
                        selectedSchoolId === 'all' ? 'bg-primary/10 text-primary font-semibold' : ''
                      }`}
                    >
                      すべての教室
                    </button>
                    {displaySchools.map(school => (
                      <button
                        key={school.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSchoolChange(school.id);
                        }}
                        className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-50 transition-colors flex items-center gap-2 ${
                          selectedSchoolId === school.id ? 'bg-primary/10 text-primary font-semibold' : ''
                        }`}
                      >
                        <span>{school.code === 'DEFAULT' ? 'デフォルト' : school.name}</span>
                        {school.is_demo && (
                          <span className="ml-auto px-1.5 py-0.5 bg-gray-200 text-gray-500 text-[10px] rounded font-normal">
                            デモ
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
            {displaySchools.length === 1 && schoolDisplayName && (
              <div className="text-xs font-medium text-white/90 px-3 py-1.5 bg-white/20 rounded-lg max-w-[120px] truncate" title={schoolDisplayName}>
                {schoolDisplayName}
              </div>
            )}
            {isTeacher && badgeCount !== null && (
              <TierMedal count={badgeCount} />
            )}
            {profile && !authLoading && (
              <button
                onClick={signOut}
                className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded-lg transition-[color,background-color,transform] duration-150 ease-out active:scale-[0.97]"
                title="ログアウト"
              >
                <LogOut className="w-4 h-4" />
              </button>
            )}
            {profile && !authLoading && (
              <div className="relative settings-dropdown-container">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowSettingsDropdown(!showSettingsDropdown);
                  }}
                  className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded-lg transition-[color,background-color,transform] duration-150 ease-out active:scale-[0.97]"
                  title="設定"
                >
                  <Settings className="w-4 h-4" />
                </button>
                <div
                  className={`${dropdownPanelClass(showSettingsDropdown, 'right')} z-50 min-w-[200px]`}
                  onClick={(e) => e.stopPropagation()}
                  aria-hidden={!showSettingsDropdown}
                >
                  <div className="py-1">
                    {/* ユーザー情報 */}
                    {profile && !authLoading && (
                      <div className="px-3 py-2.5 border-b border-gray-100">
                        <div className="text-xs font-semibold text-gray-900 leading-tight">
                          {isTeacher ? getSurname(profile) || profile.email : profile.display_name || profile.email}
                        </div>
                        <div className="text-[10px] text-gray-500 leading-tight mt-0.5">
                          {USER_ROLE_LABELS[profile.role]}
                        </div>
                      </div>
                    )}
                    {/* ページ固有設定 */}
                    {onBulkGradeUpdateClick && (
                      <button
                        onClick={() => {
                          onBulkGradeUpdateClick();
                          setShowSettingsDropdown(false);
                        }}
                        className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 transition-colors duration-150"
                      >
                        一括学年更新
                      </button>
                    )}
                    {onSettingsClick && (
                      <button
                        onClick={() => {
                          onSettingsClick();
                          setShowSettingsDropdown(false);
                        }}
                        className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 transition-colors duration-150"
                      >
                        {settingsLabel ?? '設定'}
                      </button>
                    )}
                    <Link
                      href="/settings"
                      className={`block px-3 py-2 text-xs hover:bg-gray-50 transition-colors ${
                        pathname === '/settings'
                          ? 'bg-primary/10 text-primary font-semibold'
                          : 'text-text-heading'
                      }`}
                      onClick={() => setShowSettingsDropdown(false)}
                    >
                      すべての設定
                    </Link>
                    <div className="border-t border-border my-1" />
                    {/* 教室長ダッシュボード（admin のみ・試作。通常ナビにはまだ出さず、ここが唯一の入口） */}
                    {profile?.role === 'admin' && (
                      <>
                        <Link
                          href="/home-mock"
                          className="flex items-center gap-2 px-3 py-2 text-xs text-text-heading hover:bg-gray-50 transition-colors"
                          onClick={() => setShowSettingsDropdown(false)}
                        >
                          <LayoutDashboard className="w-3.5 h-3.5" aria-hidden />
                          教室長ダッシュボード（試作）
                        </Link>
                        <div className="border-t border-border my-1" />
                      </>
                    )}
                    {/* 問合せ管理（教室長以上・ベータ。ダッシュボードと同様ここを入口にする） */}
                    {(profile?.role === 'admin' || profile?.role === 'owner' || profile?.role === 'manager') && (
                      <>
                        <Link
                          href="/admin/inquiries"
                          className="flex items-center gap-2 px-3 py-2 text-xs text-text-heading hover:bg-gray-50 transition-colors"
                          onClick={() => setShowSettingsDropdown(false)}
                        >
                          <MessageSquare className="w-3.5 h-3.5" aria-hidden />
                          問合せ管理（ベータ）
                        </Link>
                        <div className="border-t border-border my-1" />
                      </>
                    )}
                    {/* テーマ切替 */}
                    <div className="px-3 py-2 flex items-center justify-between">
                      <span className="text-xs text-gray-600">テーマ</span>
                      <ThemeToggle />
                    </div>
                    {/* ヘルプ */}
                    <Link
                      href="/help"
                      className="block px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 transition-colors"
                      onClick={() => setShowSettingsDropdown(false)}
                    >
                      ヘルプ
                    </Link>
                    {/* プッシュ通知 */}
                    {!isTeacher && (
                      <div className="px-3 py-2 flex items-center justify-between">
                        <span className="text-xs text-gray-600">プッシュ通知</span>
                        {selectedSchoolId && selectedSchoolId !== 'all' ? (
                          <PushNotificationButton schoolId={selectedSchoolId} compact />
                        ) : schools.length > 0 ? (
                          <PushNotificationButton schoolId={schools[0].id} compact />
                        ) : null}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
            {/* 座席表：システム管理者のみ表示 */}
            {profile && String(profile.role ?? '').toLowerCase() === 'admin' && (
              <Link
                href="/schedule"
                className={`p-1.5 rounded-lg transition-[color,background-color,transform] duration-150 ease-out active:scale-[0.97] ${
                  pathname === '/schedule' || pathname?.startsWith('/schedule')
                    ? 'bg-white text-primary'
                    : 'text-white/80 hover:text-white hover:bg-white/10'
                }`}
                title="座席表（開発中）"
              >
                <LayoutDashboard className="w-4 h-4" aria-hidden />
              </Link>
            )}
          </div>
        </div>
        {/* モバイルメニュー（lg 未満で展開）
            max-height + opacity のinline transitionで折りたたみ。
            常時DOMに残すことでページ読み込み後の初回開閉もアニメートされる。
            globals.css の prefers-reduced-motion: transition-duration 0.01ms が自動で適用される。 */}
        <div
          className="lg:hidden overflow-hidden"
          style={{
            maxHeight: showMobileMenu ? '800px' : 0,
            opacity: showMobileMenu ? 1 : 0,
            transition: 'max-height 280ms cubic-bezier(0.23, 1, 0.32, 1), opacity 200ms cubic-bezier(0.23, 1, 0.32, 1)',
          }}
        >
          <nav
            id="mobile-nav"
            className="border-t border-white/20 py-2 space-y-0.5"
            aria-hidden={!showMobileMenu}
          >
            {[
              { href: '/students', label: '生徒管理', show: showAllLinks || permissions?.canAccessStudents },
              { href: '/applications', label: '申込状況', show: showAllLinks || permissions?.canAccessApplications },
              { href: '/responses', label: '回答一覧', show: showAllLinks || permissions?.canAccessPortal },
              { href: '/forms/responses', label: 'フォーム回答', show: showAllLinks || permissions?.canAccessPortal },
              { href: '/settings/portal', label: 'ポータル設定', show: showAllLinks || permissions?.canAccessPortal },
              { href: '/transcriptions', label: '面談記録追加', show: showAllLinks || permissions?.canAccessPortal },
              { href: '/progress-feed', label: '進行表確認', show: showAllLinks || (permissions?.canAccessStudents && profile?.role !== 'teacher') },
              { href: '/courses', label: '講習一覧', show: showAllLinks || permissions?.canAccessPortal },
              { href: '/courses/progress', label: '講習進行', show: showAllLinks || permissions?.canAccessPortal },
              { href: '/courses/schedule', label: '講習日程', show: showAllLinks || permissions?.canAccessPortal },
              { href: '/admin/teachers', label: '講師一覧', show: showAllLinks || permissions?.canAccessUsers },
              { href: '/billing', label: '請求管理', show: showAllLinks || permissions?.canAccessBilling },
              { href: '/ordering', label: '教材・発注管理', show: showAllLinks || permissions?.canAccessBilling },
              { href: '/tasks', label: '業務進捗', show: showAllLinks || permissions?.canAccessBilling },
            ]
              .filter((item) => item.show)
              .map((item) => {
                const active =
                  pathname === item.href ||
                  (item.href !== '/' && pathname?.startsWith(item.href + '/'));
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`block px-4 py-2 text-sm transition-[color,background-color,transform] duration-150 ease-out active:scale-[0.98] ${
                      active
                        ? 'bg-white text-primary font-semibold'
                        : 'text-white hover:bg-white/10'
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            {/* モバイル: テーマ切替・ヘルプ */}
            <div className="px-4 pt-2 mt-1 border-t border-white/20 flex items-center justify-between">
              <span className="text-[11px] text-white/70">テーマ</span>
              <ThemeToggle />
            </div>
            <Link
              href="/help"
              className="block px-4 py-2 text-sm text-white hover:bg-white/10 transition-colors"
            >
              ヘルプ
            </Link>
            {profile && (
              <div className="px-4 pt-2 mt-1 border-t border-white/20 text-[11px] text-white/80">
                <div className="font-semibold text-white">
                  {isTeacher ? getSurname(profile) || profile.email : profile.display_name || profile.email}
                </div>
                <div>{USER_ROLE_LABELS[profile.role]}</div>
              </div>
            )}
          </nav>
        </div>
        {/* 連絡掲示板未読アラート（講師のみ）
            slide-in-bar: globals.css で定義済み（@starting-style でフェードイン）*/}
        {bulletinUnreadCount > 0 && (
          <Link
            href="/students"
            className="slide-in-bar block py-2 px-4 bg-amber-400 text-amber-950 font-bold text-sm text-center hover:bg-amber-500 transition-colors duration-150"
          >
            <Megaphone className="inline h-4 w-4 mr-1" />連絡掲示板に未読が{bulletinUnreadCount}件あります
          </Link>
        )}
      </div>
    </header>
  );
}
