'use client';

import type { TeacherBadge, TeacherBadgeAssignment, BadgeCategory } from '@/types/database';
import { BADGE_CATEGORY_CONFIG } from '@/types/database';
import { BadgeCard } from './BadgeCard';

interface BadgeGridProps {
  badges: TeacherBadge[];
  assignments: TeacherBadgeAssignment[];
  onBadgeClick?: (badge: TeacherBadge, isEarned: boolean) => void;
  interactive?: boolean;
  groupByCategory?: boolean;
}

export function BadgeGrid({
  badges,
  assignments,
  onBadgeClick,
  interactive = false,
  groupByCategory = true,
}: BadgeGridProps) {
  const assignmentMap = new Map(assignments.map((a) => [a.badge_id, a]));

  if (!groupByCategory) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {badges.map((badge) => {
          const assignment = assignmentMap.get(badge.id);
          return (
            <BadgeCard
              key={badge.id}
              badge={badge}
              earned={!!assignment}
              earnedDate={assignment?.completed_at}
              onClick={onBadgeClick ? () => onBadgeClick(badge, !!assignment) : undefined}
              interactive={interactive}
            />
          );
        })}
      </div>
    );
  }

  const categories = (['training', 'skill', 'achievement'] as BadgeCategory[]).filter((cat) =>
    badges.some((b) => b.category === cat)
  );

  return (
    <div className="space-y-6">
      {categories.map((cat) => {
        const catBadges = badges.filter((b) => b.category === cat);
        const catConfig = BADGE_CATEGORY_CONFIG[cat];
        const catEarned = catBadges.filter((b) => assignmentMap.has(b.id)).length;

        return (
          <div key={cat}>
            <div className="flex items-center gap-2 mb-3">
              <h3 className="text-sm font-bold text-gray-700">{catConfig.label}</h3>
              <span className="text-xs text-gray-400 tabular-nums">
                {catEarned}/{catBadges.length}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {catBadges.map((badge) => {
                const assignment = assignmentMap.get(badge.id);
                return (
                  <BadgeCard
                    key={badge.id}
                    badge={badge}
                    earned={!!assignment}
                    earnedDate={assignment?.completed_at}
                    onClick={onBadgeClick ? () => onBadgeClick(badge, !!assignment) : undefined}
                    interactive={interactive}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
