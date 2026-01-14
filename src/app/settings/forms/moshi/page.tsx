'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { AdminLayout } from '@/components/layouts';
import { Button, ToastContainer } from '@/components/ui';
import { getMoshiPeriods, deleteMoshiPeriod, getMoshiResponseCount, archiveMoshiPeriod, unarchiveMoshiPeriod } from '@/lib/api/moshi';
import { MoshiPeriodEditor } from '@/components/forms/moshi/MoshiPeriodEditor';
import { useToast } from '@/hooks/useToast';
import type { MoshiPeriod } from '@/types/forms/moshi';
import { getDefaultSchoolId } from '@/lib/api/schools';

export default function MoshiSettingsPage() {
  const [periods, setPeriods] = useState<MoshiPeriod[]>([]);
  const [responseCounts, setResponseCounts] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingPeriod, setEditingPeriod] = useState<MoshiPeriod | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const { toasts, removeToast, success, error } = useToast();

  const fetchPeriods = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage('');
    try {
      const schoolId = getDefaultSchoolId();
      const data = await getMoshiPeriods(schoolId, showArchived);
      setPeriods(data);

      // 各期間の回答数を取得
      const counts: Record<string, number> = {};
      await Promise.all(
        data.map(async (period) => {
          try {
            const count = await getMoshiResponseCount(schoolId, period.period_key);
            counts[period.id] = count;
          } catch (err) {
            console.error(`Error fetching response count for ${period.period_key}:`, err);
            counts[period.id] = 0;
          }
        })
      );
      setResponseCounts(counts);
    } catch (error) {
      console.error('Error fetching moshi periods:', error);
      setErrorMessage(
        error instanceof Error ? error.message : '期間一覧の取得に失敗しました'
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

  // 期間ステータスの取得
  const getPeriodStatus = (period: MoshiPeriod) => {
    if (period.is_archived) {
      return { label: 'アーカイブ', color: 'gray' };
    }

    const now = new Date();
    const start = period.publish_start ? new Date(period.publish_start) : null;
    const end = period.publish_end ? new Date(period.publish_end) : null;

    if (!start) {
      return { label: '未設定', color: 'gray' };
    }
    if (start > now) {
      return { label: '公開前', color: 'yellow' };
    }
    if (!end) {
      return { label: '公開中（常時）', color: 'green' };
    }
    if (end < now) {
      return { label: '公開終了', color: 'gray' };
    }
    return { label: '公開中', color: 'green' };
  };

  const activePeriods = periods.filter((p) => !p.is_archived);
  const archivedPeriods = periods.filter((p) => p.is_archived);

  // 期間削除
  const handleDelete = async (periodId: string, periodTitle: string) => {
    if (window.confirm(`「${periodTitle}」を削除してもよろしいですか？`)) {
      try {
        setIsSubmitting(true);
        await deleteMoshiPeriod(periodId);
        await fetchPeriods();
        success('期間を削除しました');
      } catch (err) {
        console.error('Error deleting period:', err);
        error(
          err instanceof Error ? err.message : '期間の削除に失敗しました'
        );
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  // 期間アーカイブ
  const handleArchivePeriod = async (period: MoshiPeriod) => {
    if (
      !window.confirm(
        `「${period.title}」をアーカイブしますか？\n\nこの期間の全ての回答もアーカイブされます。`
      )
    ) {
      return;
    }

    try {
      setIsSubmitting(true);
      const schoolId = getDefaultSchoolId();
      const result = await archiveMoshiPeriod(
        period.id,
        schoolId,
        period.period_key
      );
      await fetchPeriods();
      success(
        `アーカイブしました（回答${result.responsesArchived}件を含む）`
      );
    } catch (err) {
      console.error('Error archiving period:', err);
      error(
        err instanceof Error ? err.message : 'アーカイブに失敗しました'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // 期間アーカイブ解除
  const handleUnarchivePeriod = async (period: MoshiPeriod) => {
    try {
      setIsSubmitting(true);
      const schoolId = getDefaultSchoolId();
      const result = await unarchiveMoshiPeriod(
        period.id,
        schoolId,
        period.period_key
      );
      await fetchPeriods();
      success(
        `アーカイブを解除しました（回答${result.responsesUnarchived}件を含む）`
      );
    } catch (err) {
      console.error('Error unarchiving period:', err);
      error(
        err instanceof Error ? err.message : 'アーカイブ解除に失敗しました'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div>
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      <AdminLayout headerTitle="模試申込 設定">
        {errorMessage && (
          <div className="mb-4 p-4 bg-[#d9376e]/20 border border-[#d9376e] rounded-lg">
            <p className="text-sm text-[#d9376e]">{errorMessage}</p>
          </div>
        )}

        <div className="bg-[#fffffe] rounded-xl border border-[#0d0d0d] p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-bold text-[#0d0d0d]">期間一覧</h2>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showArchived}
                  onChange={(e) => setShowArchived(e.target.checked)}
                  className="w-4 h-4 text-[#ff8e3c] border-[#0d0d0d] rounded focus:ring-[#ff8e3c] cursor-pointer"
                />
                <span className="text-sm text-[#0d0d0d]">
                  アーカイブ済みを表示
                  {archivedPeriods.length > 0 && (
                    <span className="ml-1 text-[#2a2a2a]/60">
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
                className="px-4 py-2 bg-[#ff8e3c] text-[#0d0d0d] font-medium rounded-lg hover:bg-[#ff9e5c] transition-colors"
              >
                新規作成
              </button>
            </div>
          </div>

          {isLoading ? (
            <div className="text-center py-8 text-[#2a2a2a]">読み込み中...</div>
          ) : periods.length === 0 ? (
            <div className="text-center py-8 text-[#2a2a2a]">
              期間がありません
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse border border-[#0d0d0d] text-sm">
                <thead>
                  <tr className="bg-[#eff0f3]">
                    <th className="border border-[#0d0d0d] px-4 py-3 text-left">
                      期間
                    </th>
                    <th className="border border-[#0d0d0d] px-4 py-3 text-left">
                      タイトル
                    </th>
                    <th className="border border-[#0d0d0d] px-4 py-3 text-left">
                      受験日時
                    </th>
                    <th className="border border-[#0d0d0d] px-4 py-3 text-left">
                      公開期間
                    </th>
                    <th className="border border-[#0d0d0d] px-4 py-3 text-left">
                      状態
                    </th>
                    <th className="border border-[#0d0d0d] px-4 py-3 text-left">
                      回答数
                    </th>
                    <th className="border border-[#0d0d0d] px-4 py-3 text-left">
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {activePeriods.map((period) => (
                    <tr key={period.id} className="table-row-hover">
                      <td className="border border-[#0d0d0d] px-4 py-3">
                        {period.period_key}
                      </td>
                      <td className="border border-[#0d0d0d] px-4 py-3">
                        {period.title}
                      </td>
                      <td className="border border-[#0d0d0d] px-4 py-3">
                        {period.settings.exam_date_label} {period.settings.exam_time}
                      </td>
                      <td className="border border-[#0d0d0d] px-4 py-3">
                        {formatDateRange(period.publish_start, period.publish_end)}
                      </td>
                      <td className="border border-[#0d0d0d] px-4 py-3">
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
                      <td className="border border-[#0d0d0d] px-4 py-3">
                        {responseCounts[period.id] ?? '-'}件
                      </td>
                      <td className="border border-[#0d0d0d] px-4 py-3">
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
                          <Link
                            href={`/forms/responses/moshi/${period.period_key}`}
                            className="px-3 py-1 text-xs bg-[#eff0f3] text-[#2a2a2a] rounded hover:bg-[#0d0d0d]/10 flex items-center justify-center"
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
                        <td colSpan={7} className="border border-[#0d0d0d] px-4 py-2 bg-gray-50">
                          <div className="text-sm font-medium text-gray-600">
                            アーカイブ済み
                          </div>
                        </td>
                      </tr>
                      {archivedPeriods.map((period) => (
                        <tr
                          key={period.id}
                          className="table-row-hover bg-gray-50 opacity-70"
                        >
                          <td className="border border-[#0d0d0d] px-4 py-3">
                            {period.period_key}
                          </td>
                          <td className="border border-[#0d0d0d] px-4 py-3">
                            {period.title}
                          </td>
                          <td className="border border-[#0d0d0d] px-4 py-3">
                            {period.settings.exam_date_label} {period.settings.exam_time}
                          </td>
                          <td className="border border-[#0d0d0d] px-4 py-3">
                            {formatDateRange(period.publish_start, period.publish_end)}
                          </td>
                          <td className="border border-[#0d0d0d] px-4 py-3">
                            <span className="px-2 py-1 rounded text-xs font-medium bg-gray-200 text-gray-600">
                              アーカイブ
                            </span>
                            {period.archived_at && (
                              <div className="text-xs text-gray-400 mt-1">
                                {new Date(period.archived_at).toLocaleDateString('ja-JP')}
                              </div>
                            )}
                          </td>
                          <td className="border border-[#0d0d0d] px-4 py-3">
                            {responseCounts[period.id] ?? '-'}件
                          </td>
                          <td className="border border-[#0d0d0d] px-4 py-3">
                            <div className="flex gap-2">
                              <Link
                                href={`/forms/responses/moshi/${period.period_key}`}
                                className="px-3 py-1 text-xs bg-[#eff0f3] text-[#2a2a2a] rounded hover:bg-[#0d0d0d]/10 flex items-center justify-center"
                              >
                                回答一覧
                              </Link>
                              <Button
                                onClick={() => handleUnarchivePeriod(period)}
                                variant="secondary"
                                size="sm"
                                disabled={isSubmitting}
                              >
                                アーカイブ解除
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
      </AdminLayout>

      {/* 期間編集モーダル */}
      <MoshiPeriodEditor
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
