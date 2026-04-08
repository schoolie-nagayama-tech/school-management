'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { getUnreadCount } from '@/lib/api/bulletin';
import { useAuth } from '@/contexts/AuthContext';
import { useMasterData } from '@/contexts/MasterDataContext';
import { USER_ROLE_LABELS } from '@/types/database';
import { SubjectSettings } from '@/components/settings';

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
  const [isSubjectSettingsOpen, setIsSubjectSettingsOpen] = useState(false);
  const [bulletinUnreadCount, setBulletinUnreadCount] = useState(0);
  const [showFormDropdown, setShowFormDropdown] = useState(false);
  const [showCourseDropdown, setShowCourseDropdown] = useState(false);
  const [showTeacherDropdown, setShowTeacherDropdown] = useState(false);
  const [showBusinessDropdown, setShowBusinessDropdown] = useState(false);

  // permissionsがnullの場合は、すべてのリンクを表示（ローディング中の場合）
  const showAllLinks = !permissions || authLoading;

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

  // クリック外でドロップダウンを閉じる
  useEffect(() => {
    if (!showSchoolDropdown && !showSettingsDropdown && !showBusinessDropdown && !showFormDropdown && !showCourseDropdown && !showTeacherDropdown) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (showSchoolDropdown && !target.closest('.school-dropdown-container')) {
        setShowSchoolDropdown(false);
      }
      if (showSettingsDropdown && !target.closest('.settings-dropdown-container')) {
        setShowSettingsDropdown(false);
      }
      if (showBusinessDropdown && !target.closest('.business-dropdown-container')) {
        setShowBusinessDropdown(false);
      }
      if (showFormDropdown && !target.closest('.form-dropdown-container')) {
        setShowFormDropdown(false);
      }
      if (showCourseDropdown && !target.closest('.course-dropdown-container')) {
        setShowCourseDropdown(false);
      }
      if (showTeacherDropdown && !target.closest('.teacher-dropdown-container')) {
        setShowTeacherDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showSchoolDropdown, showSettingsDropdown, showBusinessDropdown, showFormDropdown, showCourseDropdown, showTeacherDropdown]);

  return (
    <header className="bg-[#d32f2f] shadow-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">
          <div className="flex items-center gap-4">
            {/* NESTロゴ */}
            <Link href="/students" className="shrink-0">
              <span className="text-white font-black text-2xl tracking-[0.4em] pr-[0.4em] select-none">
                NEST
              </span>
            </Link>
            <div className="h-6 w-px bg-white/30"></div>
            <nav className="flex items-center gap-3">
              {(showAllLinks || permissions?.canAccessStudents) && (
                <Link
                  href="/students"
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    pathname === '/students'
                      ? 'bg-white text-[#d32f2f] font-semibold'
                      : 'text-white/90 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  生徒管理
                </Link>
              )}
              {(showAllLinks || permissions?.canAccessApplications) && (
                <Link
                  href="/applications"
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    pathname === '/applications'
                      ? 'bg-white text-[#d32f2f] font-semibold'
                      : 'text-white/90 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  申込状況
                </Link>
              )}
              {/* フォーム管理（教室長以上のみ） */}
              {(showAllLinks || permissions?.canAccessPortal) && (
                <div className="relative form-dropdown-container">
                  <button
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1 ${
                      pathname?.startsWith('/responses') ||
                      pathname?.startsWith('/forms/responses') ||
                      pathname === '/settings/portal' ||
                      pathname?.startsWith('/settings/portal')
                        ? 'bg-white text-[#d32f2f] font-semibold'
                        : 'text-white/90 hover:bg-white/10 hover:text-white'
                    }`}
                    onClick={() => setShowFormDropdown(!showFormDropdown)}
                                      >
                  フォーム管理
                  <svg
                    className={`w-3 h-3 transition-transform ${showFormDropdown ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {showFormDropdown && (
                <div
                  className="absolute top-full left-0 mt-1 bg-white rounded-lg border border-gray-200 shadow-xl z-50 min-w-[150px]"
                >
                  <div className="py-1">
                    <Link
                      href="/responses"
                      onClick={() => setShowFormDropdown(false)}
                      className={`block px-3 py-2 text-xs hover:bg-gray-50 transition-colors ${
                        pathname?.startsWith('/responses') || pathname?.startsWith('/forms/responses')
                          ? 'bg-[#d32f2f]/10 text-[#d32f2f] font-semibold'
                          : ''
                      }`}
                    >
                      回答一覧
                    </Link>
                    {(showAllLinks || permissions?.canAccessPortal) && (
                      <Link
                        href="/settings/portal"
                        onClick={() => setShowFormDropdown(false)}
                        className={`block px-3 py-2 text-xs hover:bg-gray-50 transition-colors ${
                          pathname === '/settings/portal' || pathname?.startsWith('/settings/portal')
                            ? 'bg-[#d32f2f]/10 text-[#d32f2f] font-semibold'
                            : ''
                        }`}
                      >
                        ポータル設定
                      </Link>
                    )}
                  </div>
                </div>
                )}
                </div>
              )}
              {(showAllLinks || permissions?.canAccessCourses) && (
                <div className="relative course-dropdown-container">
                  <button
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1 ${
                      pathname === '/courses' || pathname?.startsWith('/courses/')
                        ? 'bg-white text-[#d32f2f] font-semibold'
                        : 'text-white/90 hover:bg-white/10 hover:text-white'
                    }`}
                    onClick={() => setShowCourseDropdown(!showCourseDropdown)}
                  >
                    講習管理
                    <svg
                      className={`w-3 h-3 transition-transform ${showCourseDropdown ? 'rotate-180' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {showCourseDropdown && (
                    <div className="absolute top-full left-0 mt-1 bg-white rounded-lg border border-gray-200 shadow-xl z-50 min-w-[150px]">
                      <div className="py-1">
                        <Link
                          href="/courses"
                          onClick={() => setShowCourseDropdown(false)}
                          className={`block px-3 py-2 text-xs hover:bg-gray-50 transition-colors ${
                            pathname === '/courses' && !pathname?.startsWith('/courses/')
                              ? 'bg-[#d32f2f]/10 text-[#d32f2f] font-semibold'
                              : ''
                          }`}
                        >
                          講習一覧
                        </Link>
                        <Link
                          href="/courses/progress"
                          onClick={() => setShowCourseDropdown(false)}
                          className={`block px-3 py-2 text-xs hover:bg-gray-50 transition-colors ${
                            pathname?.startsWith('/courses/progress')
                              ? 'bg-[#d32f2f]/10 text-[#d32f2f] font-semibold'
                              : ''
                          }`}
                        >
                          進捗管理
                        </Link>
                        <Link
                          href="/courses/schedule"
                          onClick={() => setShowCourseDropdown(false)}
                          className={`block px-3 py-2 text-xs hover:bg-gray-50 transition-colors ${
                            pathname?.startsWith('/courses/schedule')
                              ? 'bg-[#d32f2f]/10 text-[#d32f2f] font-semibold'
                              : ''
                          }`}
                        >
                          準備スケジュール
                        </Link>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {/* 講師メニュー（教室長以上のみ） */}
              {!profile || profile.role !== 'teacher' ? (
                <div className="relative teacher-dropdown-container">
                  <button
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1 ${
                      pathname?.startsWith('/admin/teachers') ||
                      pathname?.startsWith('/admin/attendance') ||
                      pathname === '/settings/seasonal-shifts' ||
                      pathname?.startsWith('/settings/seasonal-shifts')
                        ? 'bg-white text-[#d32f2f] font-semibold'
                        : 'text-white/90 hover:bg-white/10 hover:text-white'
                    }`}
                    onClick={() => setShowTeacherDropdown(!showTeacherDropdown)}
                                      >
                    講師
                    <svg
                      className={`w-3 h-3 transition-transform ${showTeacherDropdown ? 'rotate-180' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {showTeacherDropdown && (
                  <div
                    className="absolute top-full left-0 mt-1 bg-white rounded-lg border border-gray-200 shadow-xl z-50 min-w-[180px]"
                  >
                    <div className="py-1">
                      <Link
                        href="/admin/teachers"
                        className={`block px-3 py-2 text-xs hover:bg-gray-50 transition-colors ${
                          pathname === '/admin/teachers' || pathname?.startsWith('/admin/teachers')
                            ? 'bg-[#d32f2f]/10 text-[#d32f2f] font-semibold'
                            : ''
                        }`}
                      >
                        講師一覧
                      </Link>
                      <Link
                        href="/admin/attendance"
                        className={`block px-3 py-2 text-xs hover:bg-gray-50 transition-colors ${
                          pathname === '/admin/attendance' ||
                          (pathname?.startsWith('/admin/attendance/') && !pathname.startsWith('/admin/attendance/late-early'))
                            ? 'bg-[#d32f2f]/10 text-[#d32f2f] font-semibold'
                            : ''
                        }`}
                      >
                        出勤簿管理
                      </Link>
                      <Link
                        href="/admin/attendance/late-early"
                        className={`block px-3 py-2 text-xs hover:bg-gray-50 transition-colors ${
                          pathname === '/admin/attendance/late-early'
                            ? 'bg-[#d32f2f]/10 text-[#d32f2f] font-semibold'
                            : ''
                        }`}
                      >
                        遅刻・早退一覧
                      </Link>
                      <Link
                        href="/settings/seasonal-shifts"
                        className={`block px-3 py-2 text-xs hover:bg-gray-50 transition-colors ${
                          pathname === '/settings/seasonal-shifts' || pathname?.startsWith('/settings/seasonal-shifts')
                            ? 'bg-[#d32f2f]/10 text-[#d32f2f] font-semibold'
                            : ''
                        }`}
                      >
                        シフト設定
                      </Link>
                    </div>
                  </div>
                  )}
                </div>
              ) : (
                /* 講師は自分の出勤簿へのリンクのみ */
                schools.length > 0 && schools[0]?.code && profile?.id && (
                  <Link
                    href={`/attendance/${schools[0].code}/${profile.id}`}
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                      pathname?.startsWith('/attendance/')
                        ? 'bg-white text-[#d32f2f] font-semibold'
                        : 'text-white/90 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    出勤簿
                  </Link>
                )
              )}
              {/* 業務管理（教室長以上のみ） */}
              {(showAllLinks || permissions?.canAccessBilling) && (
                <div className="relative business-dropdown-container">
                  <button
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1 ${
                      pathname?.startsWith('/billing') ||
                      pathname?.startsWith('/ordering') ||
                      pathname?.startsWith('/inventory') ||
                      pathname?.startsWith('/tasks')
                        ? 'bg-white text-[#d32f2f] font-semibold'
                        : 'text-white/90 hover:bg-white/10 hover:text-white'
                    }`}
                    onClick={() => setShowBusinessDropdown(!showBusinessDropdown)}
                                      >
                    業務管理
                    <svg
                      className={`w-3 h-3 transition-transform ${showBusinessDropdown ? 'rotate-180' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {showBusinessDropdown && (
                  <div
                    className="absolute top-full left-0 mt-1 bg-white rounded-lg border border-gray-200 shadow-xl z-[9999] min-w-[150px]"
                  >
                    <div className="py-1">
                      <Link
                        href="/billing"
                        onClick={() => setShowBusinessDropdown(false)}
                        className={`block px-3 py-2 text-xs hover:bg-gray-50 transition-colors ${
                          pathname?.startsWith('/billing')
                            ? 'bg-[#d32f2f]/10 text-[#d32f2f] font-semibold'
                            : ''
                        }`}
                      >
                        請求管理
                      </Link>
                      <Link
                        href="/ordering"
                        onClick={() => setShowBusinessDropdown(false)}
                        className={`block px-3 py-2 text-xs hover:bg-gray-50 transition-colors ${
                          pathname?.startsWith('/ordering') || pathname?.startsWith('/inventory')
                            ? 'bg-[#d32f2f]/10 text-[#d32f2f] font-semibold'
                            : ''
                        }`}
                      >
                        教材・発注管理
                      </Link>
                      <Link
                        href="/tasks"
                        onClick={() => setShowBusinessDropdown(false)}
                        className={`block px-3 py-2 text-xs hover:bg-gray-50 transition-colors ${
                          pathname?.startsWith('/tasks')
                            ? 'bg-[#d32f2f]/10 text-[#d32f2f] font-semibold'
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
          <div className="flex items-center gap-3">
            {displaySchools.length > 1 && schoolDisplayName && (
              <div className="relative school-dropdown-container">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowSchoolDropdown(!showSchoolDropdown);
                  }}
                  className="text-white px-3 py-1.5 bg-white/20 rounded-lg hover:bg-white/30 transition-colors flex items-center gap-1 text-xs font-medium"
                >
                  <span>{schoolDisplayName}</span>
                  <svg
                    className={`w-3 h-3 transition-transform ${showSchoolDropdown ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {showSchoolDropdown && (
                  <div
                    className="absolute right-0 mt-1 bg-white rounded-lg border border-gray-200 shadow-xl ring-1 ring-black/5 z-50 min-w-[200px]"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="py-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSchoolChange('all');
                        }}
                        className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-50 transition-colors ${
                          selectedSchoolId === 'all' ? 'bg-[#d32f2f]/10 text-[#d32f2f] font-semibold' : ''
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
                            selectedSchoolId === school.id ? 'bg-[#d32f2f]/10 text-[#d32f2f] font-semibold' : ''
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
              <div className="text-xs font-medium text-gray-700 px-3 py-1.5 bg-gray-100 rounded-lg">
                {schoolDisplayName}
              </div>
            )}
            {profile && !authLoading && (
              <div className="flex items-center gap-2 text-right">
                <div>
                  <div className="text-xs font-semibold text-white leading-tight">
                    {profile.display_name || profile.email}
                  </div>
                  <div className="text-[10px] text-white/70 leading-tight">
                    {USER_ROLE_LABELS[profile.role]}
                  </div>
                </div>
              </div>
            )}
            <Link
              href="/help"
              className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
              title="ヘルプ"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </Link>
            {profile && !authLoading && (
              <button
                onClick={signOut}
                className="p-1 text-[10px] font-medium bg-white/20 text-white border border-white/30 rounded hover:bg-white/30 transition-colors flex items-center gap-0.5"
                title="ログアウト"
              >
                <svg
                  className="w-2.5 h-2.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                  />
                </svg>
                <span className="hidden sm:inline">ログアウト</span>
              </button>
            )}
            {(showAllLinks || permissions?.canAccessStudents || permissions?.canAccessSettings || profile?.role === 'admin') && (
              <div className="relative settings-dropdown-container">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowSettingsDropdown(!showSettingsDropdown);
                  }}
                  className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                  title="設定"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                  </svg>
                </button>
                {showSettingsDropdown && (
                  <div
                    className="absolute right-0 mt-1 bg-white rounded-lg border border-gray-200 shadow-xl z-50 min-w-[160px]"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="py-1">
                      <Link
                        href="/settings"
                        className={`block px-3 py-2 text-xs font-medium hover:bg-gray-50 transition-colors ${
                          pathname === '/settings'
                            ? 'bg-[#d32f2f]/10 text-[#d32f2f] font-semibold'
                            : 'text-[#1f2937]'
                        }`}
                        onClick={() => setShowSettingsDropdown(false)}
                      >
                        すべての設定
                      </Link>
                      <div className="border-t border-[#e5e7eb] my-1" />
                      {onBulkGradeUpdateClick && (
                        <button
                          onClick={() => {
                            onBulkGradeUpdateClick();
                            setShowSettingsDropdown(false);
                          }}
                          className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 transition-colors"
                        >
                          一括学年更新
                        </button>
                      )}
                      {(showAllLinks || permissions?.canAccessStudents) && (
                        <button
                          onClick={() => {
                            setIsSubjectSettingsOpen(true);
                            setShowSettingsDropdown(false);
                          }}
                          className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 transition-colors"
                        >
                          科目設定
                        </button>
                      )}
                      {onSettingsClick && (
                        <button
                          onClick={() => {
                            onSettingsClick();
                            setShowSettingsDropdown(false);
                          }}
                          className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 transition-colors"
                        >
                          {settingsLabel ?? '設定'}
                        </button>
                      )}
                      <div className="border-t border-[#e5e7eb] my-1" />
                      {(showAllLinks || permissions?.canAccessUsers) && (
                        <Link
                          href="/users"
                          className={`block px-3 py-2 text-xs hover:bg-gray-50 transition-colors ${
                            pathname === '/users' || pathname?.startsWith('/users/')
                              ? 'bg-[#d32f2f]/10 text-[#d32f2f] font-semibold'
                              : ''
                          }`}
                          onClick={() => setShowSettingsDropdown(false)}
                        >
                          ユーザー管理
                        </Link>
                      )}
                      {(showAllLinks || permissions?.canAccessSettings) && (
                        <Link
                          href="/admin/settings/attendance-types"
                          className={`block px-3 py-2 text-xs hover:bg-gray-50 transition-colors ${
                            pathname?.startsWith('/admin/settings/attendance-types')
                              ? 'bg-[#d32f2f]/10 text-[#d32f2f] font-semibold'
                              : ''
                          }`}
                          onClick={() => setShowSettingsDropdown(false)}
                        >
                          コマ種別設定
                        </Link>
                      )}
                      {profile?.role === 'admin' && (
                        <Link
                          href="/admin/settings/security"
                          className={`block px-3 py-2 text-xs hover:bg-gray-50 transition-colors ${
                            pathname === '/admin/settings/security' || pathname?.startsWith('/admin/settings/security')
                              ? 'bg-[#d32f2f]/10 text-[#d32f2f] font-semibold'
                              : ''
                          }`}
                          onClick={() => setShowSettingsDropdown(false)}
                        >
                          セキュリティ設定
                        </Link>
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
                    ? 'bg-white text-[#d32f2f]'
                    : 'text-white/80 hover:text-white hover:bg-white/10'
                }`}
                title="座席表（開発中）"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
                </svg>
              </Link>
            )}
          </div>
        </div>
        {/* 連絡掲示板未読アラート（講師のみ） */}
        {bulletinUnreadCount > 0 && (
          <Link
            href="/students"
            className="block py-2 px-4 bg-amber-400 text-amber-950 font-bold text-sm text-center hover:bg-amber-500 transition-colors"
          >
            📢 連絡掲示板に未読が{bulletinUnreadCount}件あります
          </Link>
        )}
      </div>
      {/* 科目設定モーダル（AppHeader内で一元管理） */}
      <SubjectSettings
        isOpen={isSubjectSettingsOpen}
        onClose={() => setIsSubjectSettingsOpen(false)}
      />
    </header>
  );
}
