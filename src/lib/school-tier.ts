// 教室の在籍生徒数に応じたティア。
// 講師の teacher-tier と key 空間を揃え、既存の CSS（tier-dot / tier-pill /
// tier-attendance / tier-hairline 等）を流用できるようにしている。
// 閾値は仮置き。運営実態に合わせて後日調整可能。

import type { TierKey } from './teacher-tier';

export const SCHOOL_TIERS: { key: TierKey; threshold: number }[] = [
  { key: 'zero', threshold: 0 },
  { key: 'slate', threshold: 1 }, // 発足期
  { key: 'emerald', threshold: 15 }, // 成長期
  { key: 'purple', threshold: 35 }, // 安定期
  { key: 'gold', threshold: 65 }, // 繁栄期
  { key: 'mythic', threshold: 100 }, // 伝説
];

export const SCHOOL_TIER_LABEL: Record<TierKey, string> = {
  zero: '準備中',
  slate: '発足期',
  emerald: '成長期',
  purple: '安定期',
  gold: '繁栄期',
  mythic: '殿堂級',
};

export const SCHOOL_TIER_SUBLABEL: Record<TierKey, string> = {
  zero: '最初の1人を迎えよう',
  slate: '育ちはじめた小さな教室',
  emerald: '地域に根付きつつある',
  purple: '確かな運営が光る',
  gold: '地域を代表する教室',
  mythic: 'ここまで来ると伝説',
};

export function getSchoolTier(activeCount: number): { key: TierKey; threshold: number } {
  return [...SCHOOL_TIERS].reverse().find((t) => activeCount >= t.threshold)!;
}

export function getNextSchoolTier(activeCount: number):
  | { key: TierKey; threshold: number }
  | undefined {
  return SCHOOL_TIERS.find((t) => t.threshold > activeCount);
}
