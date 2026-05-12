'use client';

/**
 * SessionFeed — 教室長UI: 進行セッションの変更フィード
 *
 * 教室配下の生徒×テキストの直近セッションを時系列表示。
 * - スマートアラート: 学校進度追いつき / テスト直前 / 目標未設定
 * - 宿題未提出/遅刻のアラートハイライト
 * - クリック → 生徒進行表詳細へ遷移
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  Calendar,
  GraduationCap,
  MessageSquare,
  RefreshCw,
  Target,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import {
  getSessionFeed,
  getAlertSessionFeed,
  getSmartAlerts,
} from '@/lib/api/progress-sessions';
import type { SmartAlert } from '@/lib/api/progress-sessions';
import type { ProgressSessionWithDetails } from '@/types/database';

type Filter = 'all' | 'alerts';

interface Props {
  /** 外部から schoolIds を渡す場合。省略時は AuthContext から取得 */
  schoolIds?: string[];
}

export default function SessionFeed({ schoolIds: propSchoolIds }: Props) {
  const { schoolIds: allSchoolIds, selectedSchoolId } = useAuth();
  // propSchoolIds があればそれを使う。なければ選択中の教室。
  // 'all' の場合はデモ教室も含む全教室IDを使う（getSelectedSchoolIds はデモ除外するため使わない）
  const schoolIds = useMemo(() => {
    if (propSchoolIds) return propSchoolIds;
    if (selectedSchoolId === 'all' || !selectedSchoolId) return allSchoolIds;
    return [selectedSchoolId];
  }, [propSchoolIds, allSchoolIds, selectedSchoolId]);

  // schoolIds の参照安定化（中身が同じなら再生成しない）
  const schoolIdsKey = schoolIds.join(',');

  const [sessions, setSessions] = useState<ProgressSessionWithDetails[]>([]);
  const [smartAlerts, setSmartAlerts] = useState<SmartAlert[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [loading, setLoading] = useState(true);
  const [alertsExpanded, setAlertsExpanded] = useState(true);

  const load = useCallback(async () => {
    if (schoolIds.length === 0) {
      setSessions([]);
      setSmartAlerts([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [data, alerts] = await Promise.all([
        filter === 'alerts'
          ? getAlertSessionFeed(schoolIds)
          : getSessionFeed(schoolIds),
        getSmartAlerts(schoolIds),
      ]);
      setSessions(data);
      setSmartAlerts(alerts);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolIdsKey, filter]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      {/* スマートアラートボード */}
      {smartAlerts.length > 0 && (
        <SmartAlertBoard
          alerts={smartAlerts}
          expanded={alertsExpanded}
          onToggle={() => setAlertsExpanded((v) => !v)}
        />
      )}

      {/* フィルタバー */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          {([
            { key: 'all', label: 'すべて' },
            { key: 'alerts', label: '要注意のみ' },
          ] as const).map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                filter === f.key
                  ? 'bg-[#1e3a5f] text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50"
          title="更新"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* フィード */}
      {loading && sessions.length === 0 ? (
        <div className="py-12 text-center text-sm text-gray-400">読み込み中...</div>
      ) : sessions.length === 0 ? (
        <div className="py-12 text-center text-sm text-gray-400">
          {filter === 'alerts' ? '要注意のセッションはありません' : 'セッションがありません'}
        </div>
      ) : (
        <div className="space-y-2">
          {sessions.map(session => (
            <FeedCard key={session.id} session={session} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── フィードカード ───

function FeedCard({ session }: { session: ProgressSessionWithDetails }) {
  const hasIssue = session.homework_not_done || session.tardy;

  // student_textbook 経由で生徒名、テキスト名を取得
  const st = session.student_textbook;
  const studentName = st?.student
    ? `${st.student.last_name} ${st.student.first_name}`
    : '—';
  const studentId = st?.student?.id;
  const textbookName = st?.textbook?.name || '—';

  const content = (
    <div
      className={`rounded-xl border p-4 transition-colors hover:bg-gray-50 ${
        hasIssue
          ? 'border-2 border-amber-400 bg-amber-50/40'
          : 'border-gray-200 bg-white'
      }`}
    >
      {/* 上段: 生徒名 / 日付 / フラグ */}
      <div className="flex items-start justify-between mb-2">
        <div>
          <div className="text-sm font-semibold text-gray-900">{studentName}</div>
          <div className="text-xs text-gray-500">{textbookName}</div>
        </div>
        <div className="flex items-center gap-2 text-right">
          <div className="text-xs text-gray-500">
            {session.session_date?.replace(/-/g, '/')}
          </div>
          {session.teacher_name && (
            <div className="text-xs text-gray-400">{session.teacher_name}</div>
          )}
        </div>
      </div>

      {/* フラグ */}
      {hasIssue && (
        <div className="flex items-center gap-2 mb-2">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
          {session.homework_not_done && (
            <span className="px-1.5 py-0.5 text-[10px] bg-amber-200 text-amber-900 rounded font-medium">
              宿題未提出
            </span>
          )}
          {session.tardy && (
            <span className="px-1.5 py-0.5 text-[10px] bg-amber-200 text-amber-900 rounded font-medium">
              遅刻
            </span>
          )}
        </div>
      )}

      {/* 引継ぎ */}
      {session.handover && (
        <div className="flex items-start gap-1.5 mt-2">
          <MessageSquare className="w-3.5 h-3.5 text-gray-400 mt-0.5 shrink-0" />
          <p className="text-sm text-gray-700 line-clamp-2">{session.handover}</p>
        </div>
      )}
    </div>
  );

  if (studentId) {
    return (
      <Link href={`/students/${studentId}/progress`} className="block">
        {content}
      </Link>
    );
  }

  return content;
}

// ─── スマートアラートボード ───

const ALERT_CONFIG: Record<
  SmartAlert['type'],
  { icon: React.ReactNode; label: string }
> = {
  school_catching_up: {
    icon: <GraduationCap className="w-4 h-4" />,
    label: '学校進度に追いつかれている',
  },
  exam_soon: {
    icon: <Calendar className="w-4 h-4" />,
    label: 'テストが近い',
  },
  no_exam_goal: {
    icon: <Target className="w-4 h-4" />,
    label: '目標未設定',
  },
};

function SmartAlertBoard({
  alerts,
  expanded,
  onToggle,
}: {
  alerts: SmartAlert[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const urgentCount = alerts.filter((a) => a.severity === 'urgent').length;

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/50 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-amber-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600" />
          <span className="text-sm font-semibold text-gray-900">
            注意事項
          </span>
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-amber-200 text-amber-900">
            {alerts.length}件
          </span>
          {urgentCount > 0 && (
            <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-red-200 text-red-900">
              緊急 {urgentCount}
            </span>
          )}
        </div>
        <span className="text-xs text-gray-400">{expanded ? '閉じる' : '開く'}</span>
      </button>

      {expanded && (
        <div className="px-4 pb-3 space-y-1.5">
          {alerts.map((alert, i) => (
            <SmartAlertItem key={`${alert.type}-${alert.studentTextbookId}-${i}`} alert={alert} />
          ))}
        </div>
      )}
    </div>
  );
}

function SmartAlertItem({ alert }: { alert: SmartAlert }) {
  const config = ALERT_CONFIG[alert.type];
  const isUrgent = alert.severity === 'urgent';

  const content = (
    <div
      className={`flex items-start gap-3 px-3 py-2.5 rounded-lg transition-colors hover:bg-white ${
        isUrgent ? 'bg-red-50/60' : 'bg-white/60'
      }`}
    >
      <div
        className={`p-1.5 rounded shrink-0 mt-0.5 ${
          isUrgent
            ? 'bg-red-100 text-red-600'
            : 'bg-amber-100 text-amber-600'
        }`}
      >
        {config.icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-gray-900">
            {alert.studentName}
          </span>
          <span className="text-[10px] text-gray-400">{alert.textbookName}</span>
        </div>
        <p className="text-xs text-gray-600 mt-0.5">{alert.detail}</p>
      </div>
      <span
        className={`px-1.5 py-0.5 text-[9px] font-bold rounded shrink-0 ${
          isUrgent
            ? 'bg-red-200 text-red-800'
            : 'bg-amber-200 text-amber-800'
        }`}
      >
        {config.label}
      </span>
    </div>
  );

  return (
    <Link href={`/students/${alert.studentId}/progress`} className="block">
      {content}
    </Link>
  );
}
