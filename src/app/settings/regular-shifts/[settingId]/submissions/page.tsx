'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AdminLayout } from '@/components/layouts';
import { Button, ToastContainer } from '@/components/ui';
import { useToast } from '@/hooks/useToast';
import { useConfirm } from '@/hooks/useConfirm';
import {
  getRegularShiftSetting,
  getRegularShiftSubmissions,
  getRegularShiftSubmissionWithSlots,
  getRegularShiftSlotSettings,
  getRegularShiftAttendanceCounts,
  getRegularShiftTeacherSlotCounts,
  allowRegularShiftEdit,
  resendRegularShiftEditEmail,
  deleteRegularShiftSubmission,
  toggleRegularShiftSeatChartEntered,
} from '@/lib/api/regular-shift';
import type {
  RegularShiftSetting,
  RegularShiftSubmission,
  RegularShiftSubmissionSlot,
  RegularShiftSlotSetting,
} from '@/types/regular-shift';
import { RegularSubmissionDetailMatrix } from '@/components/regular-shift/RegularSubmissionDetailMatrix';
import { RegularOperationsDashboard } from '@/components/regular-shift/RegularOperationsDashboard';
import { useRequirePermission } from '@/hooks/usePermissions';
import AccessDenied from '@/components/AccessDenied';

