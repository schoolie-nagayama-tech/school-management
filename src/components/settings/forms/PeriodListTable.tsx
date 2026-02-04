'use client';

import { useState } from 'react';
import { Button } from '@/components/ui';
import { PeriodStatusBadge, getPeriodStatus } from './PeriodStatusBadge';
import type { FormPeriod } from '@/types/database';

function formatPublishRange(period: FormPeriod): string {
  if (!period.publish_start && !period.publish_end) {
    return '未設定';
  }
  const start = period.publish_start
    ? new Date(period.publish_start).toLocaleString('ja-JP', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';
  const end = period.publish_end
    ? new Date(period.publish_end).toLocaleString('ja-JP', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';
  return `${start} 〜 ${end}`;
}

export interface PeriodListTableProps {
  periods: FormPeriod[];
  formType: string;
  schoolId: string;
  onEdit: (period: FormPeriod) => void;
  onPublish: (period: FormPeriod) => void;
  onUnpublish: (period: FormPeriod) => void;
  onDelete: (period: FormPeriod) => void;
  onArchive: (period: FormPeriod) => void;
  getResponseCount: (periodKey: string) => Promise<number>;
  isSubmitting?: boolean;
}

export function PeriodListTable({
  periods,
  formType,
  schoolId,
  onEdit,
  onPublish,
  onUnpublish,
  onDelete,
  onArchive,
  getResponseCount,
  isSubmitting = false,
}: PeriodListTableProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [archiveConfirm, setArchiveConfirm] = useState<FormPeriod | null>(null);

  const handleDeleteClick = async (period: FormPeriod) => {
    const count = await getResponseCount(period.period_key);
    if (count > 0) {
      setArchiveConfirm(period);
      return;
    }
    if (window.confirm(`期間「${period.period_key} ${period.title}」を削除しますか？`)) {
      setDeletingId(period.id);
      try {
        await onDelete(period);
      } finally {
        setDeletingId(null);
      }
    }
  };

  const handleArchiveConfirm = async () => {
    if (!archiveConfirm) return;
    setDeletingId(archiveConfirm.id);
    try {
      await onArchive(archiveConfirm);
      setArchiveConfirm(null);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <>
      <div className="overflow-x-auto border border-[#e5e7eb] rounded-lg">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-[#f3f4f6]">
              <th className="border border-[#e5e7eb] px-4 py-3 text-left font-medium text-[#1f2937]">
                期間キー
              </th>
              <th className="border border-[#e5e7eb] px-4 py-3 text-left font-medium text-[#1f2937]">
                タイトル
              </th>
              <th className="border border-[#e5e7eb] px-4 py-3 text-left font-medium text-[#1f2937]">
                公開期間
              </th>
              <th className="border border-[#e5e7eb] px-4 py-3 text-left font-medium text-[#1f2937]">
                状態
              </th>
              <th className="border border-[#e5e7eb] px-4 py-3 text-left font-medium text-[#1f2937]">
                操作
              </th>
            </tr>
          </thead>
          <tbody>
            {periods.map((period) => {
              const status = getPeriodStatus(period);
              const isActive = period.is_active && !period.is_archived;
              return (
                <tr key={period.id} className="table-row-hover">
                  <td className="border border-[#e5e7eb] px-4 py-3 font-mono text-[#1f2937]">
                    {period.period_key}
                  </td>
                  <td className="border border-[#e5e7eb] px-4 py-3 text-[#1f2937]">
                    {period.title || '—'}
                  </td>
                  <td className="border border-[#e5e7eb] px-4 py-3 text-[#4b5563]">
                    {formatPublishRange(period)}
                  </td>
                  <td className="border border-[#e5e7eb] px-4 py-3">
                    <PeriodStatusBadge period={period} />
                  </td>
                  <td className="border border-[#e5e7eb] px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => onEdit(period)}
                        disabled={isSubmitting}
                      >
                        編集
                      </Button>
                      {isActive ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => onUnpublish(period)}
                          disabled={isSubmitting}
                        >
                          非公開
                        </Button>
                      ) : (
                        !period.is_archived && (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => onPublish(period)}
                            disabled={isSubmitting}
                          >
                            公開
                          </Button>
                        )
                      )}
                      {!period.is_archived && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handleDeleteClick(period)}
                          disabled={isSubmitting || deletingId === period.id}
                        >
                          {deletingId === period.id ? '処理中...' : '削除'}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* アーカイブ確認モーダル */}
      {archiveConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-lg p-6 max-w-md mx-4">
            <h3 className="text-lg font-bold text-[#1f2937] mb-2">削除できません</h3>
            <p className="text-sm text-[#4b5563] mb-4">
              この期間には回答があるため削除できません。アーカイブしますか？（回答もアーカイブされます）
            </p>
            <div className="flex gap-2 justify-end">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setArchiveConfirm(null)}
                disabled={isSubmitting}
              >
                キャンセル
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleArchiveConfirm}
                disabled={isSubmitting || deletingId === archiveConfirm.id}
              >
                {deletingId === archiveConfirm.id ? '処理中...' : 'アーカイブする'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
