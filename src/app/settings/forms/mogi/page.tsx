'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { AppHeader } from '@/components/layout';
import { Button, ToastContainer } from '@/components/ui';
import { getMogiPeriods, deleteMogiPeriod, getMogiResponseCount } from '@/lib/api/mogi';
import { MogiPeriodEditor } from '@/components/forms/mogi/MogiPeriodEditor';
import { useToast } from '@/hooks/useToast';
import type { MogiPeriod } from '@/types/forms/mogi';
import { getDefaultSchoolId } from '@/lib/api/schools';

export default function MogiSettingsPage() {
  const [periods, setPeriods] = useState<MogiPeriod[]>([]);
  const [responseCounts, setResponseCounts] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingPeriod, setEditingPeriod] = useState<MogiPeriod | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toasts, removeToast, success, error } = useToast();

  const fetchPeriods = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage('');
    try {
      const schoolId = getDefaultSchoolId();
      const data = await getMogiPeriods(schoolId);
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
      setErrorMessage(
        error instanceof Error ? error.message : '期間一覧の取得に失敗しました'
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

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
  const getPeriodStatus = (period: MogiPeriod) => {
    const now = new Date();
    const start = period.publish_start ? new Date(period.publish_start) : null;
    const end = period.publish_end ? new Date(period.publish_end) : null;

    if (!start || !end) {
      return { label: '未設定', color: 'gray' };
    }
    if (start > now) {
      return { label: '公開前', color: 'yellow' };
    }
    if (end < now) {
      return { label: '公開終了', color: 'gray' };
    }
    return { label: '公開中', color: 'green' };
  };

  // 期間削除
  const handleDelete = async (periodId: string, periodTitle: string) => {
    if (window.confirm(`「${periodTitle}」を削除してもよろしいですか？`)) {
      try {
        setIsSubmitting(true);
        await deleteMogiPeriod(periodId);
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

  return (
    <div className="min-h-screen bg-[#eff0f3]">
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      <AppHeader title="Vもぎ申込 設定" />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {errorMessage && (
          <div className="mb-4 p-4 bg-[#d9376e]/20 border border-[#d9376e] rounded-lg">
            <p className="text-sm text-[#d9376e]">{errorMessage}</p>
          </div>
        )}

        <div className="bg-[#fffffe] rounded-xl border border-[#0d0d0d] p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-bold text-[#0d0d0d]">期間一覧</h2>
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
                  {periods.map((period) => (
                    <tr key={period.id} className="table-row-hover">
                      <td className="border border-[#0d0d0d] px-4 py-3">
                        {period.period_key}
                      </td>
                      <td className="border border-[#0d0d0d] px-4 py-3">
                        {period.title}
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
                            href={`/forms/responses/mogi/${period.period_key}`}
                            className="px-3 py-1 text-xs bg-[#eff0f3] text-[#2a2a2a] rounded hover:bg-[#0d0d0d]/10 flex items-center justify-center"
                          >
                            回答一覧
                          </Link>
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
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

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
