'use client';

import Link from 'next/link';
import type { Alert, AlertType } from '@/types/alerts';
import { ALERT_TYPE_LABELS, ALERT_TYPE_COLORS, DISMISSABLE_ALERT_TYPES, SENSITIVE_ALERT_TYPES } from '@/types/alerts';
import { Button } from '@/components/ui';
import { TrendingDown, BookOpen, Clock, MessageCircle } from 'lucide-react';

/** マスク時に表示するアイコン（ネガティブ系アラート） */
const SENSITIVE_ALERT_ICONS: Partial<Record<AlertType, React.ComponentType<{ className?: string }>>> = {
  score_drop: TrendingDown,
  homework_not_done: BookOpen,
  tardy: Clock,
  interview_overdue: MessageCircle,
};

interface AlertItemProps {
  alert: Alert;
  onDismiss?: (alert: Alert) => void;
  canDismiss?: boolean;
  /** 講師画面：ネガティブ情報をアイコンのみに簡略化 */
  masked?: boolean;
}

/** 期日ベースの緊急度スタイルを返す */
function getAlertUrgencyStyle(alert: Alert): string {
  // severity が指定されていればそれを優先
  if (alert.severity === 'danger') return 'bg-red-100 border-red-300';
  if (alert.severity === 'warning') return 'bg-orange-50 border-orange-200';
  if (alert.severity === 'info') return 'bg-yellow-50 border-yellow-200';
  const daysUntil = alert.details?.days_until_due;
  if (daysUntil === undefined || daysUntil === null) return '';
  if (daysUntil >= 2) return 'bg-yellow-50 border-yellow-200';
  if (daysUntil >= 0) return 'bg-orange-50 border-orange-200';
  if (daysUntil >= -3) return 'bg-red-50 border-red-200';
  return 'bg-red-100 border-red-300';
}

/** アラート種別ごとに編集すべきページへのリンクを返す */
function getEditHref(alert: Alert): string | null {
  const sid = alert.student_id;
  switch (alert.alert_type) {
    case 'score_drop':
    case 'score_missing':
      return `/students/${sid}/scores`;
    case 'interview_overdue':
    case 'interview_task':
      return `/students/${sid}/interviews`;
    case 'application_overdue':
      return `/students?tab=applications`;
    case 'exam_overdue':
    case 'homework_not_done':
    case 'tardy':
      return `/students/${sid}/progress`;
    case 'course_prep_overdue':
      return `/courses/progress`;
    default:
      return null;
  }
}

export function AlertItem({ alert, onDismiss, canDismiss = false, masked = false }: AlertItemProps) {
  const urgencyStyle = getAlertUrgencyStyle(alert);
  const editHref = getEditHref(alert);
  const isSensitive = masked && SENSITIVE_ALERT_TYPES.has(alert.alert_type);

  // マスク時はネガティブ系のメッセージを非表示
  const messageNode = isSensitive ? null : editHref ? (
    <Link
      href={editHref}
      className="text-xs text-gray-700 hover:text-[#1e3a5f] hover:underline truncate"
      title="編集ページへ移動"
    >
      {alert.message}
    </Link>
  ) : (
    <span className="text-xs text-gray-700 truncate">{alert.message}</span>
  );

  // マスク時のネガティブ系はアイコンのみ表示
  const Icon = isSensitive ? SENSITIVE_ALERT_ICONS[alert.alert_type] : null;

  return (
    <div className={`flex items-center justify-between gap-2 py-1 px-2 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors duration-150 ${urgencyStyle}`}>
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {isSensitive && Icon ? (
          <span className={`shrink-0 p-1 rounded ${ALERT_TYPE_COLORS[alert.alert_type]}`}>
            <Icon className="w-3.5 h-3.5" />
          </span>
        ) : (
          <span className={`shrink-0 px-1.5 py-0.5 rounded text-xs font-medium ${ALERT_TYPE_COLORS[alert.alert_type]}`}>
            {ALERT_TYPE_LABELS[alert.alert_type]}
          </span>
        )}
        {messageNode}
      </div>
      {canDismiss && onDismiss && DISMISSABLE_ALERT_TYPES.has(alert.alert_type) && (
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
