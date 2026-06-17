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
            {/* ハンバーガー（lg 未満で表示） */}
            <button
              type="button"
              onClick={() => setShowMobileMenu((v) => !v)}
              aria-expanded={showMobileMenu}
              aria-controls="mobile-nav"
              aria-label={showMobileMenu ? 'メニューを閉じる' : 'メニューを開く'}
              className="lg:hidden p-1.5 text-white hover:bg-white/10 rounded-lg transition-colors duration-150"
            >
              {showMobileMenu ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
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
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    pathname === '/students'
                      ? 'bg-white text-primary font-semibold'
                      : 'text-white/90 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  生徒管理
                </Link>
              )}
              {(showAllLinks || (permissions?.canAccessStudents && profile?.role !== 'teacher')) && (
                <Link
                  href="/progress-feed"
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    pathname === '/progress-feed'
                      ? 'bg-white text-primary font-semibold'
                      : 'text-white/90 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  進行表確認
                </Link>
              )}
              {(showAllLinks || permissions?.canAccessApplications) && (
                <Link
                  href="/applications"
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    pathname === '/applications'
                      ? 'bg-white text-primary font-semibold'
                      : 'text-white/90 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  申込状況
                </Link>
              )}
              {/* テスト対策（講師向けトップレベルリンク。教室長以上は講習管理ドロップダウン内に表示） */}
              {profile?.role === 'teacher' && (
                <Link
                  href="/test-prep-proposals"
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    pathname?.startsWith('/test-prep-proposals')
                      ? 'bg-white text-primary font-semibold'
                      : 'text-white/90 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  テスト対策
                </Link>
              )}
              {/* フォーム管理（教室長以上のみ） */}
              {(showAllLinks || permissions?.canAccessPortal) && (
                <div
                  className="relative form-dropdown-container"
                  onMouseEnter={() => handleNavEnter('form')}
                  onMouseLeave={() => handleNavLeave('form')}
                >
                  <button
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1 ${
                      pathname?.startsWith('/responses') ||
                      pathname?.startsWith('/forms/responses') ||
                      pathname === '/settings/portal' ||
                      pathname?.startsWith('/settings/portal') ||
                      pathname?.startsWith('/transcriptions') ||
                      pathname?.startsWith('/test-prep-proposals')
                        ? 'bg-white text-primary font-semibold'
                        : 'text-white/90 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                  フォーム管理
                  <ChevronDown className={`w-3 h-3 transition-[transform] duration-150 ease-out ${showFormDropdown ? 'rotate-180' : ''}`} />
                </button>
                {showFormDropdown && (
                <div
                  className="absolute top-full left-0 mt-1 bg-white rounded-lg border border-gray-200 shadow-xl z-50 min-w-[150px] dropdown-menu"
                >
                  <div className="py-1">
                    <Link
                      href="/responses"

                      className={`block px-3 py-2 text-xs hover:bg-gray-50 transition-colors ${
                        pathname?.startsWith('/responses') || pathname?.startsWith('/forms/responses')
                          ? 'bg-primary/10 text-primary font-semibold'
                          : ''
                      }`}
                    >
                      回答一覧
                    </Link>
                    <Link
                      href="/transcriptions"

                      className={`block px-3 py-2 text-xs hover:bg-gray-50 transition-colors ${
                        pathname?.startsWith('/transcriptions')
                          ? 'bg-primary/10 text-primary font-semibold'
                          : ''
                      }`}
                    >
                      面談記録追加
                    </Link>
                    {(showAllLinks || permissions?.canAccessPortal) && (
                      <Link
                        href="/settings/portal"

                        className={`block px-3 py-2 text-xs hover:bg-gray-50 transition-colors ${
                          pathname === '/settings/portal' || pathname?.startsWith('/settings/portal')
                            ? 'bg-primary/10 text-primary font-semibold'
                            : ''
                        }`}
                      >
                        ポータル設定
                      </Link>
                    )}
                    <Link
                      href="/test-prep-proposals"

                      className={`block px-3 py-2 text-xs hover:bg-gray-50 transition-colors ${
                        pathname?.startsWith('/test-prep-proposals')
                          ? 'bg-primary/10 text-primary font-semibold'
                          : ''
                      }`}
                    >
                      テスト対策
                    </Link>
                  </div>
                </div>
                )}
                </div>
              )}
              {(showAllLinks || permissions?.canAccessCourses) && (
                <div
                  className="relative course-dropdown-container"
                  onMouseEnter={() => handleNavEnter('course')}
                  onMouseLeave={() => handleNavLeave('course')}
                >
                  <button
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1 ${
                      pathname === '/courses' || pathname?.startsWith('/courses/')
                        ? 'bg-white text-primary font-semibold'
                        : 'text-white/90 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    講習管理
                    <ChevronDown className={`w-3 h-3 transition-[transform] duration-150 ease-out ${showCourseDropdown ? 'rotate-180' : ''}`} />
                  </button>
                  {showCourseDropdown && (
                    <div className="absolute top-full left-0 mt-1 bg-white rounded-lg border border-gray-200 shadow-xl z-50 min-w-[150px] dropdown-menu">
                      <div className="py-1">
                        <Link
                          href="/courses"
    
                          className={`block px-3 py-2 text-xs hover:bg-gray-50 transition-colors ${
                            pathname === '/courses' && !pathname?.startsWith('/courses/')
                              ? 'bg-primary/10 text-primary font-semibold'
                              : ''
                          }`}
                        >
                          講習一覧
                        </Link>
                        <Link
                          href="/courses/progress"
    
                          className={`block px-3 py-2 text-xs hover:bg-gray-50 transition-colors ${
                            pathname?.startsWith('/courses/progress')
                              ? 'bg-primary/10 text-primary font-semibold'
                              : ''
                          }`}
                        >
                          進捗管理
                        </Link>
                        <Link
                          href="/courses/schedule"
    
                          className={`block px-3 py-2 text-xs hover:bg-gray-50 transition-colors ${
                            pathname?.startsWith('/courses/schedule')
                              ? 'bg-primary/10 text-primary font-semibold'
                              : ''
                          }`}
                        >
                          準備スケジュール
                        </Link>
                        <Link
                          href="/courses/proposals"

                          className={`block px-3 py-2 text-xs hover:bg-gray-50 transition-colors ${
                            pathname?.startsWith('/courses/proposals')
                              ? 'bg-primary/10 text-primary font-semibold'
                              : ''
                          }`}
                        >
                          講習提案書
                        </Link>
                      </div>
                    </div>
                  )}
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
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1 ${
                      pathname?.startsWith('/admin/teachers') ||
                      pathname?.startsWith('/admin/attendance') ||
                      pathname?.startsWith('/admin/teacher-badges') ||
                      pathname === '/settings/seasonal-shifts' ||
                      pathname?.startsWith('/settings/seasonal-shifts')
                        ? 'bg-white text-primary font-semibold'
                        : 'text-white/90 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    講師
                    <ChevronDown className={`w-3 h-3 transition-[transform] duration-150 ease-out ${showTeacherDropdown ? 'rotate-180' : ''}`} />
                  </button>
                  {showTeacherDropdown && (
                  <div
                    className="absolute top-full left-0 mt-1 bg-white rounded-lg border border-gray-200 shadow-xl z-50 min-w-[180px] dropdown-menu"
                  >
                    <div className="py-1">
                      <Link
                        href="/admin/teachers"
                        className={`block px-3 py-2 text-xs hover:bg-gray-50 transition-colors ${
                          pathname === '/admin/teachers' || pathname?.startsWith('/admin/teachers')
                            ? 'bg-primary/10 text-primary font-semibold'
                            : ''
                        }`}
                      >
                        講師一覧
                      </Link>
                      <Link
                        href="/admin/attendance"
                        className={`block px-3 py-2 text-xs hover:bg-gray-50 transition-colors ${
                          pathname === '/admin/attendance' ||
                          pathname?.startsWith('/admin/attendance/')
                            ? 'bg-primary/10 text-primary font-semibold'
                            : ''
                        }`}
                      >
                        出勤簿管理
                      </Link>
                      <Link
                        href="/settings/seasonal-shifts"
                        className={`block px-3 py-2 text-xs hover:bg-gray-50 transition-colors ${
                          pathname === '/settings/seasonal-shifts' || pathname?.startsWith('/settings/seasonal-shifts')
                            ? 'bg-primary/10 text-primary font-semibold'
                            : ''
                        }`}
                      >
                        シフト設定
                      </Link>
                      <Link
                        href="/admin/teacher-badges"
                        className={`block px-3 py-2 text-xs hover:bg-gray-50 transition-colors ${
                          pathname === '/admin/teacher-badges' || pathname?.startsWith('/admin/teacher-badges')
                            ? 'bg-primary/10 text-primary font-semibold'
                            : ''
                        }`}
                      >
                        研修バッジ管理
                      </Link>
                    </div>
                  </div>
                  )}
                </div>
              ) : (
                /* 講師は自分の出勤簿へのリンク（マイトロフィーは右上のバッジメダルから） */
                <>
                  {schools.length > 0 && schools[0]?.code && profile?.id && (
                    <Link
                      href={`/attendance/${schools[0].code}/${profile.id}`}
                      className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                        pathname?.startsWith('/attendance/')
                          ? 'bg-white text-primary font-semibold'
                          : 'text-white/90 hover:bg-white/10 hover:text-white'
                      }`}
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
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1 ${
                      pathname?.startsWith('/billing') ||
                      pathname?.startsWith('/ordering') ||
                      pathname?.startsWith('/inventory') ||
                      pathname?.startsWith('/tasks')
                        ? 'bg-white text-primary font-semibold'
                        : 'text-white/90 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    業務管理
                    <ChevronDown className={`w-3 h-3 transition-[transform] duration-150 ease-out ${showBusinessDropdown ? 'rotate-180' : ''}`} />
                  </button>
                  {showBusinessDropdown && (
                  <div
                    className="absolute top-full left-0 mt-1 bg-white rounded-lg border border-gray-200 shadow-xl z-[9999] min-w-[150px] dropdown-menu"
                  >
                    <div className="py-1">
                      <Link
                        href="/billing"
  
                        className={`block px-3 py-2 text-xs hover:bg-gray-50 transition-colors ${
                          pathname?.startsWith('/billing')
                            ? 'bg-primary/10 text-primary font-semibold'
                            : ''
                        }`}
                      >
                        請求管理
                      </Link>
                      <Link
                        href="/ordering"
  
                        className={`block px-3 py-2 text-xs hover:bg-gray-50 transition-colors ${
                          pathname?.startsWith('/ordering') || pathname?.startsWith('/inventory')
                            ? 'bg-primary/10 text-primary font-semibold'
                            : ''
                        }`}
                      >
                        教材・発注管理
                      </Link>
                      <Link
                        href="/tasks"
  
                        className={`block px-3 py-2 text-xs hover:bg-gray-50 transition-colors ${
                          pathname?.startsWith('/tasks')
                            ? 'bg-primary/10 text-primary font-semibold'
                            : ''
                        }`}
                      >
                        業務進捗管理表
                      </Link>
                    </div>
                  </div>
                  )}
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
                  className="text-white px-2.5 py-1.5 bg-white/20 rounded-lg hover:bg-white/30 transition-colors flex items-center gap-1 text-xs font-medium shrink-0 whitespace-nowrap max-w-[110px] sm:max-w-none"
                >
                  <span className="truncate">{schoolDisplayName}</span>
                  <ChevronDown className={`w-3 h-3 transition-[transform] duration-150 ease-out ${showSchoolDropdown ? 'rotate-180' : ''}`} />
                </button>
                {showSchoolDropdown && (
                  <div
                    className="absolute right-0 mt-1 bg-white rounded-lg border border-gray-200 shadow-xl ring-1 ring-black/5 z-50 min-w-[200px] dropdown-menu dropdown-menu-right"
                    onClick={(e) => e.stopPropagation()}
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
                )}
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
                className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded-lg transition-colors duration-150"
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
                  className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded-lg transition-colors duration-150"
                  title="設定"
                >
                  <Settings className="w-4 h-4" />
                </button>
                {showSettingsDropdown && (
                  <div
                    className="absolute right-0 mt-1 bg-white rounded-lg border border-gray-200 shadow-xl z-50 min-w-[200px] dropdown-menu dropdown-menu-right"
                    onClick={(e) => e.stopPropagation()}
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
                      {/* 問合せ管理（admin / owner のみ・ベータ。ダッシュボードと同様ここを入口にする） */}
                      {(profile?.role === 'admin' || profile?.role === 'owner') && (
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
                )}
              </div>
            )}
            {/* 座席表：システム管理者のみ表示 */}
            {profile && String(profile.role ?? '').toLowerCase() === 'admin' && (
              <Link
                href="/schedule"
                className={`p-1.5 rounded-lg transition-colors ${
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
        {/* モバイルメニュー（lg 未満で展開） */}
        {showMobileMenu && (
          <nav
            id="mobile-nav"
            className="lg:hidden border-t border-white/20 py-2 space-y-0.5"
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
                    className={`block px-4 py-2 text-sm transition-colors ${
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
        )}
        {/* 連絡掲示板未読アラート（講師のみ） */}
        {bulletinUnreadCount > 0 && (
          <Link
            href="/students"
            className="block py-2 px-4 bg-amber-400 text-amber-950 font-bold text-sm text-center hover:bg-amber-500 transition-colors duration-150"
          >
            <Megaphone className="inline h-4 w-4 mr-1" />連絡掲示板に未読が{bulletinUnreadCount}件あります
          </Link>
        )}
      </div>
    </header>
  );
}
