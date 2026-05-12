'use client';

/**
 * 進行フィード — 教室長以上向け
 *
 * 教室配下の全生徒のセッション記録を新着順で表示。
 * 宿題未提出・遅刻のあるセッションを即座に把握できる。
 * 講師はアクセス不可（教室長・オーナー・管理者のみ）
 */

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { AdminLayout } from '@/components/layouts';
import SessionFeed from '@/components/progress/SessionFeed';
import { useAuth } from '@/contexts/AuthContext';

export default function ProgressFeedPage() {
  const { profile } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (profile && profile.role === 'teacher') {
      router.replace('/students');
    }
  }, [profile, router]);

  if (!profile || profile.role === 'teacher') {
    return null;
  }

  return (
    <AdminLayout headerTitle="進行フィード">
      <div className="max-w-3xl mx-auto">
        <div className="mb-6">
          <h1 className="text-lg font-bold text-gray-900">進行フィード</h1>
          <p className="text-sm text-gray-500 mt-1">
            直近の授業セッション記録を新着順で表示します
          </p>
        </div>
        <SessionFeed />
      </div>
    </AdminLayout>
  );
}
