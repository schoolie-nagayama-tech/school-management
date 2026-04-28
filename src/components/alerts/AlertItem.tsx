'use client';

import type { Alert } from '@/types/alerts';
import { ALERT_TYPE_LABELS, ALERT_TYPE_COLORS } from '@/types/alerts';
import { Button } from '@/components/ui';

interface AlertItemProps {
  alert: Alert;
  onDismiss?: (alert: Alert) => void;
  canDismiss?: boolean;
}

/** 期日ベースの緊急度スタイルを返す */
function getAlertUrgencyStyle(alert: Alert): string {
  const daysUntil = alert.details?.days_until_due;
  if (daysUntil === undefined || daysUntil === null) return '';
  if (daysUntil >= 2) return 'bg-yellow-50 border-yellow-200';
  if (daysUntil >= 0) return 'bg-orange-50 border-orange-200';
  if (daysUntil >= -3) return 'bg-red-50 border-red-200';
  return 'bg-red-100 border-red-300';
}

export function AlertItem({ alert, onDismiss, canDismiss = false }: AlertItemProps) {
  const urgencyStyle = getAlertUrgencyStyle(alert);

  return (
    <div className={`flex items-center justify-between gap-2 py-1 px-2 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors duration-150 ${urgencyStyle}`}>
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <span className={`shrink-0 px-1.5 py-0.5 rounded text-xs font-medium ${ALERT_TYPE_COLORS[alert.alert_type]}`}>
          {ALERT_TYPE_LABELS[alert.alert_type]}
        </span>
        <span className="text-xs text-gray-700 truncate">{alert.message}</span>
      </div>
      {canDismiss && onDismiss && (
        <Button
          onClick={() => onDismiss(alert)}
          variant="primary"
          size="sm"
          className="shrink-0 text-xs px-2 py-1"
        >
          対応済み
        </Button>
      )}
    </div>
  );
}
