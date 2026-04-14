'use client';

import type { TeacherBadge, BadgeRank } from '@/types/database';
import { BADGE_RANK_CONFIG } from '@/types/database';
import { BadgeIcon } from './BadgeIcon';

const rankStyles: Record<BadgeRank, { card: string; iconBg: string; text: string }> = {
  neutral: {
    card: 'border-slate-200 bg-white shadow-slate-100',
    iconBg: 'bg-slate-500 text-white shadow-sm shadow-slate-200',
    text: 'text-slate-700',
  },
  bronze: {
    card: 'border-amber-300 bg-gradient-to-b from-amber-50 to-white shadow-amber-100',
    iconBg: 'bg-gradient-to-br from-amber-600 to-amber-400 text-white shadow-lg shadow-amber-200',
    text: 'text-amber-800',
  },
  silver: {
    card: 'border-gray-300 bg-gradient-to-b from-gray-50 to-white shadow-gray-100',
    iconBg: 'bg-gradient-to-br from-gray-500 to-gray-300 text-white shadow-lg shadow-gray-200',
    text: 'text-gray-700',
  },
  gold: {
    card: 'border-yellow-400 bg-gradient-to-b from-yellow-50 to-white shadow-yellow-100',
    iconBg: 'bg-gradient-to-br from-yellow-500 to-amber-300 text-white shadow-lg shadow-yellow-200',
    text: 'text-yellow-800',
  },
  platinum: {
    card: 'border-sky-300 bg-gradient-to-b from-sky-50 to-white shadow-sky-100',
    iconBg: 'bg-gradient-to-br from-sky-500 to-cyan-300 text-white shadow-lg shadow-sky-200',
    text: 'text-sky-800',
  },
};

const inactiveStyle = {
  card: 'border-gray-200 bg-gray-50/60',
  iconBg: 'bg-gray-200 text-gray-400',
  text: 'text-gray-400',
};

interface BadgeCardProps {
  badge: TeacherBadge;
  earned: boolean;
  earnedDate?: string | null;
  onClick?: () => void;
  interactive?: boolean;
  compact?: boolean;
}

export function BadgeCard({ badge, earned, earnedDate, onClick, interactive = false, compact = false }: BadgeCardProps) {
  const style = earned ? rankStyles[badge.rank] : inactiveStyle;
  const rankConfig = BADGE_RANK_CONFIG[badge.rank];

  if (compact) {
    return (
      <div
        className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full border text-xs font-medium ${
          earned ? `${style.card}` : 'border-gray-200 bg-gray-50 text-gray-400'
        }`}
        title={badge.name}
      >
        <BadgeIcon icon={badge.icon} size={14} />
        <span>{badge.name}</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!interactive}
      className={`
        group relative flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all duration-200
        ${style.card}
        ${interactive ? 'cursor-pointer hover:scale-[1.03] hover:shadow-md active:scale-[0.98]' : 'cursor-default'}
        ${!earned ? 'opacity-50' : ''}
        w-full
      `}
    >
      {/* ランクインジケーター */}
      <span className={`absolute top-2 right-2 text-[10px] font-bold uppercase tracking-wider ${style.text}`}>
        {rankConfig.label}
      </span>

      {/* アイコン */}
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${style.iconBg} transition-transform duration-200 ${interactive ? 'group-hover:scale-110' : ''}`}>
        <BadgeIcon icon={badge.icon} size={24} />
      </div>

      {/* バッジ名 */}
      <span className={`text-sm font-semibold text-center leading-tight ${style.text}`}>
        {badge.name}
      </span>

      {/* 獲得日 or 未獲得 */}
      {earned && earnedDate ? (
        <span className="text-[11px] text-gray-500">{earnedDate}</span>
      ) : (
        <span className="text-[11px] text-gray-300 italic">未獲得</span>
      )}

      {/* 獲得済みチェックマーク */}
      {earned && (
        <div className="absolute -top-1.5 -left-1.5 w-5 h-5 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-sm">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
      )}
    </button>
  );
}
