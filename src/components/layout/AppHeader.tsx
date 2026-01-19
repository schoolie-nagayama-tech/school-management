'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { getSchools } from '@/lib/api/schools';
import { useAuth } from '@/contexts/AuthContext';
import { USER_ROLE_LABELS } from '@/types/database';
import type { School } from '@/types/database';

interface AppHeaderProps {
  title: string;
  onSettingsClick?: () => void;
}

export function AppHeader({ title, onSettingsClick }: AppHeaderProps) {
  const pathname = usePathname();
  const { profile, permissions, signOut, isLoading: authLoading, schoolIds, selectedSchoolId, setSelectedSchoolId } = useAuth();
  const [schools, setSchools] = useState<School[]>([]);
  const [showSchoolDropdown, setShowSchoolDropdown] = useState(false);

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
    if (!showSchoolDropdown) return;
    
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.school-dropdown-container')) {
        setShowSchoolDropdown(false);
      }
    };
    
    // 少し遅延させて、現在のクリックイベントが処理されるのを待つ
    setTimeout(() => {
      document.addEventListener('click', handleClickOutside);
    }, 0);
    
    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  }, [showSchoolDropdown]);

  return (
    <header className="bg-[#fffffe] border-b border-[#0d0d0d]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">
          <div className="flex items-center gap-4">
            {/* ホームリンク */}
            <Link
              href="/students"
              className="flex items-center gap-2 text-[#0d0d0d] hover:text-[#ff8e3c] transition-colors"
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
            <div className="h-6 w-px bg-[#0d0d0d]/20"></div>
            <h1 className="text-base font-semibold text-[#0d0d0d]">{title}</h1>
            <nav className="flex items-center gap-3 ml-2">
              {(showAllLinks || permissions?.canAccessStudents) && (
                <Link
                  href="/students"
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    pathname === '/students'
                      ? 'bg-[#ff8e3c] text-[#0d0d0d]'
                      : 'text-[#2a2a2a] hover:bg-[#eff0f3]'
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
                      ? 'bg-[#ff8e3c] text-[#0d0d0d]'
                      : 'text-[#2a2a2a] hover:bg-[#eff0f3]'
                  }`}
                >
                  申込状況
                </Link>
              )}
              <Link
                href="/responses"
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  pathname?.startsWith('/responses') || pathname?.startsWith('/forms/responses')
                    ? 'bg-[#ff8e3c] text-[#0d0d0d]'
                    : 'text-[#2a2a2a] hover:bg-[#eff0f3]'
                }`}
              >
                回答管理
              </Link>
              {(showAllLinks || permissions?.canAccessPortal) && (
                <Link
                  href="/settings/portal"
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    pathname === '/settings/portal'
                      ? 'bg-[#ff8e3c] text-[#0d0d0d]'
                      : 'text-[#2a2a2a] hover:bg-[#eff0f3]'
                  }`}
                >
                  ポータル設定
                </Link>
              )}
              {(showAllLinks || permissions?.canAccessCourses) && (
                <Link
                  href="/courses"
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    pathname === '/courses' || pathname?.startsWith('/courses/')
                      ? 'bg-[#ff8e3c] text-[#0d0d0d]'
                      : 'text-[#2a2a2a] hover:bg-[#eff0f3]'
                  }`}
                >
                  講習管理
                </Link>
              )}
              {(showAllLinks || permissions?.canAccessUsers) && (
                <Link
                  href="/users"
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    pathname === '/users' || pathname?.startsWith('/users/')
                      ? 'bg-[#ff8e3c] text-[#0d0d0d]'
                      : 'text-[#2a2a2a] hover:bg-[#eff0f3]'
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
                  className="text-xs font-medium text-[#2a2a2a] px-2 py-1 bg-[#eff0f3] rounded hover:bg-[#0d0d0d]/10 transition-colors flex items-center gap-1"
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
                    className="absolute right-0 mt-1 bg-white rounded-lg border border-[#0d0d0d] shadow-lg z-50 min-w-[200px]"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="py-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedSchoolId('all');
                          setShowSchoolDropdown(false);
                        }}
                        className={`w-full text-left px-3 py-2 text-xs hover:bg-[#eff0f3] transition-colors ${
                          selectedSchoolId === 'all' ? 'bg-[#ff8e3c]/10 font-bold' : ''
                        }`}
                      >
                        すべての教室
                      </button>
                      {schools.map(school => (
                        <button
                          key={school.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedSchoolId(school.id);
                            setShowSchoolDropdown(false);
                          }}
                          className={`w-full text-left px-3 py-2 text-xs hover:bg-[#eff0f3] transition-colors ${
                            selectedSchoolId === school.id ? 'bg-[#ff8e3c]/10 font-bold' : ''
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
              <div className="text-xs font-medium text-[#2a2a2a] px-2 py-1 bg-[#eff0f3] rounded">
                {schoolDisplayName}
              </div>
            )}
            {profile && !authLoading && (
              <div className="flex items-center gap-2 text-right">
                <div>
                  <div className="text-xs font-medium text-[#0d0d0d] leading-tight">
                    {profile.display_name || profile.email}
                  </div>
                  <div className="text-[10px] text-[#2a2a2a] leading-tight">
                    {USER_ROLE_LABELS[profile.role]}
                  </div>
                </div>
              </div>
            )}
            {profile && !authLoading && (
              <button
                onClick={signOut}
                className="px-2 py-1.5 text-xs font-medium bg-[#d9376e] text-white rounded hover:bg-[#c02d5a] transition-colors flex items-center gap-1.5"
                title="ログアウト"
              >
                <svg
                  className="w-3.5 h-3.5"
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
            {onSettingsClick && (
              <button
                onClick={onSettingsClick}
                className="p-1.5 text-[#2a2a2a] hover:text-[#0d0d0d] hover:bg-[#eff0f3] rounded-lg transition-colors"
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
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
