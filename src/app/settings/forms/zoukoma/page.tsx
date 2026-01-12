'use client';

import { useState, useEffect, useCallback } from 'react';
import { AppHeader } from '@/components/layout';
import { getZoukomaPeriods, deleteZoukomaPeriod } from '@/lib/api/zoukoma';
import { ZoukomaPeriodForm } from '@/components/forms/zoukoma/ZoukomaPeriodForm';
import type { ZoukomaPeriod } from '@/types/forms/zoukoma';
import { getDefaultSchoolId } from '@/lib/api/schools';

export default function ZoukomaSettingsPage() {
  const [periods, setPeriods] = useState<ZoukomaPeriod[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingPeriod, setEditingPeriod] = useState<ZoukomaPeriod | null>(null);

  const fetchPeriods = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage('');
    try {
      const schoolId = getDefaultSchoolId();
      const data = await getZoukomaPeriods(schoolId);
      setPeriods(data);
    } catch (error) {
      console.error('Error fetching periods:', error);
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

  const formatDate = (date: string | null) => {
    if (!date) return '-';
    const d = new Date(date);
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  };

  // 公開期間に基づいて状態を取得（/settings/portalと同じロジック）
  const getPeriodStatus = (period: ZoukomaPeriod) => {
    const now = new Date();
    const start = period.publish_start ? new Date(period.publish_start) : null;
    const end = period.publish_end ? new Date(period.publish_end) : null;

    if (!start || !end) {
      return { label: '未設定', className: 'bg-gray-100 text-gray-800' };
    }

    if (start > now) {
      return { label: '公開前', className: 'bg-yellow-100 text-yellow-800' };
    }

    if (end < now) {
      return { label: '公開終了', className: 'bg-gray-100 text-gray-800' };
    }

    // 公開期間内
    return { label: `公開中(${period.title || period.period_key})`, className: 'bg-emerald-500 text-white' };
  };

  const handleDelete = async (period: ZoukomaPeriod) => {
    if (!confirm(`「${period.title}」を削除してもよろしいですか？\nこの操作は取り消せません。`)) {
      return;
    }

    try {
      await deleteZoukomaPeriod(period.id);
      fetchPeriods();
    } catch (error) {
      console.error('Error deleting period:', error);
      alert(
        error instanceof Error
          ? error.message
          : '期間の削除に失敗しました'
      );
    }
  };

  return (
    <div className="min-h-screen bg-[#eff0f3]">
      <AppHeader title="増コマ申込 設定" />
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
                          return (
                            <span
                              className={`px-3 py-1 rounded-full text-xs font-medium ${status.className}`}
                            >
                              {status.label}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="border border-[#0d0d0d] px-4 py-3">
                        {/* TODO: 回答数を取得して表示 */}
                        -
                      </td>
                      <td className="border border-[#0d0d0d] px-4 py-3">
                        <div className="flex gap-2">
                          <button
                            onClick={() => {
                              setEditingPeriod(period);
                              setIsEditorOpen(true);
                            }}
                            className="px-3 py-1 text-xs bg-[#eff0f3] text-[#2a2a2a] rounded hover:bg-[#0d0d0d]/10 transition-colors"
                          >
                            編集
                          </button>
                          <button
                            onClick={() => {
                              // TODO: 回答一覧ページへのリンク
                              window.location.href = `/forms/responses/zoukoma/${period.period_key}`;
                            }}
                            className="px-3 py-1 text-xs bg-[#eff0f3] text-[#2a2a2a] rounded hover:bg-[#0d0d0d]/10 transition-colors"
                          >
                            回答一覧
                          </button>
                          <button
                            onClick={() => handleDelete(period)}
                            className="px-3 py-1 text-xs bg-[#d9376e] text-white rounded hover:bg-[#c02d5a] transition-colors"
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
    </div>
  );
}