export default function RegularShiftSubmissionsPage() {
  const params = useParams();
  const settingId = params.settingId as string;
  const { toasts, removeToast, success, error } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const { hasPermission, isLoading: permissionLoading } = useRequirePermission(() => true);
  const [setting, setSetting] = useState<RegularShiftSetting | null>(null);
  const [submissions, setSubmissions] = useState<RegularShiftSubmission[]>([]);
  const [attendanceCounts, setAttendanceCounts] = useState<Record<string, number>>({});
  const [slotSettings, setSlotSettings] = useState<RegularShiftSlotSetting[]>([]);
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
    slots: RegularShiftSubmissionSlot[];
  } | null>(null);
  const [detailSlotSettings, setDetailSlotSettings] = useState<RegularShiftSlotSetting[]>([]);
  const openDetailRequestRef = useRef(0);

  const fetchData = useCallback(async () => {
    if (!settingId) return;
    setIsLoading(true);
    try {
      const [s, list, counts, slots, teachers] = await Promise.all([
        getRegularShiftSetting(settingId),
        getRegularShiftSubmissions(settingId),
        getRegularShiftAttendanceCounts(settingId),
        getRegularShiftSlotSettings(settingId),
        getRegularShiftTeacherSlotCounts(settingId),
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

  const handleDelete = async (sub: RegularShiftSubmission) => {
    if (!(await confirm({ title: '削除確認', description: `${sub.teacher_name} さんの提出を削除しますか？\nこの操作は取り消せません。`, confirmLabel: '削除', variant: 'danger' }))) return;
    setDeletingId(sub.id);
    try {
      await deleteRegularShiftSubmission(sub.id);
      success('提出を削除しました');
      if (detailSubmission?.id === sub.id) setDetailSubmission(null);
      fetchData();
    } catch (err) {
      error(err instanceof Error ? err.message : '削除に失敗しました');
    } finally {
      setDeletingId(null);
    }
  };

  const handleAllowEdit = async (sub: RegularShiftSubmission) => {
    setAllowingId(sub.id);
    try {
      const editToken = await allowRegularShiftEdit(sub.id);
      const editUrl =
        typeof window !== 'undefined'
          ? `${window.location.origin}/regular-shift/${settingId}/edit/${editToken}`
          : '';
      await navigator.clipboard.writeText(editUrl);
      success('修正許可を付与し、修正用URLをコピーしました。');
      fetchData();
    } catch (err) {
      error(err instanceof Error ? err.message : '修正許可の付与に失敗しました');
    } finally {
      setAllowingId(null);
    }
  };

  const handleResendEmail = async (sub: RegularShiftSubmission) => {
    setResendingId(sub.id);
    try {
      await resendRegularShiftEditEmail(sub.id);
      success('修正許可メールを再送しました');
    } catch (err) {
      error(err instanceof Error ? err.message : 'メールの再送に失敗しました');
    } finally {
      setResendingId(null);
    }
  };

  const handleToggleSeatChart = async (sub: RegularShiftSubmission) => {
    const newValue = !sub.seat_chart_entered;
    // 楽観的更新
    setSubmissions((prev) =>
      prev.map((s) => s.id === sub.id ? { ...s, seat_chart_entered: newValue } : s)
    );
    try {
      await toggleRegularShiftSeatChartEntered(sub.id, newValue);
    } catch (err) {
      // エラー時にロールバック
      setSubmissions((prev) =>
        prev.map((s) => s.id === sub.id ? { ...s, seat_chart_entered: !newValue } : s)
      );
      error(err instanceof Error ? err.message : '更新に失敗しました');
    }
  };

  const openDetail = async (sub: RegularShiftSubmission) => {
    const requestId = ++openDetailRequestRef.current;
    const [full, slotSettingsData] = await Promise.all([
      getRegularShiftSubmissionWithSlots(sub.id),
      getRegularShiftSlotSettings(settingId),
    ]);
    if (requestId !== openDetailRequestRef.current) return;
    if (!full) return;
    setDetailSlotSettings(slotSettingsData);
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

  if (permissionLoading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center min-h-[40vh]">
          <p className="text-[#4b5563]">読み込み中...</p>
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
    <AdminLayout headerTitle="通常シフト 提出一覧">
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      <div className="max-w-6xl">
        <Link
          href={`/settings/regular-shifts/${settingId}`}
          className="text-sm text-[#3b82f6] hover:underline mb-4 inline-block"
        >
          ← 設定に戻る
        </Link>
        {setting && (
          <h1 className="text-xl font-bold text-[#1f2937] mb-4">{setting.name} 提出一覧</h1>
        )}

        {/* Operations Dashboard */}
        {setting && (
          <div className="mb-6">
            <RegularOperationsDashboard
              setting={setting}
              slotSettings={slotSettings}
              counts={attendanceCounts}
              teacherSlotCounts={teacherSlotCounts}
            />
          </div>
        )}

        {isLoading ? (
          <p className="text-[#4b5563]">読み込み中...</p>
        ) : submissions.length === 0 ? (
          <div className="bg-white rounded-xl border border-[#e5e7eb] p-8 text-center text-[#4b5563]">
            まだ提出がありません。
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-[#e5e7eb] overflow-hidden">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-[#f3f4f6] border-b border-[#e5e7eb]">
                  <th className="px-4 py-3 text-left font-semibold text-[#1f2937]">講師名</th>
                  <th className="px-4 py-3 text-left font-semibold text-[#1f2937]">メール</th>
                  <th className="px-4 py-3 text-left font-semibold text-[#1f2937]">提出日時</th>
                  <th className="px-4 py-3 text-center font-semibold text-[#1f2937]">修正許可</th>
                  <th className="px-4 py-3 text-center font-semibold text-[#1f2937]">座席表反映</th>
                  <th className="px-4 py-3 text-right font-semibold text-[#1f2937]">操作</th>
                </tr>
              </thead>
              <tbody>
                {submissions.map((sub) => (
                  <tr key={sub.id} className="border-b border-[#e5e7eb]/60 hover:bg-[#f9fafb]">
                    <td className="px-4 py-3 font-medium text-[#1f2937]">{sub.teacher_name}</td>
                    <td className="px-4 py-3 text-[#4b5563]">{sub.teacher_email}</td>
                    <td className="px-4 py-3 text-[#4b5563]">{formatDate(sub.submitted_at)}</td>
                    <td className="px-4 py-3 text-center">
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
                    <td className="px-4 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={sub.seat_chart_entered}
                        onChange={() => handleToggleSeatChart(sub)}
                        className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                        title={sub.seat_chart_entered ? '座席表反映済み' : '未反映'}
                      />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => openDetail(sub)}
                          className="text-[#3b82f6] hover:underline text-sm"
                        >
                          詳細
                        </button>
                        <span className="text-[#e5e7eb]">|</span>
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
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={() => setDetailSubmission(null)}
          >
            <div
              className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-bold text-[#1f2937] mb-4">提出詳細</h3>
              <dl className="space-y-3 text-sm mb-6">
                <div>
                  <dt className="text-[#4b5563]">講師名</dt>
                  <dd className="font-medium">{detailSubmission.teacher_name}</dd>
                </div>
                <div>
                  <dt className="text-[#4b5563]">メール</dt>
                  <dd className="font-medium">{detailSubmission.teacher_email}</dd>
                </div>
                <div>
                  <dt className="text-[#4b5563]">提出日時</dt>
                  <dd className="font-medium">{formatDate(detailSubmission.submitted_at)}</dd>
                </div>
                <div>
                  <dt className="text-[#4b5563]">出勤可能コマ数</dt>
                  <dd className="font-medium">{detailSubmission.slots_count}コマ</dd>
                </div>
              </dl>

              <div className="mb-4">
                <h4 className="text-sm font-semibold text-[#1f2937] mb-2">出勤可能日時</h4>
                <p className="text-xs text-[#6b7280] mb-2">
                  ✓：出勤可能　空白：出勤不可　-：休校
                </p>
                <RegularSubmissionDetailMatrix
                  setting={setting}
                  slotSettings={detailSlotSettings}
                  submissionSlots={detailSubmission.slots}
                />
              </div>

              {detailSubmission.notes && (
                <div className="mb-6">
                  <p className="text-[#4b5563] text-sm mb-1">備考</p>
                  <p className="font-medium whitespace-pre-wrap text-sm bg-[#f9fafb] p-3 rounded-lg border border-[#e5e7eb]">
                    {detailSubmission.notes}
                  </p>
                </div>
              )}

              <div className="flex justify-end gap-2">
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
                  className="text-red-600 border-red-200 hover:bg-red-50"
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
