'use client';

import Link from 'next/link';
import type { Alert, AlertType } from '@/types/alerts';
import {
  ALERT_TYPE_LABELS,
  ALERT_TYPE_COLORS,
  DISMISSABLE_ALERT_TYPES,
  SENSITIVE_ALERT_TYPES,
} from '@/types/alerts';
import { Button } from '@/components/ui';
import { SUBJECT_LABELS } from '@/types/database';
import { TrendingDown, BookOpen, Clock, MessageCircle } from 'lucide-react';

/** マスク時にラベル横に出すアイコン（ネガティブ系アラート） */
export const SENSITIVE_ALERT_ICONS: Partial<
  Record<AlertType, React.ComponentType<{ className?: string }>>
> = {
  score_drop: TrendingDown,
  homework_not_done: BookOpen,
  tardy: Clock,
  interview_overdue: MessageCircle,
};

/** マスク時にラベル名を差し替える（"成績低下" → "成績"のように婉曲化） */
export const MASKED_ALERT_LABEL_OVERRIDES: Partial<Record<AlertType, string>> = {
  score_drop: '成績',
};

/** マスク時に表示する代替メッセージ。個人情報（点数や回数など）を含まない要素のみ返す */
export function getMaskedMessage(alert: Alert): string | null {
  if (alert.alert_type === 'score_drop' && alert.details?.subject) {
    // details.subject は 'science' 等の生コード。日本語の科目名で表示する
    return SUBJECT_LABELS[alert.details.subject] || alert.details.subject;
  }
  return null;
}

interface AlertItemProps {
  alert: Alert;
  onDismiss?: (alert: Alert) => void;
  canDismiss?: boolean;
  /** 講師画面：ネガティブ情報の具体メッセージを非表示にしアイコンを併記 */
  masked?: boolean;
  /**
   * 種類ラベル・枠線を省いてメッセージ＋対応済みだけを出す軽量表示。
   * 系列（alert_type）ごとのセクション内で使うと、行頭のラベルが重複しないため
   * すっきり見せられる。severity の色はセクション/行側で表現する。
   */
  hideLabel?: boolean;
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
    // 面談未更新は「記録を見る」より「これから面談する」導線なので、
    // 記録一覧タブではなく面談ワークスペース（申し送り・タスク・成績・進行表が揃う画面）へ送る
    case 'interview_overdue':
      return `/interview?studentId=${sid}`;
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
    case 'schedule_change_unapplied':
      return `/students/${sid}/schedule`;
    default:
      return null;
  }
}

export function AlertItem({
  alert,
  onDismiss,
  canDismiss = false,
  masked = false,
  hideLabel = false,
}: AlertItemProps) {
  const urgencyStyle = getAlertUrgencyStyle(alert);
  const editHref = getEditHref(alert);
  const isSensitive = masked && SENSITIVE_ALERT_TYPES.has(alert.alert_type);

  // マスク時はネガティブ系の具体メッセージを非表示。科目名など個人情報ではない要素は別途出す
  const maskedMessage = isSensitive ? getMaskedMessage(alert) : null;
  const messageNode = isSensitive ? (
    maskedMessage ? (
      <span className="text-xs text-gray-700 truncate">{maskedMessage}</span>
    ) : null
  ) : editHref ? (
    <Link
      href={editHref}
      className="text-xs text-gray-700 hover:text-[#1e3a5f] hover:underline truncate"
      title={
        alert.alert_type === 'interview_overdue' ? '面談ワークスペースへ移動' : '編集ページへ移動'
      }
    >
      {alert.message}
    </Link>
  ) : (
    <span className="text-xs text-gray-700 truncate">{alert.message}</span>
  );

  // マスク時のネガティブ系はラベル横にアイコンを併記
  const Icon = isSensitive ? SENSITIVE_ALERT_ICONS[alert.alert_type] : null;
  // マスク時はラベルを婉曲表現に差し替え（score_drop → "成績"）
  const displayLabel =
    (isSensitive && MASKED_ALERT_LABEL_OVERRIDES[alert.alert_type]) ||
    ALERT_TYPE_LABELS[alert.alert_type];

  // 系列セクション内での軽量表示：ラベル・枠線を省き、メッセージ＋対応済みだけ出す
  if (hideLabel) {
    return (
      <div className="flex items-center justify-between gap-2 min-w-0">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {isSensitive && Icon && <Icon className="w-3 h-3 shrink-0 text-gray-500" />}
          {messageNode ?? <span className="text-xs text-gray-400">—</span>}
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

  return (
    <div
      className={`flex items-center justify-between gap-2 py-1 px-2 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors duration-150 ${urgencyStyle}`}
    >
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <span
          className={`shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium ${ALERT_TYPE_COLORS[alert.alert_type]}`}
        >
          {isSensitive && Icon && <Icon className="w-3 h-3" />}
          {displayLabel}
        </span>
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
