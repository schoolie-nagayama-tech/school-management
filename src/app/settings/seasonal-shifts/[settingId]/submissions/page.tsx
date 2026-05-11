'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AdminLayout } from '@/components/layouts';
import { Button, ToastContainer } from '@/components/ui';
import { useToast } from '@/hooks/useToast';
import { useConfirm } from '@/hooks/useConfirm';
import {
  getSeasonalShiftSetting,
  getSeasonalShiftSubmissions,
  getSeasonalShiftSubmissionWithSlots,
  getSeasonalShiftSlotSettings,
  getSeasonalShiftAttendanceCounts,
  getSeasonalShiftTeacherSlotCounts,
  allowSeasonalShiftEdit,
  resendSeasonalShiftEditEmail,
  deleteSeasonalShiftSubmission,
  updateSeasonalShiftSeatChartEntered,
} from '@/lib/api/seasonal-shift';
import type {
  SeasonalShiftSetting,
  SeasonalShiftSubmission,
  SeasonalShiftSubmissionSlot,
  SlotSetting,
} from '@/types/seasonal-shift';
import { SubmissionDetailMatrix } from '@/components/seasonal-shift/SubmissionDetailMatrix';
import { OperationsDashboard } from '@/components/seasonal-shift/OperationsDashboard';
import { exportProgressToPDF } from '@/lib/utils/pdfExport';
import { useRequirePermission } from '@/hooks/usePermissions';
import AccessDenied from '@/components/AccessDenied';

