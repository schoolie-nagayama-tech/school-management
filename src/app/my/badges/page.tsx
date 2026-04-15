'use client';

import { useState, useEffect } from 'react';
import type { TeacherBadge, TeacherBadgeAssignment, BadgeRank, TeacherTraining } from '@/types/database';
import { BADGE_RANK_CONFIG } from '@/types/database';
import { getMyBadges } from '@/lib/api/teacher-badges';
import { getMyTrainings } from '@/lib/api/teacher-trainings';
import { AppHeader } from '@/components/layout/AppHeader';
import { BadgeGrid } from '@/components/teacher-badges/BadgeGrid';
import { BadgeProgress } from '@/components/teacher-badges/BadgeProgress';

export default function MyBadgesPage() {
  const [badges, setBadges] = useState<TeacherBadge[]>([]);
  const [assignments, setAssignments] = useState<TeacherBadgeAssignment[]>([]);
  const [trainings, setTrainings] = useState<TeacherTraining[]>([]);
  const [loading, setLoading] = useState(true);

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

  return (
    <div className="min-h-screen bg-[#f8f9fa]">
      <AppHeader title="マイトロフィー" />
      <div className="max-w-4xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-8">マイトロフィー</h1>

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-8 h-8 border-2 border-gray-300 border-t-[#1e3a5f] rounded-full animate-spin" />
          </div>
        ) : badges.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <p>バッジがまだ設定されていません</p>
          </div>
        ) : (
          <div className="space-y-8">
            {/* サマリーカード */}
            <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-gray-800">獲得状況</h2>
                <span className="text-2xl font-bold text-gray-900 tabular-nums">
                  {assignments.length}<span className="text-sm text-gray-400 font-normal"> / {badges.length}</span>
                </span>
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
                  {recentEarned.map((a) => {
                    const badge = a.badge || badges.find((b) => b.id === a.badge_id);
                    if (!badge) return null;
                    const rankConfig = BADGE_RANK_CONFIG[badge.rank];
                    return (
                      <div
                        key={a.id}
                        className="flex items-center gap-3 p-3 bg-white rounded-xl border border-gray-200 shadow-sm"
                      >
                        <div
                          className="w-10 h-10 rounded-lg flex items-center justify-center text-white shadow-sm flex-shrink-0"
                          style={{ background: `linear-gradient(135deg, ${rankConfig.color}, ${rankConfig.color}88)` }}
                        >
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            {badge.icon === 'trophy' ? (
                              <>
                                <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
                                <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
                                <path d="M4 22h16" />
                                <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20 7 22" />
                                <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20 17 22" />
                                <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
                              </>
                            ) : (
                              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                            )}
                          </svg>
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
