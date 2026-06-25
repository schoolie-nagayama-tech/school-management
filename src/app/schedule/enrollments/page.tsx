'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { AdminLayout } from '@/components/layouts';
import { useAuth } from '@/contexts/AuthContext';
import AccessDenied from '@/components/AccessDenied';
import { KoushuEnrollmentManager } from '@/components/schedule/KoushuEnrollmentManager';
import { ZoukomaEnrollmentManager } from '@/components/schedule/ZoukomaEnrollmentManager';

type Tab = 'koushu' | 'testprep';

/**
 * 申込管理（生徒別）。講習とテスト対策（増コマ）の申込を1画面・タブ切替で扱う。
 * 旧 /schedule/koushu, /schedule/zoukoma を統合したもの。
 */
export default function EnrollmentsPage() {
  const { profile } = useAuth();
  const isManager =
    profile?.role === 'admin' || profile?.role === 'owner' || profile?.role === 'manager';

  const [tab, setTab] = useState<Tab>('koushu');

  // ?tab=testprep で初期タブを切替（useSearchParams を使わず Suspense 境界の de-opt を回避）
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get('tab');
    if (p === 'testprep') setTab('testprep');
  }, []);

  if (!isManager) return <AccessDenied />;

  const tabs: { key: Tab; label: string }[] = [
    { key: 'koushu', label: '講習' },
    { key: 'testprep', label: 'テスト対策' },
  ];

  return (
    <AdminLayout headerTitle="申込管理（生徒別）">
      <div className="space-y-6">
        {/* ヘッダー */}
        <div className="flex items-center gap-3">
          <Link href="/schedule">
            <button className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors active:scale-[0.97]">
              <ArrowLeft className="w-5 h-5" />
            </button>
          </Link>
          <h1 className="text-xl font-bold text-[var(--headline)]">申込管理（生徒別）</h1>
        </div>

        {/* タブ */}
        <div className="flex items-center gap-1 border-b border-[var(--stroke)]">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors active:scale-[0.97] ${
                tab === t.key
                  ? 'border-[var(--headline)] text-[var(--headline)]'
                  : 'border-transparent text-[var(--paragraph)] hover:text-[var(--headline)]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* タブ内容 */}
        {tab === 'koushu' ? <KoushuEnrollmentManager /> : <ZoukomaEnrollmentManager />}
      </div>
    </AdminLayout>
  );
}