export default function SeasonalShiftSubmissionsPage() {
  const params = useParams();
  const settingId = params.settingId as string;
  const { toasts, removeToast, success, error } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  // 申込画面（提出一覧）はログイン済みなら誰でもアクセス可能
  const { hasPermission, isLoading: permissionLoading } = useRequirePermission(() => true);
  const [setting, setSetting] = useState<SeasonalShiftSetting | null>(null);
  const [submissions, setSubmissions] = useState<SeasonalShiftSubmission[]>([]);
  const [attendanceCounts, setAttendanceCounts] = useState<Record<string, number>>({});
  const [slotSettings, setSlotSettings] = useState<SlotSetting[]>([]);
  const [teacherSlotCounts, setTeacherSlotCounts] = useState<
    { teacher_name: string; teacher_email: string; count: number }[]
  >([]);
  const [isLoading, setIsLoading] = useState(true);
  const [allowingId, setAllowingId] = useState<string | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [detailSubmission, setDetailSubmission] = useState<{
    id: string;
    teacher_name: string;
    teacher_email: string;
    submitted_at: string;
    notes: string;
    slots_count: number;
    allow_edit: boolean;
    slots: SeasonalShiftSubmissionSlot[];
  } | null>(null);
  const [detailSlotSettings, setDetailSlotSettings] = useState<SlotSetting[]>([]);
  const [pdfExportAfterOpen, setPdfExportAfterOpen] = useState<string | null>(null);
  const [updatingSeatChartId, setUpdatingSeatChartId] = useState<string | null>(null);
  // 連続クリック時の競合防止用リクエストID
  const openDetailRequestRef = useRef(0);

  const fetchData = useCallback(async () => {
    if (!settingId) return;
    setIsLoading(true);
    try {
      const [s, list, counts, slots, teachers] = await Promise.all([
        getSeasonalShiftSetting(settingId),
        getSeasonalShiftSubmissions(settingId),
        getSeasonalShiftAttendanceCounts(settingId),
        getSeasonalShiftSlotSettings(settingId),
        getSeasonalShiftTeacherSlotCounts(settingId),
      ]);
      setSetting(s ?? null);
      setSubmissions(list);
      setAttendanceCounts(counts);
      setSlotSettings(slots);
      setTeacherSlotCounts(teachers);
    } catch (err) {
      console.error(err);
      error(err instanceof Error ? err.message : '取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [settingId, error]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleDelete = async (sub: SeasonalShiftSubmission) => {
    if (!(await confirm({ title: '削除確認', description: `${sub.teacher_name} さんの提出を削除しますか？\nこの操作は取り消せません。`, confirmLabel: '削除', variant: 'danger' }))) return;
    setDeletingId(sub.id);
    try {
      await deleteSeasonalShiftSubmission(sub.id);
      success('提出を削除しました');
      if (detailSubmission?.id === sub.id) setDetailSubmission(null);
      fetchData();
    } catch (err) {
      error(err instanceof Error ? err.message : '削除に失敗しました');
    } finally {
      setDeletingId(null);
    }
  };

  const handleAllowEdit = async (sub: SeasonalShiftSubmission) => {
    setAllowingId(sub.id);
    try {
      const editToken = await allowSeasonalShiftEdit(sub.id);
      const editUrl =
        typeof window !== 'undefined'
          ? `${window.location.origin}/seasonal-shift/${settingId}/edit/${editToken}`
          : '';
      await navigator.clipboard.writeText(editUrl);
      success('修正許可を付与し、講師宛にメールを送信しました。修正用URLもコピーしました。');
      fetchData();
    } catch (err) {
      error(err instanceof Error ? err.message : '修正許可の付与に失敗しました');
    } finally {
      setAllowingId(null);
    }
  };

  const handleResendEmail = async (sub: SeasonalShiftSubmission) => {
    setResendingId(sub.id);
    try {
      await resendSeasonalShiftEditEmail(sub.id);
      success('修正許可メールを再送しました');
    } catch (err) {
      error(err instanceof Error ? err.message : 'メールの再送に失敗しました');
    } finally {
      setResendingId(null);
    }
  };

  const handleSeatChartToggle = async (sub: SeasonalShiftSubmission) => {
    const next = !(sub.seat_chart_entered ?? false);
    setUpdatingSeatChartId(sub.id);
    try {
      await updateSeasonalShiftSeatChartEntered(sub.id, next);
      setSubmissions((prev) =>
        prev.map((s) => (s.id === sub.id ? { ...s, seat_chart_entered: next } : s))
      );
      success(next ? '座席表入力を入力済みにしました' : '座席表入力を未入力にしました');
    } catch (err) {
      error(err instanceof Error ? err.message : '座席表入力の更新に失敗しました');
    } finally {
      setUpdatingSeatChartId(null);
    }
  };

  const openDetail = async (sub: SeasonalShiftSubmission) => {
    const requestId = ++openDetailRequestRef.current;
    const [full, slotSettings] = await Promise.all([
      getSeasonalShiftSubmissionWithSlots(sub.id),
      getSeasonalShiftSlotSettings(settingId),
    ]);
    // より新しいリクエストが来ていた場合は古い結果を破棄
    if (requestId !== openDetailRequestRef.current) return;
    if (!full) return;
    setDetailSlotSettings(slotSettings);
    setDetailSubmission({
      id: full.id,
      teacher_name: full.teacher_name,
      teacher_email: full.teacher_email,
      submitted_at: full.submitted_at,
      notes: full.notes,
      slots_count: full.slots?.filter((s) => s.available).length ?? 0,
      allow_edit: full.allow_edit,
      slots: full.slots ?? [],
    });
  };

  const formatDate = (d: string) => {
    const x = new Date(d);
    return `${x.getFullYear()}/${x.getMonth() + 1}/${x.getDate()} ${x.getHours()}:${String(x.getMinutes()).padStart(2, '0')}`;
  };

  const handleExportPDF = async () => {
    if (!detailSubmission) return;
    try {
      const dateStr = new Date().toISOString().slice(0, 10);
      const safeName = detailSubmission.teacher_name.replace(/[/\\?%*:|"]/g, '_');
      await exportProgressToPDF(
        'submission-detail-pdf-content',
        `シフト提出_${setting?.name ?? '講習'}_${safeName}_${dateStr}.pdf`,
        { fitToPage: true, orientation: 'portrait', expandScrollable: true }
      );
      success('PDFをダウンロードしました');
    } catch (e) {
      error(e instanceof Error ? e.message : 'PDFの出力に失敗しました');
    }
  };

  const handleExportPDFFromList = async (sub: SeasonalShiftSubmission) => {
    const requestId = ++openDetailRequestRef.current;
    const [full, slotSettings] = await Promise.all([
      getSeasonalShiftSubmissionWithSlots(sub.id),
      getSeasonalShiftSlotSettings(settingId),
    ]);
    if (requestId !== openDetailRequestRef.current) return;
    if (!full) return;
    setDetailSlotSettings(slotSettings);
    setDetailSubmission({
      id: full.id,
      teacher_name: full.teacher_name,
      teacher_email: full.teacher_email,
      submitted_at: full.submitted_at,
      notes: full.notes,
      slots_count: full.slots?.filter((s) => s.available).length ?? 0,
      allow_edit: full.allow_edit,
      slots: full.slots ?? [],
    });
    setPdfExportAfterOpen(full.id);
  };

  useEffect(() => {
    if (!detailSubmission || !pdfExportAfterOpen || detailSubmission.id !== pdfExportAfterOpen) return;
    const timer = setTimeout(async () => {
      try {
        const dateStr = new Date().toISOString().slice(0, 10);
        const safeName = detailSubmission.teacher_name.replace(/[/\\?%*:|"]/g, '_');
        await exportProgressToPDF(
          'submission-detail-pdf-content',
          `シフト提出_${setting?.name ?? '講習'}_${safeName}_${dateStr}.pdf`,
          { fitToPage: true, orientation: 'portrait', expandScrollable: true }
        );
        success('PDFをダウンロードしました');
      } catch (e) {
        error(e instanceof Error ? e.message : 'PDFの出力に失敗しました');
      }
      setPdfExportAfterOpen(null);
    }, 400);
    return () => clearTimeout(timer);
  }, [detailSubmission, pdfExportAfterOpen, setting?.name, success, error]);

  if (permissionLoading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center min-h-[40vh]">
          <p className="text-text-body">読み込み中...</p>
        </div>
      </AdminLayout>
    );
  }
  if (!hasPermission) {
    return (
      <AdminLayout>
        <AccessDenied />
      </AdminLayout>
    );
  }

  return (
    <AdminLayout headerTitle="講習シフト 提出一覧">
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      <div className="max-w-[1600px]">
        <Link
          href={`/settings/seasonal-shifts/${settingId}`}
          className="text-sm text-info hover:underline mb-4 inline-block"
        >
          ← 設定に戻る
        </Link>
        {setting && (
          <h1 className="text-xl font-bold text-text-heading mb-4">{setting.name} 提出一覧</h1>
        )}

        {/* 運営判断用ダッシュボード（アコーディオン） */}
        {setting && (
          <div className="mb-6">
            <OperationsDashboard
              setting={setting}
              slotSettings={slotSettings}
              counts={attendanceCounts}
              teacherSlotCounts={teacherSlotCounts}
            />
          </div>
        )}

        {isLoading ? (
          <p className="text-text-body">読み込み中...</p>
        ) : submissions.length === 0 ? (
          <div className="bg-surface-raised rounded-xl border border-border p-8 text-text-dangeraintenter text-text-body">
            まだ提出がありません。
          </div>
        ) : (
          <div className="bg-surface-raised rounded-xl border border-border overflow-hidden">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-surface-hover border-infoorderorder border-border">
                  <th className="px-4 py-3 text-left font-semibold text-text-heading">講師名</th>
                  <th className="px-4 py-3 text-left font-semibold text-text-heading">メール</th>
                  <th className="px-4 py-3 text-left font-semibold text-text-heading">提出日時</th>
                  <th className="px-4 py-3 text-text-dangeraintenter font-semibold text-text-heading">修正許可</th>
                  <th className="px-4 py-3 text-text-dangeraintenter font-semibold text-text-heading">座席表入力</th>
                  <th className="px-4 py-3 text-right font-semibold text-text-heading">操作</th>
                </tr>
              </thead>
              <tbody>
                {submissions.map((sub) => (
                  <tr key={sub.id} className="border-infoorderorder border-border/60 hover:bg-surface transition-colors duration-150">
                    <td className="px-4 py-3 font-medium text-text-heading">{sub.teacher_name}</td>
                    <td className="px-4 py-3 text-text-body">{sub.teacher_email}</td>
                    <td className="px-4 py-3 text-text-body">{formatDate(sub.submitted_at)}</td>
                    <td className="px-4 py-3 text-text-dangeraintenter">
                      {sub.allow_edit ? (
                        <span className="flex items-center justify-center gap-2">
                          <span className="text-green-600 text-xs">許可済</span>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={resendingId === sub.id || !sub.teacher_email}
                            onClick={() => handleResendEmail(sub)}
                            title={
                              !sub.teacher_email
                                ? 'メールアドレス未登録のため再送できません'
                                : '修正許可メールを再送'
                            }
                          >
                            {resendingId === sub.id ? '送信中...' : 'メール再送'}
                          </Button>
                        </span>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={allowingId === sub.id}
                          onClick={() => handleAllowEdit(sub)}
                        >
                          {allowingId === sub.id ? '処理中...' : '修正許可'}
                        </Button>
                      )}
                    </td>
                    <td className="px-4 py-3 text-text-dangeraintenter">
                      <label className="inline-flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={sub.seat_chart_entered ?? false}
                          disabled={updatingSeatChartId === sub.id}
                          onChange={() => handleSeatChartToggle(sub)}
                          className="w-4 h-4 rounded border-border text-ink focus:ring-ink"
                        />
                        <span className="text-sm text-text-body">
                          {updatingSeatChartId === sub.id ? '更新中...' : sub.seat_chart_entered ? '入力済' : '未入力'}
                        </span>
                      </label>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => handleExportPDFFromList(sub)}
                          className="text-text-muted hover:text-text-heading hover:underline text-sm"
                        >
                          PDF
                        </button>
                        <span className="text-border">|</span>
                        <button
                          type="button"
                          onClick={() => openDetail(sub)}
                          className="text-info hover:underline text-sm"
                        >
                          詳細
                        </button>
                        <span className="text-border">|</span>
                        <button
                          type="button"
                          onClick={() => handleDelete(sub)}
                          disabled={deletingId === sub.id}
                          className="text-red-600 hover:underline text-sm disabled:opacity-50"
                        >
                          {deletingId === sub.id ? '削除中...' : '削除'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {detailSubmission && setting && (
          <div
            className="fixed inset-0 bg-surfacelack/50 flex items-center justify-center z-50 p-4"
            onClick={() => setDetailSubmission(null)}
          >
            <div
              id="submission-detail-pdf-content"
              className="bg-surface-raised rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-bold text-text-heading mb-4">提出詳細</h3>
              <dl className="space-y-3 text-sm mb-6">
                <div>
                  <dt className="text-text-body">講師名</dt>
                  <dd className="font-medium">{detailSubmission.teacher_name}</dd>
                </div>
                <div>
                  <dt className="text-text-body">メール</dt>
                  <dd className="font-medium">{detailSubmission.teacher_email}</dd>
                </div>
                <div>
                  <dt className="text-text-body">提出日時</dt>
                  <dd className="font-medium">{formatDate(detailSubmission.submitted_at)}</dd>
                </div>
                <div>
                  <dt className="text-text-body">出勤可能コマ数</dt>
                  <dd className="font-medium">{detailSubmission.slots_count}コマ</dd>
                </div>
              </dl>

              <div className="mb-4">
                <h4 className="text-sm font-semibold text-text-heading mb-2">出勤可能日時</h4>
                <p className="text-xs text-text-muted mb-2">
                  ✓：出勤可能　空白：出勤不可　-：休校
                </p>
                <SubmissionDetailMatrix
                  setting={setting}
                  slotSettings={detailSlotSettings}
                  submissionSlots={detailSubmission.slots}
                />
              </div>

              {detailSubmission.notes && (
                <div className="mb-6">
                  <p className="text-text-body text-sm mb-1">備考</p>
                  <p className="font-medium whitespace-pre-wrap text-sm bg-surface p-3 rounded-lg border border-border">
                    {detailSubmission.notes}
                  </p>
                </div>
              )}

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={handleExportPDF}>
                  PDF出力
                </Button>
                {!detailSubmission.allow_edit ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={allowingId === detailSubmission.id}
                    onClick={() => {
                      const sub = submissions.find((s) => s.id === detailSubmission.id);
                      if (sub) handleAllowEdit(sub);
                    }}
                  >
                    {allowingId === detailSubmission.id ? '処理中...' : '修正を許可する'}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={
                      resendingId === detailSubmission.id || !detailSubmission.teacher_email
                    }
                    onClick={() => {
                      const sub = submissions.find((s) => s.id === detailSubmission.id);
                      if (sub) handleResendEmail(sub);
                    }}
                    title={
                      !detailSubmission.teacher_email ? 'メールアドレス未登録' : '修正許可メールを再送'
                    }
                  >
                    {resendingId === detailSubmission.id ? '送信中...' : 'メール再送'}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  disabled={deletingId === detailSubmission.id}
                  onClick={() => {
                    const sub = submissions.find((s) => s.id === detailSubmission.id);
                    if (sub) handleDelete(sub);
                  }}
                  className="text-red-600 border-red-200 hover:bg-red-50 transition-colors duration-150"
                >
                  {deletingId === detailSubmission.id ? '削除中...' : '削除'}
                </Button>
                <Button type="button" variant="outline" onClick={() => setDetailSubmission(null)}>
                  閉じる
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
      {ConfirmDialog}
    </AdminLayout>
  );
}
