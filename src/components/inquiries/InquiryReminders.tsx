'use client';

/**
 * 問合せリマインドボード。
 * 問合せ一覧ページのサマリーカード上に差し込む。
 * リマインドが 0 件なら null を返す（何も表示しない）。
 * コアの alerts.ts / alert_settings とは独立したベータ実装。
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Clock, Mail, Phone } from 'lucide-react';
import { getInquiries } from '@/lib/api/inquiries';
import { getContactedInquiryIds } from '@/lib/api/inquiries';
import {
  computeInquiryReminders,
  type InquiryReminder,
  type InquiryReminderKind,
} from '@/lib/utils/inquiryReminders';

// ============================================================
// 定数
// ============================================================

/** kind ごとのアイコンと表示ラベル */
const KIND_META: Record<
  InquiryReminderKind,
  { icon: React.ComponentType<{ className?: string }>; label: string }
> = {
  first_contact_overdue: { icon: Phone,         label: '初回コンタクト未' },
  response_delay:        { icon: Clock,          label: '対応遅延' },
  material_unsent:       { icon: Mail,           label: '資料未発送' },
  trial_followup:        { icon: AlertTriangle,  label: '体験フォロー' },
};

/** severity ごとの色クラス */
const SEVERITY_DOT: Record<InquiryReminder['severity'], string> = {
  danger:  'bg-red-500',
  warning: 'bg-amber-400',
  info:    'bg-blue-400',
};

/** severity ごとの行ハイライト */
const SEVERITY_ROW: Record<InquiryReminder['severity'], string> = {
  danger:  'border-l-2 border-red-400 bg-red-50',
  warning: 'border-l-2 border-amber-400 bg-amber-50',
  info:    'border-l-2 border-blue-300 bg-blue-50/50',
};

/** severity 件数バッジの色 */
const SEVERITY_BADGE: Record<InquiryReminder['severity'], string> = {
  danger:  'bg-red-100 text-red-700',
  warning: 'bg-amber-100 text-amber-700',
  info:    'bg-blue-100 text-blue-700',
};

// ============================================================
// コンポーネント
// ============================================================

interface Props {
  /** 表示対象の school_id 配列 */
  schoolIds: string[];
}

export function InquiryReminders({ schoolIds }: Props): JSX.Element | null {
  const [reminders, setReminders] = useState<InquiryReminder[]>([]);
  /** true: まだデータ取得中 */
  const [isLoading, setIsLoading] = useState(true);

  // schoolIds が空なら即 null
  const hasSchools = schoolIds.length > 0;

  useEffect(() => {
    if (!hasSchools) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    const load = async () => {
      setIsLoading(true);
      try {
        // inquiries（全ステータス）と contactedIds を並列取得
        const [inquiries, contactedIds] = await Promise.all([
          getInquiries(schoolIds), // フィルタなし: 全ステータス
          getContactedInquiryIds(schoolIds),
        ]);

        if (cancelled) return;

        const result = computeInquiryReminders(inquiries, contactedIds, new Date());
        setReminders(result);
      } catch {
        // リマインドは補助表示のため、エラー時は静かに空にする
        if (!cancelled) setReminders([]);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [schoolIds, hasSchools]);

  // schoolIds が空 → 表示不要
  if (!hasSchools) return null;

  // ロード中 → 何も表示しない（控えめ）
  if (isLoading) return null;

  // リマインドなし → null（スペースを使わない）
  if (reminders.length === 0) return null;

  // ---- severity 別件数集計 ----
  const dangerCount  = reminders.filter((r) => r.severity === 'danger').length;
  const warningCount = reminders.filter((r) => r.severity === 'warning').length;
  const infoCount    = reminders.filter((r) => r.severity === 'info').length;

  return (
    <div className="mb-6 bg-surface-raised border border-border rounded-xl overflow-hidden">
      {/* ヘッダー */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-500" />
          <span className="text-sm font-semibold text-text-heading">要対応リマインド</span>
        </div>
        {/* severity 別件数バッジ */}
        <div className="flex items-center gap-1.5">
          {dangerCount > 0 && (
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${SEVERITY_BADGE.danger}`}>
              緊急 {dangerCount}
            </span>
          )}
          {warningCount > 0 && (
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${SEVERITY_BADGE.warning}`}>
              注意 {warningCount}
            </span>
          )}
          {infoCount > 0 && (
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${SEVERITY_BADGE.info}`}>
              確認 {infoCount}
            </span>
          )}
        </div>
      </div>

      {/* リマインド一覧 */}
      <ul className="divide-y divide-border">
        {reminders.map((r, idx) => {
          const { icon: Icon, label } = KIND_META[r.kind];
          return (
            <li
              key={`${r.inquiryId}-${r.kind}-${idx}`}
              className={`flex items-center gap-3 px-4 py-2.5 ${SEVERITY_ROW[r.severity]}`}
            >
              {/* severity ドット */}
              <span
                className={`shrink-0 w-2 h-2 rounded-full ${SEVERITY_DOT[r.severity]}`}
                aria-hidden="true"
              />

              {/* kind アイコン */}
              <Icon className="shrink-0 w-4 h-4 text-text-muted" />

              {/* 種別ラベル（小） */}
              <span className="shrink-0 text-xs text-text-muted w-20 truncate">{label}</span>

              {/* 氏名 */}
              <span className="shrink-0 text-sm font-medium text-text-heading w-24 truncate">
                {r.name}
              </span>

              {/* メッセージ */}
              <span className="flex-1 text-sm text-text-body truncate">{r.message}</span>

              {/* 対応するリンク */}
              <Link
                href={`/admin/inquiries/${r.inquiryId}`}
                className="shrink-0 text-xs text-blue-600 hover:text-blue-800 hover:underline transition-colors duration-150"
                onClick={(e) => e.stopPropagation()}
              >
                対応する
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
