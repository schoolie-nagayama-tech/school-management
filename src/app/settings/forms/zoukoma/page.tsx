'use client';

import { useState, useEffect, useCallback } from 'react';
import { AdminLayout } from '@/components/layouts';
import { getZoukomaPeriods, deleteZoukomaPeriod, archiveZoukomaPeriod, unarchiveZoukomaPeriod } from '@/lib/api/zoukoma';
import { ZoukomaPeriodForm } from '@/components/forms/zoukoma/ZoukomaPeriodForm';
import type { ZoukomaPeriod } from '@/types/forms/zoukoma';
import Link from 'next/link';
import { getDefaultSchoolId } from '@/lib/api/schools';
import { useToast } from '@/hooks/useToast';
import { useConfirm } from '@/hooks/useConfirm';
import { ToastContainer, Loading } from '@/components/ui';
import { ChevronLeft } from 'lucide-react';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';

export default function ZoukomaSettingsPage() {
  const [periods, setPeriods] = useState<ZoukomaPeriod[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingPeriod, setEditingPeriod] = useState<ZoukomaPeriod | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const { toasts, removeToast, success, error } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();

  const fetchPeriods = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage('');
    try {
      const schoolId = getDefaultSchoolId();
      const data = await getZoukomaPeriods(schoolId, showArchived);
      setPeriods(data);
    } catch (error) {
      console.error('Error fetching periods:', error);
      setErrorMessage(
        getUserErrorMessage(error, '期間一覧の取得に失敗しました')
      );
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


  // 公開期間に基づいて状態を取得（/settings/portalと同じロジック）
  const getPeriodStatus = (period: ZoukomaPeriod) => {
    const now = new Date();
    const start = period.publish_start ? new Date(period.publish_start) : null;
    const end = period.publish_end ? new Date(period.publish_end) : null;

    if (!start) {
      return { label: '未設定', className: 'bg-gray-100 text-gray-800' };
    }

    if (start > now) {
      return { label: '公開前', className: 'bg-yellow-100 text-yellow-800' };
    }

    if (!end) {
      return { label: `公開中（常時）(${period.title || period.period_key})`, className: 'bg-inkmerald-500 text-white' };
    }

    if (end < now) {
      return { label: '公開終了', className: 'bg-gray-100 text-gray-800' };
    }

    // 公開期間内
    return { label: `公開中(${period.title || period.period_key})`, className: 'bg-inkmerald-500 text-white' };
  };

  const handleDelete = async (period: ZoukomaPeriod) => {
    if (!(await confirm({ title: '削除確認', description: `「${period.title}」を削除してもよろしいですか？\nこの操作は取り消せません。`, confirmLabel: '削除', variant: 'danger' }))) {
      return;
    }

    try {
      setIsSubmitting(true);
      await deleteZoukomaPeriod(period.id);
      await fetchPeriods();
      success('期間を削除しました');
    } catch (err) {
      console.error('Error deleting period:', err);
      error(
        err instanceof Error
          ? err.message
          : '期間の削除に失敗しました'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleArchive = async (period: ZoukomaPeriod) => {
    if (!(await confirm({ title: 'アーカイブ確認', description: `「${period.title}」をアーカイブしますか？\n\nこの期間の全ての回答もアーカイブされます。`, confirmLabel: 'アーカイブ', variant: 'warning' }))) {
      return;
    }

    try {
      setIsSubmitting(true);
      const schoolId = getDefaultSchoolId();
      const result = await archiveZoukomaPeriod(period.id, schoolId, period.period_key);
      await fetchPeriods();
      success(`アーカイブしました（回答${result.responsesArchived}件を含む）`);
    } catch (err) {
      console.error('Error archiving period:', err);
      error(
        getUserErrorMessage(err, 'アーカイブに失敗しました')
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUnarchive = async (period: ZoukomaPeriod) => {
    try {
      setIsSubmitting(true);
      const schoolId = getDefaultSchoolId();
      const result = await unarchiveZoukomaPeriod(period.id, schoolId, period.period_key);
      await fetchPeriods();
      success(`アーカイブを解除しました（回答${result.responsesUnarchived}件を含む）`);
    } catch (err) {
      console.error('Error unarchiving period:', err);
      error(
        getUserErrorMessage(err, 'アーカイブ解除に失敗しました')
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const activePeriods = periods.filter((p) => !p.is_archived);
  const archivedPeriods = periods.filter((p) => p.is_archived);

  return (
    <div>
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      <AdminLayout headerTitle="テスト対策増コマ申し込み 設定" narrow>
        <div className="mb-4">
          <Link href="/settings" className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text-heading transition-colors duration-150">
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
                    <span className="ml-1 text-text-body/60">
                      ({archivedPeriods.length}件)
                    </span>
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
                    <th className="border border-border px-4 py-3 text-left">
                      期間
                    </th>
                    <th className="border border-border px-4 py-3 text-left">
                      タイトル
                    </th>
                    <th className="border border-border px-4 py-3 text-left">
                      公開期間
                    </th>
                    <th className="border border-border px-4 py-3 text-left">
                      状態
                    </th>
                    <th className="border border-border px-4 py-3 text-left">
                      回答数
                    </th>
                    <th className="border border-border px-4 py-3 text-left">
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {activePeriods.map((period) => (
                    <tr key={period.id} className="table-row-hover">
                      <td className="border border-border px-4 py-3">
                        {period.period_key}
                      </td>
                      <td className="border border-border px-4 py-3">
                        {period.title}
                      </td>
                      <td className="border border-border px-4 py-3">
                        {formatDateRange(period.publish_start, period.publish_end)}
                      </td>
                      <td className="border border-border px-4 py-3">
                        {(() => {
                          const status = getPeriodStatus(period);
                          return (
                            <span
                              className={`px-3 py-1 rounded-full text-xs font-medium ${status.className}`}
                            >
                              {status.label}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="border border-border px-4 py-3">
                        {/* TODO: 回答数を取得して表示 */}
                        -
                      </td>
                      <td className="border border-border px-4 py-3">
                        <div className="flex gap-2">
                          <button
                            onClick={() => {
                              setEditingPeriod(period);
                              setIsEditorOpen(true);
                            }}
                            className="px-3 py-1 text-xs bg-surface-hover text-text-body rounded hover:bg-border transition-colors duration-150"
                            disabled={isSubmitting}
                          >
                            編集
                          </button>
                          <button
                            onClick={() => {
                              const schoolId = getDefaultSchoolId();
                              window.open(
                                `/forms/preview-period/zoukoma/${period.period_key}?schoolId=${schoolId}`,
                                '_blank'
                              );
                            }}
                            className="px-3 py-1 text-xs bg-surface-hover text-text-body rounded hover:bg-border transition-colors duration-150"
                          >
                            プレビュー
                          </button>
                          <button
                            onClick={() => {
                              window.location.href = `/forms/responses/zoukoma/${period.period_key}`;
                            }}
                            className="px-3 py-1 text-xs bg-surface-hover text-text-body rounded hover:bg-border transition-colors duration-150"
                          >
                            回答一覧
                          </button>
                          <button
                            onClick={() => handleArchive(period)}
                            className="px-3 py-1 text-xs bg-surface-hover text-text-body rounded hover:bg-border transition-colors duration-150"
                            disabled={isSubmitting}
                          >
                            アーカイブ
                          </button>
                          <button
                            onClick={() => handleDelete(period)}
                            className="px-3 py-1 text-xs bg-danger text-white rounded hover:bg-danger/80 transition-colors duration-150"
                            disabled={isSubmitting}
                          >
                            削除
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {showArchived && archivedPeriods.map((period) => (
                    <tr key={period.id} className="table-row-hover opacity-60">
                      <td className="border border-border px-4 py-3">
                        {period.period_key}
                      </td>
                      <td className="border border-border px-4 py-3">
                        {period.title}
                      </td>
                      <td className="border border-border px-4 py-3">
                        {formatDateRange(period.publish_start, period.publish_end)}
                      </td>
                      <td className="border border-border px-4 py-3">
                        <span className="px-3 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                          アーカイブ
                        </span>
                      </td>
                      <td className="border border-border px-4 py-3">
                        -
                      </td>
                      <td className="border border-border px-4 py-3">
                        <div className="flex gap-2">
                          <button
                            onClick={() => {
                              const schoolId = getDefaultSchoolId();
                              window.open(
                                `/forms/preview-period/zoukoma/${period.period_key}?schoolId=${schoolId}`,
                                '_blank'
                              );
                            }}
                            className="px-3 py-1 text-xs bg-surface-hover text-text-body rounded hover:bg-border transition-colors duration-150"
                          >
                            プレビュー
                          </button>
                          <button
                            onClick={() => handleUnarchive(period)}
                            className="px-3 py-1 text-xs bg-surface-hover text-text-body rounded hover:bg-border transition-colors duration-150"
                            disabled={isSubmitting}
                          >
                            元に戻す
                          </button>
                          <button
                            onClick={() => handleDelete(period)}
                            className="px-3 py-1 text-xs bg-danger text-white rounded hover:bg-danger/80 transition-colors duration-150"
                            disabled={isSubmitting}
                          >
                            削除
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
        </div>
      )}
      </div>

      {/* 期間編集モーダル */}
      <ZoukomaPeriodForm
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
      {ConfirmDialog}
      </AdminLayout>
    </div>
  );
}
