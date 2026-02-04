'use client';

import type { FormPeriod } from '@/types/database';

export type PeriodStatusResult = {
  label: string;
  color: string;
  icon: string;
};

export function getPeriodStatus(period: FormPeriod): PeriodStatusResult {
  if (period.is_archived) {
    return { label: 'アーカイブ', color: 'text-gray-400', icon: '📦' };
  }

  if (!period.is_active) {
    return { label: '非公開', color: 'text-gray-500', icon: '⚪' };
  }

  const now = new Date();
  const start = period.publish_start ? new Date(period.publish_start) : null;
  const end = period.publish_end ? new Date(period.publish_end) : null;

  if (start && now < start) {
    return { label: '公開前', color: 'text-blue-600', icon: '🔵' };
  }

  if (end && now > end) {
    return { label: '公開終了', color: 'text-gray-500', icon: '⚫' };
  }

  return { label: '公開中', color: 'text-green-600', icon: '🟢' };
}

interface PeriodStatusBadgeProps {
  period: FormPeriod;
}

export function PeriodStatusBadge({ period }: PeriodStatusBadgeProps) {
  const status = getPeriodStatus(period);
  return (
    <span className={`text-sm font-medium ${status.color}`}>
      {status.icon} {status.label}
    </span>
  );
}
