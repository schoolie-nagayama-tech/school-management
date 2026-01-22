'use client';

import type { Alert } from '@/types/alerts';
import { ALERT_TYPE_LABELS, ALERT_TYPE_COLORS } from '@/types/alerts';
import { Button } from '@/components/ui';

interface AlertItemProps {
  alert: Alert;
  onDismiss?: (alert: Alert) => void;
  canDismiss?: boolean;
}

export function AlertItem({ alert, onDismiss, canDismiss = false }: AlertItemProps) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 px-3 rounded-lg border border-[#0d0d0d] bg-[#fffffe]">
      <div className="flex items-center gap-2 flex-1">
        <span className={`px-2 py-1 rounded text-xs font-medium ${ALERT_TYPE_COLORS[alert.alert_type]}`}>
          {ALERT_TYPE_LABELS[alert.alert_type]}
        </span>
        <span className="text-sm text-[#2a2a2a]">{alert.message}</span>
      </div>
      {canDismiss && onDismiss && (
        <Button
          onClick={() => onDismiss(alert)}
          variant="secondary"
          size="sm"
          className="text-xs px-2 py-1"
        >
          対応済み
        </Button>
      )}
    </div>
  );
}
