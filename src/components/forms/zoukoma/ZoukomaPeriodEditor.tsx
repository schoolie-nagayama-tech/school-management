'use client';

import { useState, useEffect } from 'react';
import { Modal, Input, Button } from '@/components/ui';
import { createZoukomaPeriod, updateZoukomaPeriod } from '@/lib/api/zoukoma';
import type { ZoukomaPeriod, ZoukomaSettings } from '@/types/forms/zoukoma';

interface ZoukomaPeriodEditorProps {
  isOpen: boolean;
  period: ZoukomaPeriod | null;
  onClose: () => void;
  onSuccess: () => void;
}

export function ZoukomaPeriodEditor({
  isOpen,
  period,
  onClose,
  onSuccess,
}: ZoukomaPeriodEditorProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  // フォームデータ
  const [periodKey, setPeriodKey] = useState('');
  const [title, setTitle] = useState('');
  const [publishStart, setPublishStart] = useState('');
  const [publishEnd, setPublishEnd] = useState('');
  const [isActive, setIsActive] = useState(false);

  // 初期値の設定
  useEffect(() => {
    if (isOpen) {
      if (period) {
        // 編集モード
        setPeriodKey(period.period_key);
        setTitle(period.title);
        setPublishStart(
          period.publish_start
            ? new Date(period.publish_start).toISOString().slice(0, 16)
            : ''
        );
        setPublishEnd(
          period.publish_end
            ? new Date(period.publish_end).toISOString().slice(0, 16)
            : ''
        );
        setIsActive(period.is_active);
      } else {
        // 新規作成モード
        setPeriodKey('');
        setTitle('');
        setPublishStart('');
        setPublishEnd('');
        setIsActive(false);
      }
      setError('');
    }
  }, [isOpen, period]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // バリデーション
    if (!periodKey.trim()) {
      setError('期間キーを入力してください');
      return;
    }
    if (!title.trim()) {
      setError('タイトルを入力してください');
      return;
    }

    setIsSubmitting(true);
    try {
      const settings: ZoukomaSettings = period?.settings || {
        grades: ['中1', '中2', '中3', '高1', '高2', '高3'],
        price_table: {
          中1: 3980,
          中2: 3980,
          中3: 4120,
          高1: 4480,
          高2: 4770,
          高3: 5060,
        },
        subjects: ['英語', '数学', '国語', '理科', '社会'],
      };

      if (period) {
        // 更新
        await updateZoukomaPeriod(period.id, {
          period_key: periodKey.trim(),
          title: title.trim(),
          publish_start: publishStart ? new Date(publishStart).toISOString() : null,
          publish_end: publishEnd ? new Date(publishEnd).toISOString() : null,
          is_active: isActive,
          settings,
        });
      } else {
        // 新規作成
        await createZoukomaPeriod({
          period_key: periodKey.trim(),
          title: title.trim(),
          settings,
          publish_start: publishStart ? new Date(publishStart).toISOString() : null,
          publish_end: publishEnd ? new Date(publishEnd).toISOString() : null,
          is_active: isActive,
          linked_application_item_id: null,
        });
      }
      onSuccess();
      onClose();
    } catch (error) {
      console.error('Error saving period:', error);
      setError(
        error instanceof Error ? error.message : '期間の保存に失敗しました'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={period ? '期間の編集' : '期間の新規作成'}
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-[#d9376e]/10 border border-[#d9376e] rounded-lg">
            <p className="text-sm text-[#d9376e]">{error}</p>
          </div>
        )}

        <Input
          label="期間キー"
          type="text"
          value={periodKey}
          onChange={(e) => setPeriodKey(e.target.value)}
          placeholder="例: 2024-10"
          required
          disabled={isSubmitting}
        />

        <Input
          label="タイトル"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="例: 10月度 増コマ申込"
          required
          disabled={isSubmitting}
        />

        <Input
          label="公開開始日時"
          type="datetime-local"
          value={publishStart}
          onChange={(e) => setPublishStart(e.target.value)}
          disabled={isSubmitting}
        />

        <Input
          label="公開終了日時"
          type="datetime-local"
          value={publishEnd}
          onChange={(e) => setPublishEnd(e.target.value)}
          disabled={isSubmitting}
        />
        <p className="text-xs text-[#2a2a2a]/60 mt-1">
          ※空欄にすると永続的に公開されます
        </p>

        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            id="isActive"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            disabled={isSubmitting}
            className="w-4 h-4 text-[#ff8e3c] border-[#0d0d0d] rounded focus:ring-[#ff8e3c]"
          />
          <label htmlFor="isActive" className="text-sm text-[#0d0d0d]">
            公開中にする
          </label>
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t border-[#0d0d0d]">
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
            キャンセル
          </Button>
          <Button type="submit" isLoading={isSubmitting}>
            {period ? '更新する' : '作成する'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
