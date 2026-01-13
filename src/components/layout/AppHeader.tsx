'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { getDefaultSchoolId, getSchool } from '@/lib/api/schools';
import type { School } from '@/types/database';

interface AppHeaderProps {
  title: string;
  onSettingsClick?: () => void;
}

export function AppHeader({ title, onSettingsClick }: AppHeaderProps) {
  const pathname = usePathname();
  const [school, setSchool] = useState<School | null>(null);

  useEffect(() => {
    const fetchSchool = async () => {
      try {
        const schoolId = getDefaultSchoolId();
        const schoolData = await getSchool(schoolId);
        setSchool(schoolData);
      } catch (error) {
        console.error('Error fetching school:', error);
        // エラーが発生してもアプリは動作し続ける
      }
    };
    fetchSchool();
  }, []);

  const schoolDisplayName = school?.code === 'DEFAULT' ? 'デフォルト' : school?.name || '';

  return (
    <header className="bg-[#fffffe] border-b border-[#0d0d0d]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-6">
            <h1 className="text-xl font-bold text-[#0d0d0d]">{title}</h1>
            <nav className="flex items-center gap-4">
              <Link
                href="/students"
                className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                  pathname === '/students'
                    ? 'bg-[#ff8e3c] text-[#0d0d0d]'
                    : 'text-[#2a2a2a] hover:bg-[#eff0f3]'
                }`}
              >
                生徒管理
              </Link>
              <Link
                href="/applications"
                className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                  pathname === '/applications'
                    ? 'bg-[#ff8e3c] text-[#0d0d0d]'
                    : 'text-[#2a2a2a] hover:bg-[#eff0f3]'
                }`}
              >
                申込状況
              </Link>
              <Link
                href="/responses"
                className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                  pathname?.startsWith('/responses') || pathname?.startsWith('/forms/responses')
                    ? 'bg-[#ff8e3c] text-[#0d0d0d]'
                    : 'text-[#2a2a2a] hover:bg-[#eff0f3]'
                }`}
              >
                回答管理
              </Link>
              <Link
                href="/settings/portal"
                className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                  pathname === '/settings/portal'
                    ? 'bg-[#ff8e3c] text-[#0d0d0d]'
                    : 'text-[#2a2a2a] hover:bg-[#eff0f3]'
                }`}
              >
                ポータル設定
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-4">
            {schoolDisplayName && (
              <div className="text-sm font-medium text-[#2a2a2a]">
                {schoolDisplayName}
              </div>
            )}
            <button
              onClick={onSettingsClick}
              className="p-2 text-[#2a2a2a] hover:text-[#0d0d0d] hover:bg-[#eff0f3] rounded-lg transition-colors"
              title="設定"
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
          </div>
        </div>
      </div>
    </header>
  );
}
