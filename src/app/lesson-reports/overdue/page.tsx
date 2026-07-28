'use client';

/**
 * 報告書督促画面
 *
 * URL: /lesson-reports/overdue
 *
 * 用途：授業日から N 日経過しても報告書が未提出 or 下書きのままの schedule_entry を一覧表示。
 *      室長が督促リストとして使う（誰にどのコマぶんが残っているか）。
 *
 * 表示:
 *  - 講師ごとにグルーピング → 残数を多い順
 *  - 行クリックで /lesson-reports/[scheduleEntryId] へ
 *  - 既に下書きがあれば「下書き継続」、無ければ「未提出」
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { AdminLayout } from '@/components/layouts';
import { Card, CardContent } from '@/components/ui';
import {
  ToastContainer,
  Loading,
  SelectShadcn as Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui';
import { useToast } from '@/hooks/useToast';
import { useAuth } from '@/contexts/AuthContext';
import { getOverdueReports, type OverdueReportTarget } from '@/lib/api/class-reports';
import { AlertTriangle, ChevronRight } from 'lucide-react';
import AccessDenied from '@/components/AccessDenied';
import { formatGradeLabel } from '@/lib/utils/gradeLabel';

export default function OverdueReportsPage() {
  const router = useRouter();
  const { profile, selectedSchoolId, getSelectedSchoolIds } = useAuth();
  const { toasts, removeToast, error: toastError } = useToast();

  const [targets, setTargets] = useState<OverdueReportTarget[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [threshold, setThreshold] = useState<number>(3);

  const isManager =
    profile?.role === 'admin' || profile?.role === 'manager' || profile?.role === 'owner';

  const load = useCallback(async () => {
    if (!profile) return;
    setIsLoading(true);
    try {
      const schoolIds =
        selectedSchoolId && selectedSchoolId !== 'all'
          ? [selectedSchoolId]
          : getSelectedSchoolIds();
      const data = await getOverdueReports(schoolIds, threshold);
      setTargets(data);
    } catch (e) {
      toastError(e instanceof Error ? e.message : '取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [profile, selectedSchoolId, getSelectedSchoolIds, toastError, threshold]);

  useEffect(() => {
    load();
  }, [load]);

  // 講師ごとにグルーピング
  const byTeacher = useMemo(() => {
    const map = new Map<string, { teacherName: string; entries: OverdueReportTarget[] }>();
    for (const t of targets) {
      if (!map.has(t.teacher_id)) {
        map.set(t.teacher_id, { teacherName: t.teacher_name, entries: [] });
      }
      map.get(t.teacher_id)!.entries.push(t);
    }
    // 残数の多い順
    return Array.from(map.entries()).sort(([, a], [, b]) => b.entries.length - a.entries.length);
  }, [targets]);

  if (!isManager) return <AccessDenied />;

  return (
    <AdminLayout documentTitle="授業報告書 督促一覧">
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">授業報告書 督促一覧</h1>
          <div className="flex items-center gap-2">
            <label className="text-sm text-text-muted">経過日数:</label>
            <Select value={String(threshold)} onValueChange={(v) => setThreshold(parseInt(v, 10))}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1日以上</SelectItem>
                <SelectItem value="3">3日以上</SelectItem>
                <SelectItem value="7">7日以上</SelectItem>
                <SelectItem value="14">14日以上</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <p className="text-sm text-text-muted">
          授業日から指定日数経過しても報告書が「未提出」または「下書き」のままのコマです。
          講師ごとにまとめて表示しているので、督促連絡の参考にしてください。
        </p>

        {isLoading ? (
          <Loading />
        ) : targets.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-text-muted">
              督促対象の報告書はありません
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {byTeacher.map(([teacherId, { teacherName, entries }]) => (
              <Card key={teacherId}>
                <CardContent className="p-0">
                  <div className="flex items-center gap-2 px-4 py-3 bg-warning-subtle border-b border-warning">
                    <AlertTriangle className="w-4 h-4 text-warning" />
                    <span className="font-semibold">{teacherName}</span>
                    <span className="text-sm text-warning">
                      未提出/下書き <strong>{entries.length}</strong> 件
                    </span>
                  </div>
                  <ul className="divide-y divide-gray-100">
                    {entries.map((t) => {
                      const overdueClass =
                        t.days_overdue >= 7
                          ? 'bg-danger-subtle text-danger'
                          : t.days_overdue >= 3
                            ? 'bg-warning-subtle text-warning'
                            : 'bg-surface text-text-body';
                      return (
                        <li
                          key={t.schedule_entry_id}
                          className="px-4 py-3 hover:bg-surface cursor-pointer flex items-center gap-3 active:scale-[0.98] transition-transform duration-150 ease-[var(--ease-out)]"
                          onClick={() => router.push(`/lesson-reports/${t.schedule_entry_id}`)}
                        >
                          <div className="w-24 flex-shrink-0">
                            <div className="text-sm font-semibold tabular-nums">{t.entry_date}</div>
                            <div className="text-xs text-text-muted">
                              {t.slot_number ? `${t.slot_number}限` : '-'}
                            </div>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium">
                              {t.student_name}{' '}
                              <span className="text-xs text-text-muted">
                                （{formatGradeLabel(t.student_grade)}）
                              </span>
                            </div>
                            <div className="text-xs text-text-muted mt-0.5">
                              {t.report_status === 'draft' ? '下書き保存中' : '未提出'}
                            </div>
                          </div>
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold flex-shrink-0 ${overdueClass}`}
                          >
                            {t.days_overdue}日経過
                          </span>
                          <ChevronRight className="w-4 h-4 text-text-faint flex-shrink-0" />
                        </li>
                      );
                    })}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
