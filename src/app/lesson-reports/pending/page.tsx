'use client';

/**
 * 報告書承認画面（室長用）
 *
 * URL: /lesson-reports/pending
 *
 * 用途：講師が提出 (status='submitted') した報告書を一覧表示し、
 *      室長が「承認」または「差し戻し」のアクションを行う。
 *
 * 表示:
 *  - 教室全体（複数校対応）の submitted 報告書を授業日順
 *  - 各行クリックで /lesson-reports/[scheduleEntryId] へ遷移して内容確認
 *  - 行内に「承認」「差し戻し」のクイックボタン
 *
 * 差し戻し時は理由をモーダルで入力。
 */

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AdminLayout } from '@/components/layouts';
import { Card, CardContent } from '@/components/ui';
import { Button } from '@/components/ui';
import {
  ToastContainer,
  Loading,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  Textarea,
} from '@/components/ui';
import { useToast } from '@/hooks/useToast';
import { useAuth } from '@/contexts/AuthContext';
import {
  getPendingReports,
  approveClassReport,
  rejectClassReport,
} from '@/lib/api/class-reports';
import type { ClassReport } from '@/types/class-report';
import { CheckCircle, XCircle, ChevronRight } from 'lucide-react';
import AccessDenied from '@/components/AccessDenied';

function gradeLabel(g: number): string {
  if (g <= 6) return `小${g}`;
  if (g <= 9) return `中${g - 6}`;
  return `高${g - 9}`;
}

export default function PendingReportsPage() {
  const router = useRouter();
  const { profile, selectedSchoolId, getSelectedSchoolIds } = useAuth();
  const { toasts, removeToast, success, error: toastError } = useToast();

  const [reports, setReports] = useState<ClassReport[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);

  // 差し戻しモーダル
  const [rejectTarget, setRejectTarget] = useState<ClassReport | null>(null);
  const [rejectReason, setRejectReason] = useState('');

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
      const data = await getPendingReports(schoolIds);
      setReports(data);
    } catch (e) {
      toastError(e instanceof Error ? e.message : '取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [profile, selectedSchoolId, getSelectedSchoolIds, toastError]);

  useEffect(() => {
    load();
  }, [load]);

  const handleApprove = async (report: ClassReport) => {
    if (!profile) return;
    if (!confirm(`「${report.student?.last_name} ${report.student?.first_name}」の報告書を承認します。よろしいですか？`)) return;
    setActingId(report.id);
    try {
      await approveClassReport(report.id, profile.id);
      success('承認しました');
      await load();
    } catch (e) {
      toastError(e instanceof Error ? e.message : '承認に失敗しました');
    } finally {
      setActingId(null);
    }
  };

  const submitReject = async () => {
    if (!rejectTarget || !profile) return;
    setActingId(rejectTarget.id);
    try {
      await rejectClassReport(rejectTarget.id, profile.id, rejectReason);
      success('差し戻しました');
      setRejectTarget(null);
      setRejectReason('');
      await load();
    } catch (e) {
      toastError(e instanceof Error ? e.message : '差し戻しに失敗しました');
    } finally {
      setActingId(null);
    }
  };

  if (!isManager) return <AccessDenied />;

  return (
    <AdminLayout>
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      <div className="max-w-5xl mx-auto p-4 space-y-4">
        <h1 className="text-2xl font-bold">授業報告書 承認待ち</h1>
        <p className="text-sm text-gray-600">
          講師から提出された報告書を確認し、承認 or 差し戻しを行ってください。
          承認すると保護者ポータルに公開されます。
        </p>

        {isLoading ? (
          <Loading />
        ) : reports.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-gray-500">
              承認待ちの報告書はありません
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {reports.map((r) => {
              const studentName = r.student
                ? `${r.student.last_name} ${r.student.first_name}`
                : r.student_id;
              const grade = r.student ? gradeLabel(r.student.grade) : '';
              const teacherName = r.teacher?.display_name || r.teacher?.email || '';
              const submittedAt = r.submitted_at
                ? new Date(r.submitted_at).toLocaleString('ja-JP')
                : '-';
              return (
                <Card key={r.id} className="hover:border-amber-300">
                  <CardContent className="p-3 flex items-center gap-3">
                    <button
                      type="button"
                      className="flex-1 flex items-center gap-3 text-left"
                      onClick={() => router.push(`/lesson-reports/${r.schedule_entry_id}`)}
                    >
                      <div className="w-24 flex-shrink-0">
                        <div className="text-sm font-bold tabular-nums">{r.lesson_date}</div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-bold">
                          {studentName}{' '}
                          <span className="text-xs text-gray-500 font-normal">（{grade}）</span>
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          講師: {teacherName} ・ 提出: {submittedAt}
                        </div>
                        {r.short_term_goal && (
                          <div className="text-xs text-gray-700 mt-1 truncate">
                            目標: {r.short_term_goal}
                          </div>
                        )}
                      </div>
                      <ChevronRight className="w-4 h-4 text-gray-400" />
                    </button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setRejectTarget(r);
                        setRejectReason('');
                      }}
                      disabled={actingId === r.id}
                    >
                      <XCircle className="w-4 h-4 mr-1" />
                      差し戻し
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => handleApprove(r)}
                      disabled={actingId === r.id}
                    >
                      <CheckCircle className="w-4 h-4 mr-1" />
                      承認
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* 差し戻しダイアログ */}
      <Dialog open={!!rejectTarget} onOpenChange={(v) => !v && setRejectTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>報告書を差し戻し</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm">
              {rejectTarget?.student
                ? `${rejectTarget.student.last_name} ${rejectTarget.student.first_name}`
                : ''}
              （{rejectTarget?.lesson_date}）の報告書を差し戻します。
            </p>
            <label className="text-xs font-semibold">差し戻し理由（任意）</label>
            <Textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="例：宿題の正答率を再確認してください"
              rows={4}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)}>
              キャンセル
            </Button>
            <Button onClick={submitReject} disabled={!!actingId}>
              差し戻す
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
