'use client';

import type { FormPeriod } from '@/types/database';

export type PeriodStatusResult = {
  label: string;
  color: string;
  /** Tailwind background color class for the status dot (e.g. "bg-green-500") */
  dotColor: string;
  /** @deprecated kept for backward compatibility — no longer rendered */
  icon: string;
};

export function getPeriodStatus(period: FormPeriod): PeriodStatusResult {
  if (period.is_archived) {
    return { label: 'アーカイブ', color: 'text-gray-400', dotColor: 'bg-gray-300', icon: '' };
  }

  if (!period.is_active) {
    return { label: '非公開', color: 'text-gray-500', dotColor: 'bg-gray-400', icon: '' };
  }

  const now = new Date();
  const start = period.publish_start ? new Date(period.publish_start) : null;
  const end = period.publish_end ? new Date(period.publish_end) : null;

  if (start && now < start) {
    return { label: '公開前', color: 'text-blue-600', dotColor: 'bg-blue-500', icon: '' };
  }

  if (end && now > end) {
    return { label: '公開終了', color: 'text-gray-500', dotColor: 'bg-gray-700', icon: '' };
  }

  return { label: '公開中', color: 'text-green-600', dotColor: 'bg-green-500', icon: '' };
}

interface PeriodStatusBadgeProps {
  period: FormPeriod;
}

export function PeriodStatusBadge({ period }: PeriodStatusBadgeProps) {
  const status = getPeriodStatus(period);
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${status.color}`}>
      <span className={`inline-block w-2 h-2 rounded-full ${status.dotColor}`} />
      {status.label}
    </span>
  );
}
