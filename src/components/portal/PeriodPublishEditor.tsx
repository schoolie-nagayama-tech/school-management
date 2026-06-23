'use client';

import { useState, useEffect } from 'react';
import { Modal, Input, Button } from '@/components/ui';
import { updateZoukomaPeriod } from '@/lib/api/zoukoma';
import { updateMogiPeriod } from '@/lib/api/mogi';
import type { FormPeriod, FormType } from '@/types/database';
import { useToast } from '@/hooks/useToast';

interface PeriodPublishEditorProps {
  isOpen: boolean;
  period: FormPeriod | null;
  formType: FormType;
  onClose: () => void;
  onSuccess: () => void;
}

export function PeriodPublishEditor({
  isOpen,
  period,
  formType,
  onClose,
  onSuccess,
}: PeriodPublishEditorProps) {
  const [publishStart, setPublishStart] = useState('');
  const [publishEnd, setPublishEnd] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const { success, error: showError } = useToast();

  useEffect(() => {
    if (isOpen && period) {
      setPublishStart(
        period.publish_start ? new Date(period.publish_start).toISOString().slice(0, 16) : ''
      );
      setPublishEnd(
        period.publish_end ? new Date(period.publish_end).toISOString().slice(0, 16) : ''
      );
      setError('');
    }
  }, [isOpen, period]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!period) {
      setError('期間が選択されていません');
      return;
    }

    if (!publishStart || !publishEnd) {
      setError('公開開始日時と公開終了日時を入力してください');
      return;
    }

    const startDate = new Date(publishStart);
    const endDate = new Date(publishEnd);

    if (startDate >= endDate) {
      setError('公開終了日時は公開開始日時より後である必要があります');
      return;
    }

    setIsSubmitting(true);
    try {
      const now = new Date();
      const shouldBeActive = startDate <= now && endDate >= now;

      if (formType === 'zoukoma') {
        await updateZoukomaPeriod(period.id, {
          publish_start: startDate.toISOString(),
          publish_end: endDate.toISOString(),
          is_active: shouldBeActive,
        });
      } else if (formType === 'mogi') {
        await updateMogiPeriod(period.id, {
          publish_start: startDate.toISOString(),
          publish_end: endDate.toISOString(),
          is_active: shouldBeActive,
        });
      } else {
        throw new Error('対応していないフォームタイプです');
      }

      success('公開期間を更新しました');
      onSuccess();
      onClose();
    } catch (err) {
      console.error('Error updating period:', err);
      const errorMessage = err instanceof Error ? err.message : '公開期間の更新に失敗しました';
      setError(errorMessage);
      showError(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="公開期間の設定" size="md">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-[#ef4444]/10 border border-[#ef4444] rounded-lg">
            <p className="text-sm text-[#ef4444]">{error}</p>
          </div>
        )}

        {period && (
          <div className="p-3 bg-[#f3f4f6] rounded-lg border border-[#e5e7eb]">
            <p className="text-sm font-medium text-[#1f2937] mb-1">
              {period.title || period.period_key}
            </p>
            <p className="text-xs text-[#4b5563]">
              フォーム種別:{' '}
              {formType === 'zoukoma' ? '増コマ申込' : formType === 'mogi' ? 'Vもぎ申込' : formType}
            </p>
          </div>
        )}

        <Input
          label="公開開始日時"
          type="datetime-local"
          value={publishStart}
          onChange={(e) => setPublishStart(e.target.value)}
          required
          disabled={isSubmitting}
        />

        <Input
          label="公開終了日時"
          type="datetime-local"
          value={publishEnd}
          onChange={(e) => setPublishEnd(e.target.value)}
          required
          disabled={isSubmitting}
        />

        {publishStart &&
          publishEnd &&
          (() => {
            const now = new Date();
            const startDate = new Date(publishStart);
            const endDate = new Date(publishEnd);
            const isActive = startDate <= now && endDate >= now;
            const statusColor = isActive
              ? 'text-emerald-600'
              : startDate > now
                ? 'text-yellow-600'
                : 'text-gray-600';
            const statusText = isActive ? '公開中' : startDate > now ? '公開前' : '公開終了';

            return (
              <div className="p-3 bg-[#f3f4f6] rounded-lg border border-[#e5e7eb]">
                <p className="text-sm text-[#4b5563]">
                  現在の状態: <span className={`font-medium ${statusColor}`}>{statusText}</span>
                </p>
              </div>
            );
          })()}

        <div className="flex justify-end gap-2 pt-4 border-t border-[#e5e7eb]">
          <Button type="button" onClick={onClose} variant="secondary" disabled={isSubmitting}>
            キャンセル
          </Button>
          <Button type="submit" disabled={isSubmitting} isLoading={isSubmitting}>
            保存
          </Button>
        </div>
      </form>
    </Modal>
  );
}
