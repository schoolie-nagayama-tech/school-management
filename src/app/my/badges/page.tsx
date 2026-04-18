'use client';

import { useState, useEffect } from 'react';
import type { TeacherBadge, TeacherBadgeAssignment, BadgeRank, TeacherTraining } from '@/types/database';
import { BADGE_RANK_CONFIG } from '@/types/database';
import { getMyBadges } from '@/lib/api/teacher-badges';
import { getMyTrainings } from '@/lib/api/teacher-trainings';
import { AppHeader } from '@/components/layout/AppHeader';
import { BadgeGrid } from '@/components/teacher-badges/BadgeGrid';
import { BadgeProgress } from '@/components/teacher-badges/BadgeProgress';
import { getTier, getNextTier, type TierKey } from '@/lib/teacher-tier';

const TIER_LABEL: Record<TierKey, string> = {
  zero: '見習い',
  slate: 'スレート',
  emerald: 'エメラルド',
  purple: 'アメジスト',
  gold: 'ゴールド',
  mythic: 'ミシカル',
};

const TIER_SUBLABEL: Record<TierKey, string> = {
  zero: 'ここから始めよう',
  slate: '積み重ねの第一歩',
  emerald: '実績が光ってきた',
  purple: '一目置かれる存在',
  gold: '殿堂入りの風格',
  mythic: '伝説の講師',
};

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

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

  const tier = getTier(assignments.length);
  const nextTier = getNextTier(assignments.length);
  const remaining = nextTier ? nextTier.threshold - assignments.length : 0;

  return (
    <div
      className="min-h-screen bg-[#f8f9fa] tier-attendance"
      data-teacher-tier={tier.key}
    >
      <AppHeader title="マイトロフィー" />
      <div className="max-w-4xl mx-auto px-4 py-8">
        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-8 h-8 border-2 border-gray-300 border-t-[#1e3a5f] rounded-full animate-spin" />
          </div>
        ) : badges.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center shadow-sm">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-[color:var(--primary-subtle)] text-[color:var(--primary)] mb-4">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
                <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
                <path d="M4 22h16" />
                <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20 7 22" />
                <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20 17 22" />
                <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
              </svg>
            </div>
            <h2 className="text-lg font-bold text-gray-800 mb-2">まだトロフィーの準備中です</h2>
            <p className="text-sm text-gray-500">
              管理者がバッジを設定すると、獲得状況がここに並びます。
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Tier Hero */}
            <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
              <div className="flex items-start justify-between gap-4 mb-5">
                <div>
                  <p className="text-[11px] font-semibold tracking-[0.18em] text-gray-500 uppercase mb-1">
                    現在のティア
                  </p>
                  <h1 className="text-[26px] sm:text-[28px] font-bold text-gray-900 leading-tight tracking-tight">
                    {TIER_LABEL[tier.key]}
                  </h1>
                  <p className="text-sm text-gray-500 mt-1">
                    {TIER_SUBLABEL[tier.key]}
                  </p>
                </div>
                <span className={`tier-dot tier-dot-${tier.key} !w-3 !h-3 mt-2`} aria-hidden />
              </div>
              <div className="flex items-baseline justify-between gap-4 mb-3">
                <span className="text-[40px] font-bold text-gray-900 tabular-nums leading-none">
                  {assignments.length}
                  <span className="text-lg text-gray-400 font-normal ml-1">
                    / {badges.length}
                  </span>
                </span>
                {nextTier ? (
                  <span className="text-xs text-gray-500 text-right leading-tight">
                    次のティアまで<br />
                    <b className="text-gray-900 text-sm font-bold tabular-nums">
                      あと {remaining} 個
                    </b>
                  </span>
                ) : (
                  <span className="text-xs text-right leading-tight">
                    <span className={`tier-pill tier-pill-${tier.key} px-2 py-1 rounded-full font-bold`}>
                      最高位
                    </span>
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
                        className={`relative flex items-center gap-3 p-3 bg-white rounded-xl border shadow-sm transition-all hover:shadow-md hover:-translate-y-[1px] ${
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
