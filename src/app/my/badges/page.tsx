'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Trophy, Star } from 'lucide-react';
import type { TeacherBadge, TeacherBadgeAssignment, BadgeRank, TeacherTraining } from '@/types/database';
import { BADGE_RANK_CONFIG } from '@/types/database';
import { getMyBadges } from '@/lib/api/teacher-badges';
import { getMyTrainings } from '@/lib/api/teacher-trainings';
import { Loading } from '@/components/ui';
import { AppHeader } from '@/components/layout/AppHeader';
import { BadgeGrid } from '@/components/teacher-badges/BadgeGrid';
import { BadgeProgress } from '@/components/teacher-badges/BadgeProgress';
import { BadgeFlowerField } from '@/components/badges/HiddenFlower';
import { MY_BADGES_FLOWERS } from '@/components/badges/flowerPlacements';
import { getTier, getNextTier } from '@/lib/teacher-tier';
import { useAuth } from '@/contexts/AuthContext';

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export default function MyBadgesPage() {
  const router = useRouter();
  const { profile, isLoading: authLoading } = useAuth();
  const [badges, setBadges] = useState<TeacherBadge[]>([]);
  const [assignments, setAssignments] = useState<TeacherBadgeAssignment[]>([]);
  const [trainings, setTrainings] = useState<TeacherTraining[]>([]);
  const [loading, setLoading] = useState(true);

  // このページは講師専用。profile 取得後にロールが teacher でなければ生徒管理へリダイレクト
  useEffect(() => {
    if (authLoading) return; // profile 未取得の間は判定しない
    if (profile && profile.role !== 'teacher') {
      router.replace('/students');
    }
  }, [authLoading, profile, router]);

  useEffect(() => {
    const load = async () => {
      try {
        const [data, trainingList] = await Promise.all([
          getMyBadges(),
          getMyTrainings().catch(() => [] as TeacherTraining[]),
        ]);
        setBadges(data.badges);
        setAssignments(data.assignments);
        setTrainings(trainingList);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const rankCounts = assignments.reduce((acc, a) => {
    const badge = a.badge || badges.find((b) => b.id === a.badge_id);
    if (badge) acc[badge.rank] = (acc[badge.rank] || 0) + 1;
    return acc;
  }, {} as Partial<Record<BadgeRank, number>>);

  // 最新の獲得バッジ（直近3件）
  const recentEarned = [...assignments]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 3);

  const tier = getTier(assignments.length);
  const nextTier = getNextTier(assignments.length);
  const remaining = nextTier ? nextTier.threshold - assignments.length : 0;

  // profile 未取得中 or 非講師ユーザー（リダイレクト処理中）はコンテンツを描画しない
  if (authLoading || !profile || profile.role !== 'teacher') {
    return <Loading className="min-h-screen" />;
  }

  return (
    <div
      className="min-h-screen bg-[#f8f9fa] tier-attendance"
      data-teacher-tier={tier.key}
    >
      <AppHeader title="マイトロフィー" />
      <div className="relative max-w-4xl mx-auto px-4 py-8">
        <BadgeFlowerField count={assignments.length} placements={MY_BADGES_FLOWERS} />
        {loading ? (
          <Loading className="py-20" />
        ) : badges.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center shadow-sm">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-[color:var(--primary-subtle)] text-[color:var(--primary)] mb-4">
              <Trophy className="w-7 h-7" />
            </div>
            <h2 className="text-lg font-bold text-gray-800 mb-2">まだトロフィーの準備中です</h2>
            <p className="text-sm text-gray-500">
              管理者がバッジを設定すると、獲得状況がここに並びます。
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {/* 獲得状況 */}
            <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
              <div className="flex items-start justify-between gap-4 mb-5">
                <p className="text-[11px] font-semibold tracking-[0.18em] text-gray-500 uppercase">
                  獲得状況
                </p>
                <span className={`tier-dot tier-dot-${tier.key} !w-3 !h-3 mt-1`} aria-hidden />
              </div>
              <div className="flex items-baseline justify-between gap-4 mb-3">
                <span className="text-[40px] font-bold text-gray-900 tabular-nums leading-none">
                  {assignments.length}
                  <span className="text-lg text-gray-400 font-normal ml-1">
                    / {badges.length}
                  </span>
                </span>
                {nextTier && (
                  <span className="text-xs text-gray-500 text-right leading-tight">
                    次の節目まで<br />
                    <b className="text-gray-900 text-sm font-bold tabular-nums">
                      あと {remaining} 個
                    </b>
                  </span>
                )}
              </div>
              <BadgeProgress
                earned={assignments.length}
                total={badges.length}
                rankCounts={rankCounts}
              />
            </div>

            {/* 直近の獲得 */}
            {recentEarned.length > 0 && (
              <div>
                <h2 className="text-sm font-bold text-gray-600 mb-3 uppercase tracking-wider">最近の獲得</h2>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {recentEarned.map((a, idx) => {
                    const badge = a.badge || badges.find((b) => b.id === a.badge_id);
                    if (!badge) return null;
                    const rankConfig = BADGE_RANK_CONFIG[badge.rank];
                    const earnedAt = a.created_at ? new Date(a.created_at).getTime() : 0;
                    const isNew = earnedAt && Date.now() - earnedAt < ONE_WEEK_MS;
                    return (
                      <div
                        key={a.id}
                        className={`relative flex items-center gap-3 p-3 bg-white rounded-xl border shadow-sm transition-[box-shadow,transform] duration-150 ease-out hover:shadow-md hover:-translate-y-[1px] ${
                          idx === 0 ? 'border-[color:var(--primary)]/20' : 'border-gray-200'
                        }`}
                      >
                        {isNew && (
                          <span
                            className="absolute -top-1.5 -right-1.5 px-1.5 py-0.5 text-[9px] font-bold bg-[color:var(--primary)] text-white rounded-full shadow-sm"
                            style={{ animation: 'badge-pulse 2.2s ease-in-out infinite' }}
                          >
                            NEW
                          </span>
                        )}
                        <div
                          className="w-10 h-10 rounded-lg flex items-center justify-center text-white shadow-sm flex-shrink-0"
                          style={{ background: `linear-gradient(135deg, ${rankConfig.color}, ${rankConfig.color}88)` }}
                        >
                          {badge.icon === 'trophy' ? (
                            <Trophy className="w-5 h-5" />
                          ) : (
                            <Star className="w-5 h-5" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-gray-800 truncate">{badge.name}</p>
                          <p className="text-xs text-gray-400">{a.completed_at}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* バッジ一覧 */}
            <div>
              <h2 className="text-sm font-bold text-gray-600 mb-4 uppercase tracking-wider">すべてのバッジ</h2>
              <BadgeGrid
                badges={badges}
                assignments={assignments}
                groupByCategory
              />
            </div>

            {/* ランク別集計 */}
            <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
              <h2 className="text-sm font-bold text-gray-600 mb-4 uppercase tracking-wider">ランク別</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {(['platinum', 'gold', 'silver', 'bronze'] as BadgeRank[]).map((rank) => {
                  const config = BADGE_RANK_CONFIG[rank];
                  const count = rankCounts[rank] || 0;
                  const total = badges.filter((b) => b.rank === rank).length;
                  return (
                    <div
                      key={rank}
                      className="flex flex-col items-center gap-2 p-4 rounded-xl border"
                      style={{ borderColor: `${config.color}30` }}
                    >
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center text-white shadow-sm"
                        style={{ background: `linear-gradient(135deg, ${config.color}, ${config.color}88)` }}
                      >
                        <span className="text-sm font-bold">{count}</span>
                      </div>
                      <span className="text-xs font-bold uppercase tracking-wider" style={{ color: config.color }}>
                        {config.label}
                      </span>
                      <span className="text-[10px] text-gray-400">{count}/{total}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 研修参加履歴 */}
            <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
              <h2 className="text-sm font-bold text-gray-600 mb-4 uppercase tracking-wider">
                研修参加履歴
              </h2>
              {trainings.length === 0 ? (
                <p className="text-sm text-gray-400 py-2">まだ研修の参加履歴がありません</p>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {trainings.map((t) => (
                    <li key={t.id} className="py-3">
                      <p className="text-sm font-medium text-gray-800">{t.title}</p>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5 text-xs text-gray-500">
                        {t.period_label && <span>{t.period_label}</span>}
                        {t.attended_on && (
                          <span>{new Date(t.attended_on).toLocaleDateString('ja-JP')}</span>
                        )}
                      </div>
                      {t.note && (
                        <p className="text-xs text-gray-600 mt-1 whitespace-pre-wrap">{t.note}</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
