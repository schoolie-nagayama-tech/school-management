'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { AdminLayout } from '@/components/layouts';
import { Button, ToastContainer, Loading } from '@/components/ui';
import { ChevronLeft } from 'lucide-react';
import { getMogiPeriods, deleteMogiPeriod, getMogiResponseCount } from '@/lib/api/mogi';
import { archivePeriod, unarchivePeriod } from '@/lib/api/form-periods';
import { MogiPeriodEditor } from '@/components/forms/mogi/MogiPeriodEditor';
import { useToast } from '@/hooks/useToast';
import { useConfirm } from '@/hooks/useConfirm';
import type { MogiPeriod } from '@/types/forms/mogi';
import { getDefaultSchoolId } from '@/lib/api/schools';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';
import { getFormPeriodStatus } from '@/lib/utils/formPeriodStatus';

export default function MogiSettingsPage() {
  const [periods, setPeriods] = useState<MogiPeriod[]>([]);
  const [responseCounts, setResponseCounts] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingPeriod, setEditingPeriod] = useState<MogiPeriod | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const { toasts, removeToast, success, error } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();

  const fetchPeriods = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage('');
    try {
      const schoolId = getDefaultSchoolId();
      const data = await getMogiPeriods(schoolId, showArchived);
      setPeriods(data);

      // 各期間の回答数を取得
      const counts: Record<string, number> = {};
      await Promise.all(
        data.map(async (period) => {
          try {
            const count = await getMogiResponseCount(schoolId, period.period_key);
            counts[period.id] = count;
          } catch (err) {
            console.error(`Error fetching response count for ${period.period_key}:`, err);
            counts[period.id] = 0;
          }
        })
      );
      setResponseCounts(counts);
    } catch (error) {
      console.error('Error fetching mogi periods:', error);
      setErrorMessage(getUserErrorMessage(error, '期間一覧の取得に失敗しました'));
    } finally {
      setIsLoading(false);
    }
  }, [showArchived]);

  useEffect(() => {
    fetchPeriods();
  }, [fetchPeriods]);

  const formatDateRange = (start: string | null, end: string | null) => {
    if (!start || !end) return '-';
    const startDate = new Date(start);
    const endDate = new Date(end);
    return `${startDate.getMonth() + 1}/${startDate.getDate()}〜${endDate.getMonth() + 1}/${endDate.getDate()}`;
  };

  // 期間ステータスの取得
  const getPeriodStatus = getFormPeriodStatus;

  const activePeriods = periods.filter((p) => !p.is_archived);
  const archivedPeriods = periods.filter((p) => p.is_archived);

  // 期間削除
  const handleDelete = async (periodId: string, periodTitle: string) => {
    if (
      !(await confirm({
        title: '削除確認',
        description: `「${periodTitle}」を削除してもよろしいですか？`,
        confirmLabel: '削除',
        variant: 'danger',
      }))
    )
      return;
    try {
      setIsSubmitting(true);
      await deleteMogiPeriod(periodId);
      await fetchPeriods();
      success('期間を削除しました');
    } catch (err) {
      console.error('Error deleting period:', err);
      error(getUserErrorMessage(err, '期間の削除に失敗しました'));
    } finally {
      setIsSubmitting(false);
    }
  };

  // 期間アーカイブ
  const handleArchivePeriod = async (period: MogiPeriod) => {
    if (
      !(await confirm({
        title: 'アーカイブ確認',
        description: `「${period.title}」をアーカイブしますか？\n\nこの期間の全ての回答もアーカイブされます。`,
        confirmLabel: 'アーカイブ',
        variant: 'warning',
      }))
    ) {
      return;
    }

    try {
      setIsSubmitting(true);
      const schoolId = getDefaultSchoolId();
      const result = await archivePeriod(period.id, schoolId, 'mogi', period.period_key);
      await fetchPeriods();
      success(`アーカイブしました（回答${result.responsesArchived}件を含む）`);
    } catch (err) {
      console.error('Error archiving period:', err);
      error(getUserErrorMessage(err, 'アーカイブに失敗しました'));
    } finally {
      setIsSubmitting(false);
    }
  };

  // 期間アーカイブ解除
  const handleUnarchivePeriod = async (period: MogiPeriod) => {
    try {
      setIsSubmitting(true);
      const schoolId = getDefaultSchoolId();
      const result = await unarchivePeriod(period.id, schoolId, 'mogi', period.period_key);
      await fetchPeriods();
      success(`アーカイブを解除しました（回答${result.responsesUnarchived}件を含む）`);
    } catch (err) {
      console.error('Error unarchiving period:', err);
      error(getUserErrorMessage(err, 'アーカイブ解除に失敗しました'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div>
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      <AdminLayout headerTitle="Vもぎ申込 設定">
        <div className="mb-4">
          <Link
            href="/settings"
            className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text-heading transition-colors duration-150"
          >
            <ChevronLeft className="w-4 h-4" />
            設定に戻る
          </Link>
        </div>
        {errorMessage && (
          <div className="mb-4 p-4 bg-danger/20 border border-danger rounded-lg">
            <p className="text-sm text-danger">{errorMessage}</p>
          </div>
        )}

        <div className="bg-surface-raised rounded-xl border border-border p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-bold text-text-heading">期間一覧</h2>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showArchived}
                  onChange={(e) => setShowArchived(e.target.checked)}
                  className="w-4 h-4 text-info border-border rounded focus:ring-primary cursor-pointer"
                />
                <span className="text-sm text-text-heading">
                  アーカイブ済みを表示
                  {archivedPeriods.length > 0 && (
                    <span className="ml-1 text-text-body/60">({archivedPeriods.length}件)</span>
                  )}
                </span>
              </label>
              <button
                onClick={() => {
                  setEditingPeriod(null);
                  setIsEditorOpen(true);
                }}
                className="px-4 py-2 bg-info text-white font-medium rounded-lg hover:bg-info/80 transition-colors duration-150"
              >
                新規作成
              </button>
            </div>
          </div>

          {isLoading ? (
            <Loading size="md" />
          ) : periods.length === 0 ? (
            <div className="text-text-dangeraintenter py-8 text-text-body">
              期間がありません。右上の「新規作成」ボタンから追加してください。
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse border border-border text-sm">
                <thead>
                  <tr className="bg-surface-hover">
                    <th className="border border-border px-4 py-3 text-left">期間</th>
                    <th className="border border-border px-4 py-3 text-left">タイトル</th>
                    <th className="border border-border px-4 py-3 text-left">公開期間</th>
                    <th className="border border-border px-4 py-3 text-left">状態</th>
                    <th className="border border-border px-4 py-3 text-left">回答数</th>
                    <th className="border border-border px-4 py-3 text-left">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {activePeriods.map((period) => (
                    <tr key={period.id} className="table-row-hover">
                      <td className="border border-border px-4 py-3">{period.period_key}</td>
                      <td className="border border-border px-4 py-3">{period.title}</td>
                      <td className="border border-border px-4 py-3">
                        {formatDateRange(period.publish_start, period.publish_end)}
                      </td>
                      <td className="border border-border px-4 py-3">
                        {(() => {
                          const status = getPeriodStatus(period);
                          const statusColorClass =
                            status.color === 'green'
                              ? 'bg-green-100 text-green-800'
                              : status.color === 'yellow'
                                ? 'bg-yellow-100 text-yellow-800'
                                : 'bg-gray-100 text-gray-800';
                          return (
                            <span
                              className={`px-2 py-1 rounded text-xs font-medium ${statusColorClass}`}
                            >
                              {status.label}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="border border-border px-4 py-3">
                        {responseCounts[period.id] ?? '-'}件
                      </td>
                      <td className="border border-border px-4 py-3">
                        <div className="flex gap-2">
                          <Button
                            onClick={() => {
                              setEditingPeriod(period);
                              setIsEditorOpen(true);
                            }}
                            variant="secondary"
                            size="sm"
                            disabled={isSubmitting}
                          >
                            編集
                          </Button>
                          <Button
                            onClick={() => {
                              const schoolId = getDefaultSchoolId();
                              window.open(
                                `/forms/preview-period/mogi/${period.period_key}?schoolId=${schoolId}`,
                                '_blank'
                              );
                            }}
                            variant="secondary"
                            size="sm"
                            disabled={isSubmitting}
                          >
                            プレビュー
                          </Button>
                          <Link
                            href={`/forms/responses/mogi/${period.period_key}`}
                            className="px-3 py-1 text-xs bg-surface-hover text-text-body rounded hover:bg-border flex items-center justify-center"
                          >
                            回答一覧
                          </Link>
                          <Button
                            onClick={() => handleArchivePeriod(period)}
                            variant="secondary"
                            size="sm"
                            disabled={isSubmitting}
                          >
                            アーカイブ
                          </Button>
                          <Button
                            onClick={() => handleDelete(period.id, period.title)}
                            variant="danger"
                            size="sm"
                            disabled={isSubmitting}
                          >
                            削除
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {showArchived && archivedPeriods.length > 0 && (
                    <>
                      <tr>
                        <td colSpan={6} className="border border-border px-4 py-2 bg-gray-50">
                          <div className="text-sm font-medium text-gray-600">アーカイブ済み</div>
                        </td>
                      </tr>
                      {archivedPeriods.map((period) => (
                        <tr key={period.id} className="table-row-hover bg-gray-50 opacity-70">
                          <td className="border border-border px-4 py-3">{period.period_key}</td>
                          <td className="border border-border px-4 py-3">{period.title}</td>
                          <td className="border border-border px-4 py-3">
                            {formatDateRange(period.publish_start, period.publish_end)}
                          </td>
                          <td className="border border-border px-4 py-3">
                            <span className="px-2 py-1 rounded text-xs font-medium bg-gray-200 text-gray-600">
                              アーカイブ
                            </span>
                            {period.archived_at && (
                              <div className="text-xs text-gray-400 mt-1">
                                {new Date(period.archived_at).toLocaleDateString('ja-JP')}
                              </div>
                            )}
                          </td>
                          <td className="border border-border px-4 py-3">
                            {responseCounts[period.id] ?? '-'}件
                          </td>
                          <td className="border border-border px-4 py-3">
                            <div className="flex gap-2">
                              <Button
                                onClick={() => {
                                  const schoolId = getDefaultSchoolId();
                                  window.open(
                                    `/forms/preview-period/mogi/${period.period_key}?schoolId=${schoolId}`,
                                    '_blank'
                                  );
                                }}
                                variant="secondary"
                                size="sm"
                              >
                                プレビュー
                              </Button>
                              <Link
                                href={`/forms/responses/mogi/${period.period_key}`}
                                className="px-3 py-1 text-xs bg-surface-hover text-text-body rounded hover:bg-border flex items-center justify-center"
                              >
                                回答一覧
                              </Link>
                              <Button
                                onClick={() => handleUnarchivePeriod(period)}
                                variant="secondary"
                                size="sm"
                                disabled={isSubmitting}
                              >
                                元に戻す
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
        {ConfirmDialog}
      </AdminLayout>

      {/* 期間編集モーダル */}
      <MogiPeriodEditor
        isOpen={isEditorOpen}
        period={editingPeriod}
        onClose={() => {
          setIsEditorOpen(false);
          setEditingPeriod(null);
        }}
        onSuccess={() => {
          fetchPeriods();
        }}
      />
    </div>
  );
}
