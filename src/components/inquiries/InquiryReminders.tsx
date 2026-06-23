'use client';

/**
 * 問合せリマインドボード。
 * 問合せ一覧ページのサマリーカード上に差し込む。
 * リマインドが 0 件なら null を返す（何も表示しない）。
 * コアの alerts.ts / alert_settings とは独立したベータ実装。
 */

import { useEffect, useRef, useState } from 'react';
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
  first_contact_overdue: { icon: Phone, label: '初回コンタクト未' },
  response_delay: { icon: Clock, label: '対応遅延' },
  material_unsent: { icon: Mail, label: '資料未発送' },
  trial_followup: { icon: AlertTriangle, label: '体験フォロー' },
};

/** severity ごとの色クラス */
const SEVERITY_DOT: Record<InquiryReminder['severity'], string> = {
  danger: 'bg-red-500',
  warning: 'bg-amber-400',
  info: 'bg-blue-400',
};

/** severity ごとの行ハイライト */
const SEVERITY_ROW: Record<InquiryReminder['severity'], string> = {
  danger: 'border-l-2 border-red-400 bg-red-50',
  warning: 'border-l-2 border-amber-400 bg-amber-50',
  info: 'border-l-2 border-blue-300 bg-blue-50/50',
};

/** severity 件数バッジの色 */
const SEVERITY_BADGE: Record<InquiryReminder['severity'], string> = {
  danger: 'bg-red-100 text-red-700',
  warning: 'bg-amber-100 text-amber-700',
  info: 'bg-blue-100 text-blue-700',
};

// ============================================================
// コンポーネント
// ============================================================

interface Props {
  /** 表示対象の school_id 配列 */
  schoolIds: string[];
  /**
   * 初回の取得が完了したら一度呼ばれる（0件でも呼ぶ）。
   * 親が「リマインドの読み込みが終わったか」を知り、一覧と同時に
   * 描画してレイアウトシフトを防ぐために使う。
   */
  onReady?: () => void;
}

export function InquiryReminders({ schoolIds, onReady }: Props): JSX.Element | null {
  const [reminders, setReminders] = useState<InquiryReminder[]>([]);
  /** 初回取得が完了したか（完了後は再取得中もボードを消さずちらつきを防ぐ） */
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

  // schoolIds が空なら即 null
  const hasSchools = schoolIds.length > 0;
  // 配列参照は毎レンダリング変わるので、文字列キーで effect の再実行を安定化する
  const schoolKey = schoolIds.join(',');

  // onReady は ref 経由で呼ぶ（識別子が変わっても effect を再実行させない）
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  useEffect(() => {
    if (!hasSchools) {
      setHasLoadedOnce(true);
      onReadyRef.current?.();
      return;
    }

    let cancelled = false;

    const load = async () => {
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
        if (!cancelled) {
          setHasLoadedOnce(true);
          onReadyRef.current?.();
        }
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [schoolKey, hasSchools]); // eslint-disable-line react-hooks/exhaustive-deps

  // schoolIds が空 → 表示不要
  if (!hasSchools) return null;

  // 初回ロード未完 → 何も表示しない（控えめ）。完了後は再取得中もボードを維持する。
  if (!hasLoadedOnce) return null;

  // リマインドなし → null（スペースを使わない）
  if (reminders.length === 0) return null;

  // ---- severity 別件数集計 ----
  const dangerCount = reminders.filter((r) => r.severity === 'danger').length;
  const warningCount = reminders.filter((r) => r.severity === 'warning').length;
  const infoCount = reminders.filter((r) => r.severity === 'info').length;

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
            <span
              className={`text-xs font-medium px-2 py-0.5 rounded-full ${SEVERITY_BADGE.danger}`}
            >
              緊急 {dangerCount}
            </span>
          )}
          {warningCount > 0 && (
            <span
              className={`text-xs font-medium px-2 py-0.5 rounded-full ${SEVERITY_BADGE.warning}`}
            >
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
