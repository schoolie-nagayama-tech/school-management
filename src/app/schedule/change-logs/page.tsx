'use client';

/**
 * 担当変更履歴ページ (/schedule/change-logs)
 *
 * schedule_change_logs を時系列降順で一覧。
 * 「いつ・誰が・どの生徒の担当を・どう変えたか」を監査用に確認できる。
 *
 * フィルタ:
 *  - 行動種別 (assign / reassign / transfer 等)
 *  - 期間
 *
 * 入口: 隠し公開（リンクは置かず URL 直打ち or 講師詳細・生徒詳細ページから将来リンク）。
 */

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { AdminLayout } from '@/components/layouts';
import { Card, CardContent, Button, Loading } from '@/components/ui';
import { useAuth } from '@/contexts/AuthContext';
import AccessDenied from '@/components/AccessDenied';
import {
  getScheduleChangeLogs,
  actionLabel,
  type ScheduleChangeLog,
  type ScheduleChangeAction,
} from '@/lib/api/schedule-change-logs';
import { RefreshCw, History, Filter } from 'lucide-react';

const ACTION_FILTER_GROUPS: Array<{ key: 'all' | ScheduleChangeAction; label: string }> = [
  { key: 'all', label: 'すべて' },
  { key: 'pattern_assign', label: '通塾日程割当' },
  { key: 'entry_assign', label: '一時割当' },
  { key: 'entry_reassign', label: '担当変更' },
  { key: 'transfer_create', label: '振替作成' },
  { key: 'transfer_revert', label: '振替取消' },
];

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function actionAccent(action: ScheduleChangeAction) {
  switch (action) {
    case 'pattern_assign':
      return 'bg-success-subtle text-success border-success/30';
    case 'entry_assign':
      return 'bg-info-subtle text-info border-info/30';
    case 'entry_reassign':
      return 'bg-info-subtle text-info border-info/30';
    case 'transfer_create':
      return 'bg-warning-subtle text-warning border-warning/30';
    case 'transfer_revert':
      return 'bg-gray-100 text-gray-600 border-gray-300';
    case 'pattern_unassign':
      return 'bg-danger-subtle text-danger border-danger/30';
    case 'entry_remove':
      return 'bg-danger-subtle text-danger border-danger/30';
    default:
      return 'bg-gray-100 text-gray-600';
  }
}

export default function ScheduleChangeLogsPage() {
  const { profile, selectedSchoolId, getSelectedSchoolIds } = useAuth();
  const [logs, setLogs] = useState<ScheduleChangeLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterAction, setFilterAction] = useState<'all' | ScheduleChangeAction>('all');

  const isManager =
    profile?.role === 'admin' || profile?.role === 'manager' || profile?.role === 'owner';

  const schoolId =
    selectedSchoolId && selectedSchoolId !== 'all'
      ? selectedSchoolId
      : getSelectedSchoolIds()[0] ?? null;

  const load = useCallback(async () => {
    if (!schoolId) return;
    setIsLoading(true);
    try {
      const list = await getScheduleChangeLogs({
        schoolId,
        actionTypes: filterAction === 'all' ? undefined : [filterAction],
        limit: 200,
      });
      setLogs(list);
    } finally {
      setIsLoading(false);
    }
  }, [schoolId, filterAction]);

  useEffect(() => {
    if (isManager) load();
  }, [isManager, load]);

  if (!isManager) return <AccessDenied />;

  return (
    <AdminLayout headerTitle="担当変更履歴">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <History className="w-6 h-6" />
              担当変更履歴
            </h1>
            <p className="text-sm text-text-muted mt-1">
              通塾日程の割当・担当変更・振替の操作ログを最新200件まで表示
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={isLoading}>
            <RefreshCw className={`w-3.5 h-3.5 mr-1 ${isLoading ? 'animate-spin' : ''}`} />
            再取得
          </Button>
        </div>

        <Card>
          <CardContent className="p-3 flex flex-wrap items-center gap-2">
            <Filter className="w-4 h-4 text-text-muted" />
            <span className="text-sm font-semibold">フィルタ:</span>
            <div className="flex gap-1 flex-wrap">
              {ACTION_FILTER_GROUPS.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setFilterAction(opt.key)}
                  className={`px-2 py-1 text-xs rounded border transition-colors ${
                    filterAction === opt.key
                      ? 'bg-info text-white border-info'
                      : 'bg-white text-text-muted border-border-default hover:bg-surface'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <span className="ml-auto text-xs text-text-muted">{logs.length} 件</span>
          </CardContent>
        </Card>

        {isLoading ? (
          <Loading />
        ) : logs.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-text-muted">
              <History className="w-8 h-8 mx-auto mb-2 opacity-30" />
              該当する変更履歴はありません
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <ul className="divide-y divide-border-subtle">
                {logs.map((log) => {
                  const studentName = log.student
                    ? `${log.student.last_name} ${log.student.first_name}`
                    : log.student_id ?? '—';
                  const before = log.before_teacher?.display_name ?? '—';
                  const after = log.after_teacher?.display_name ?? '—';
                  const actor = log.actor?.display_name ?? log.actor?.email ?? 'システム';
                  return (
                    <li key={log.id} className="px-4 py-3">
                      <div className="flex items-start gap-3 flex-wrap">
                        <span
                          className={`px-2 py-0.5 text-[10px] rounded border font-semibold flex-shrink-0 ${actionAccent(log.action_type)}`}
                        >
                          {actionLabel(log.action_type)}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm">
                            <Link
                              href={`/students/${log.student_id ?? ''}`}
                              className="font-semibold text-text-body hover:underline"
                            >
                              {studentName}
                            </Link>
                            <span className="mx-1.5 text-text-muted">：</span>
                            <span className="text-text-muted">{before}</span>
                            <span className="mx-1 text-text-muted">→</span>
                            <span className="font-semibold text-info">{after}</span>
                          </div>
                          {log.description && (
                            <div className="text-xs text-text-muted mt-0.5">{log.description}</div>
                          )}
                          <div className="text-[11px] text-text-faint mt-0.5">
                            {formatDateTime(log.created_at)} ／ {actor}
                            {log.affected_date && (
                              <>
                                <span className="mx-1">／</span>
                                対象: {log.affected_date}
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </AdminLayout>
  );
}
