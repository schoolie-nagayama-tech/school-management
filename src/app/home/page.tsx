'use client';

/**
 * モバイル（PWA）ホーム — 教室長以上向けダッシュボード「今日の対応」
 *
 * インストール済みPWAは manifest の start_url=/home でここに着地する。
 * ブラウザ/PCは従来どおり別ページに着地するため、実質的にPWA起動時のホーム。
 * 「未読・期日・新着」を集約し、タップで各画面へ飛べる対応キューにする。
 *
 * 講師はこのダッシュボードの対象外（問合せ/アラート中心のため）。/students へ送る。
 */

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AdminLayout } from '@/components/layouts';
import { AlertBoard } from '@/components/alerts/AlertBoard';
import { PendingAttendanceNotice } from '@/components/attendance/PendingAttendanceNotice';
import { useAuth } from '@/contexts/AuthContext';
import { isManagerOrAbove, isTeacher } from '@/lib/utils/roles';
import { getUnreadCount } from '@/lib/api/bulletin';
import { getAlertsLight } from '@/lib/api/alerts';
import { getInquiries } from '@/lib/api/inquiries';
import { getRecentUnprocessedResponses } from '@/lib/api/form-responses';
import { Megaphone, AlertTriangle, MessageSquare, FileText, type LucideIcon } from 'lucide-react';

interface Counts {
  bulletin: number;
  alerts: number;
  trial: number;
  responses: number;
}

interface StatCard {
  key: string;
  label: string;
  href: string;
  icon: LucideIcon;
  count: number;
  show: boolean;
}

export default function HomePage() {
  const { profile, selectedSchoolId, getSelectedSchoolIds } = useAuth();
  const router = useRouter();

  const [counts, setCounts] = useState<Counts>({ bulletin: 0, alerts: 0, trial: 0, responses: 0 });
  const [loading, setLoading] = useState(true);

  const teacher = isTeacher(profile?.role);
  const managerPlus = isManagerOrAbove(profile?.role);

  // 講師はダッシュボード対象外 → 通常ホーム(/students)へ
  useEffect(() => {
    if (profile && teacher) router.replace('/students');
  }, [profile, teacher, router]);

  // 対応キューの件数をまとめて取得（教室切替で再取得）
  useEffect(() => {
    if (!profile || teacher) return;
    const ids = getSelectedSchoolIds();
    if (ids.length === 0) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [bulletinPerSchool, alerts, trial, responses] = await Promise.all([
          Promise.all(ids.map((id) => getUnreadCount(id, profile.id).catch(() => 0))),
          getAlertsLight(ids).catch(() => []),
          managerPlus
            ? getInquiries(ids, { status: 'trial_waiting' }).catch(() => [])
            : Promise.resolve([]),
          getRecentUnprocessedResponses(ids, 7, 100).catch(() => []),
        ]);
        if (cancelled) return;
        setCounts({
          bulletin: bulletinPerSchool.reduce((a, b) => a + b, 0),
          alerts: alerts.length,
          trial: trial.length,
          responses: responses.length,
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // selectedSchoolId を依存に含め、教室切替時に再取得する
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, teacher, managerPlus, selectedSchoolId]);

  const cards = useMemo<StatCard[]>(
    () => [
      {
        key: 'bulletin',
        label: '連絡掲示板の未読',
        href: '/students',
        icon: Megaphone,
        count: counts.bulletin,
        show: true,
      },
      {
        key: 'alerts',
        label: '要対応アラート',
        href: '/students',
        icon: AlertTriangle,
        count: counts.alerts,
        show: true,
      },
      {
        key: 'trial',
        label: '体験待ちの問合せ',
        href: '/admin/inquiries',
        icon: MessageSquare,
        count: counts.trial,
        show: managerPlus,
      },
      {
        key: 'responses',
        label: '新着フォーム回答',
        href: '/responses',
        icon: FileText,
        count: counts.responses,
        show: true,
      },
    ],
    [counts, managerPlus]
  );

  // 講師は描画しない（リダイレクト待ち）
  if (!profile || teacher) return null;

  return (
    <AdminLayout headerTitle="ホーム">
      <div className="mb-4">
        <h1 className="text-lg font-bold text-gray-900">今日の対応</h1>
        <p className="text-sm text-gray-500 mt-0.5">未読・期日・新着をまとめて確認できます</p>
      </div>

      {/* 対応キュー: 件数カード（タップで各画面へ） */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        {cards
          .filter((c) => c.show)
          .map((card) => {
            const Icon = card.icon;
            const hasItems = card.count > 0;
            return (
              <Link
                key={card.key}
                href={card.href}
                className="block rounded-xl border border-gray-200 bg-white p-4 transition-[transform,background-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] [@media(hover:hover)]:hover:bg-surface active:scale-[0.98]"
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`flex h-9 w-9 items-center justify-center rounded-lg ${
                      hasItems ? 'bg-primary/10 text-primary' : 'bg-gray-100 text-gray-400'
                    }`}
                  >
                    <Icon className="h-5 w-5" aria-hidden />
                  </span>
                </div>
                <div className="mt-3 text-2xl font-bold leading-none text-gray-900">
                  {loading ? <span className="text-gray-300">–</span> : card.count}
                </div>
                <div className="mt-1 text-xs text-gray-500">{card.label}</div>
              </Link>
            );
          })}
      </div>

      {/* 出勤簿の未処理（生徒アラートとは別枠。理由はコンポーネント側のコメント参照） */}
      <PendingAttendanceNotice />

      {/* 要対応アラートの実リスト（既存コンポーネントを再利用） */}
      <AlertBoard />
    </AdminLayout>
  );
}
