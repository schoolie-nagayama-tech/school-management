'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { getSchools } from '@/lib/api/schools';
import { getUnreadCount } from '@/lib/api/bulletin';
import { useAuth } from '@/contexts/AuthContext';
import { USER_ROLE_LABELS } from '@/types/database';
import type { School } from '@/types/database';

interface AppHeaderProps {
  title: string;
  onSettingsClick?: () => void;
}

export function AppHeader({ title, onSettingsClick }: AppHeaderProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { profile, permissions, signOut, isLoading: authLoading, schoolIds, selectedSchoolId, setSelectedSchoolId, getSelectedSchoolIds } = useAuth();

  const handleSchoolChange = (schoolId: string | 'all') => {
    setSelectedSchoolId(schoolId);
    setShowSchoolDropdown(false);
    router.refresh();
  };
  const [schools, setSchools] = useState<School[]>([]);
  const [showSchoolDropdown, setShowSchoolDropdown] = useState(false);
  const [showSettingsDropdown, setShowSettingsDropdown] = useState(false);
  const [bulletinUnreadCount, setBulletinUnreadCount] = useState(0);

  // permissionsがnullの場合は、すべてのリンクを表示（ローディング中の場合）
  const showAllLinks = !permissions || authLoading;

  useEffect(() => {
    const fetchSchools = async () => {
      try {
        const allSchools = await getSchools();
        // ユーザーが担当している教室のみをフィルタ
        const userSchools = allSchools.filter(school => schoolIds.includes(school.id));
        setSchools(userSchools);
      } catch (error) {
        console.error('Error fetching schools:', error);
        // エラーが発生してもアプリは動作し続ける
      }
    };

    if (schoolIds.length > 0) {
      fetchSchools();
    }
  }, [schoolIds]);

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
        let total = 0;
        for (const schoolId of schoolIdsList) {
          total += await getUnreadCount(schoolId, profile.id);
        }
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
          let total = 0;
          for (const schoolId of schoolIdsList) {
            total += await getUnreadCount(schoolId, profile!.id);
          }
          setBulletinUnreadCount(total);
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
    if (!showSchoolDropdown && !showSettingsDropdown) return;
    
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.school-dropdown-container')) {
        setShowSchoolDropdown(false);
      }
      if (!target.closest('.settings-dropdown-container')) {
        setShowSettingsDropdown(false);
      }
    };
    
    setTimeout(() => {
      document.addEventListener('click', handleClickOutside);
    }, 0);
    
    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  }, [showSchoolDropdown, showSettingsDropdown]);

  return (
    <header className="bg-[#d32f2f] shadow-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">
          <div className="flex items-center gap-4">
            {/* ホームリンク */}
            <Link
              href="/students"
              className="flex items-center gap-2 text-white/90 hover:text-white transition-colors"
              title="ホームに戻る"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
                />
              </svg>
            </Link>
            <div className="h-6 w-px bg-white/30"></div>
            <h1 className="text-base font-bold text-white">{title}</h1>
            <nav className="flex items-center gap-3 ml-2">
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
                <div className="relative">
                  <button
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1 ${
                      pathname?.startsWith('/responses') || 
                      pathname?.startsWith('/forms/responses') ||
                      pathname === '/settings/portal' ||
                      pathname?.startsWith('/settings/portal')
                        ? 'bg-white text-[#d32f2f] font-semibold'
                        : 'text-white/90 hover:bg-white/10 hover:text-white'
                    }`}
                  onMouseEnter={(e) => {
                    const container = e.currentTarget.closest('.relative');
                    const dropdown = container?.querySelector('.form-management-dropdown') as HTMLElement;
                    if (dropdown) {
                      dropdown.style.opacity = '1';
                      dropdown.style.visibility = 'visible';
                    }
                  }}
                  onMouseLeave={(e) => {
                    const container = e.currentTarget.closest('.relative');
                    const dropdown = container?.querySelector('.form-management-dropdown') as HTMLElement;
                    if (dropdown) {
                      dropdown.style.opacity = '0';
                      dropdown.style.visibility = 'hidden';
                    }
                  }}
                >
                  フォーム管理
                  <svg
                    className="w-3 h-3"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                <div 
                  className="form-management-dropdown absolute top-full left-0 mt-1 bg-white rounded-lg border border-gray-200 shadow-xl z-50 min-w-[150px] opacity-0 invisible transition-all"
                  onMouseEnter={(e) => {
                    e.currentTarget.style.opacity = '1';
                    e.currentTarget.style.visibility = 'visible';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.opacity = '0';
                    e.currentTarget.style.visibility = 'hidden';
                  }}
                >
                  <div className="py-1">
                    <Link
                      href="/responses"
                      className={`block px-3 py-2 text-xs hover:bg-gray-50 transition-colors ${
                        pathname?.startsWith('/responses') || pathname?.startsWith('/forms/responses')
                          ? 'bg-[#d32f2f]/10 text-[#d32f2f] font-semibold'
                          : ''
                      }`}
                    >
                      回答
                    </Link>
                    {(showAllLinks || permissions?.canAccessPortal) && (
                      <Link
                        href="/settings/portal"
                        className={`block px-3 py-2 text-xs hover:bg-gray-50 transition-colors ${
                          pathname === '/settings/portal' || pathname?.startsWith('/settings/portal')
                            ? 'bg-[#d32f2f]/10 text-[#d32f2f] font-semibold'
                            : ''
                        }`}
                      >
                        フォーム設定
                      </Link>
                    )}
                  </div>
                </div>
                </div>
              )}
              {(showAllLinks || permissions?.canAccessCourses) && (
                <Link
                  href="/courses"
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    pathname === '/courses' || pathname?.startsWith('/courses/')
                      ? 'bg-white text-[#d32f2f] font-semibold'
                      : 'text-white/90 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  講習管理
                </Link>
              )}
              {/* 講師メニュー（教室長以上のみ） */}
              {!profile || profile.role !== 'teacher' ? (
                <div className="relative">
                  <button
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1 ${
                      pathname?.startsWith('/admin/settings/attendance-types') ||
                      pathname?.startsWith('/admin/teachers') ||
                      pathname?.startsWith('/admin/attendance') ||
                      pathname === '/settings/seasonal-shifts' ||
                      pathname?.startsWith('/settings/seasonal-shifts')
                        ? 'bg-white text-[#d32f2f] font-semibold'
                        : 'text-white/90 hover:bg-white/10 hover:text-white'
                    }`}
                    onMouseEnter={(e) => {
                      const container = e.currentTarget.closest('.relative');
                      const dropdown = container?.querySelector('.teacher-dropdown') as HTMLElement;
                      if (dropdown) {
                        dropdown.style.opacity = '1';
                        dropdown.style.visibility = 'visible';
                      }
                    }}
                    onMouseLeave={(e) => {
                      const container = e.currentTarget.closest('.relative');
                      const dropdown = container?.querySelector('.teacher-dropdown') as HTMLElement;
                      if (dropdown) {
                        dropdown.style.opacity = '0';
                        dropdown.style.visibility = 'hidden';
                      }
                    }}
                  >
                    講師
                    <svg
                      className="w-3 h-3"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  <div 
                    className="teacher-dropdown absolute top-full left-0 mt-1 bg-white rounded-lg border border-gray-200 shadow-xl z-50 min-w-[180px] opacity-0 invisible transition-all"
                    onMouseEnter={(e) => {
                      e.currentTarget.style.opacity = '1';
                      e.currentTarget.style.visibility = 'visible';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.opacity = '0';
                      e.currentTarget.style.visibility = 'hidden';
                    }}
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
                          pathname === '/admin/attendance' || pathname?.startsWith('/admin/attendance')
                            ? 'bg-[#d32f2f]/10 text-[#d32f2f] font-semibold'
                            : ''
                        }`}
                      >
                        出勤簿管理
                      </Link>
                      <Link
                        href="/admin/attendance/summary"
                        className={`block px-3 py-2 text-xs hover:bg-gray-50 transition-colors ${
                          pathname === '/admin/attendance/summary'
                            ? 'bg-[#d32f2f]/10 text-[#d32f2f] font-semibold'
                            : ''
                        }`}
                      >
                        月次集計
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
                        href="/admin/settings/attendance-types"
                        className={`block px-3 py-2 text-xs hover:bg-gray-50 transition-colors ${
                          pathname === '/admin/settings/attendance-types' || pathname?.startsWith('/admin/settings/attendance-types')
                            ? 'bg-[#d32f2f]/10 text-[#d32f2f] font-semibold'
                            : ''
                        }`}
                      >
                        コマ種別設定
                      </Link>
                      <Link
                        href="/settings/seasonal-shifts"
                        className={`block px-3 py-2 text-xs hover:bg-gray-50 transition-colors ${
                          pathname === '/settings/seasonal-shifts' || pathname?.startsWith('/settings/seasonal-shifts')
                            ? 'bg-[#d32f2f]/10 text-[#d32f2f] font-semibold'
                            : ''
                        }`}
                      >
                        講習シフト設定
                      </Link>
                    </div>
                  </div>
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
              {(showAllLinks || permissions?.canAccessUsers) && (
                <Link
                  href="/users"
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    pathname === '/users' || pathname?.startsWith('/users/')
                      ? 'bg-white text-[#d32f2f] font-semibold'
                      : 'text-white/90 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  ユーザー管理
                </Link>
              )}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            {schools.length > 1 && schoolDisplayName && (
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
                      {schools.map(school => (
                        <button
                          key={school.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSchoolChange(school.id);
                          }}
                          className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-50 transition-colors ${
                            selectedSchoolId === school.id ? 'bg-[#d32f2f]/10 text-[#d32f2f] font-semibold' : ''
                          }`}
                        >
                          {school.code === 'DEFAULT' ? 'デフォルト' : school.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            {schools.length === 1 && schoolDisplayName && (
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
            {(onSettingsClick || profile?.role === 'admin') && (showAllLinks || permissions?.canAccessSettings || profile?.role === 'admin') && (
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
                      {onSettingsClick && (
                        <button
                          onClick={() => {
                            onSettingsClick();
                            setShowSettingsDropdown(false);
                          }}
                          className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 transition-colors"
                        >
                          科目設定
                        </button>
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
    </header>
  );
}
