'use client';

import { useState } from 'react';
import { Modal, Button, Input } from '@/components/ui';
import type { Material, StockTransactionType } from '@/types/database';

interface StockTransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  material: Material;
  mode: 'in' | 'out' | 'adjust';
  onSubmit: (data: { quantity: number; reason: string }) => Promise<void>;
}

const MODE_LABELS: Record<StockTransactionType, { title: string; action: string; color: string }> =
  {
    in: { title: '入庫', action: '入庫する', color: 'text-green-600' },
    out: { title: '出庫', action: '出庫する', color: 'text-[#ef4444]' },
    adjust: { title: '在庫調整', action: '調整する', color: 'text-[#4b5563]' },
  };

export function StockTransactionModal({
  isOpen,
  onClose,
  material,
  mode,
  onSubmit,
}: StockTransactionModalProps) {
  const [quantity, setQuantity] = useState<number>(0);
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const modeInfo = MODE_LABELS[mode];

  // 新しい在庫数のプレビュー
  const previewQuantity = (() => {
    switch (mode) {
      case 'in':
        return material.stock_quantity + quantity;
      case 'out':
        return material.stock_quantity - quantity;
      case 'adjust':
        return quantity;
    }
  })();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (mode !== 'adjust' && quantity <= 0) {
      setError('数量は1以上を入力してください');
      return;
    }
    if (mode === 'adjust' && quantity < 0) {
      setError('数量は0以上を入力してください');
      return;
    }
    if (mode === 'out' && quantity > material.stock_quantity) {
      setError('在庫数を超える出庫はできません');
      return;
    }

    setIsSubmitting(true);
    setError('');
    try {
      await onSubmit({ quantity, reason: reason.trim() });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '処理に失敗しました');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`${material.name} - ${modeInfo.title}`}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="bg-[#ef4444]/20 text-[#ef4444] px-4 py-2 rounded border border-[#ef4444] text-sm">
            {error}
          </div>
        )}

        {/* 現在の在庫情報 */}
        <div className="bg-[#f9fafb] rounded-lg p-4">
          <div className="text-sm text-[#4b5563] mb-1">現在の在庫数</div>
          <div className="text-2xl font-bold text-[#1f2937]">
            {material.stock_quantity}{' '}
            <span className="text-sm font-normal text-[#4b5563]">{material.unit}</span>
          </div>
        </div>

        <Input
          label={mode === 'adjust' ? '新しい在庫数' : '数量'}
          type="number"
          min={mode === 'adjust' ? 0 : 1}
          required
          value={String(quantity)}
          onChange={(e) => setQuantity(Number(e.target.value) || 0)}
          placeholder="数量を入力"
        />

        <div className="w-full">
          <label className="block text-sm font-medium text-[#1f2937] mb-1">理由</label>
          <textarea
            className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg bg-white text-[#4b5563] placeholder-[#4b5563]/40 transition-[border-color] duration-150 ease-out focus:ring-2 focus:ring-[#3b82f6] focus:border-[#3b82f6]"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="理由（任意）"
          />
        </div>

        {/* プレビュー */}
        {quantity > 0 && (
          <div className="bg-[#f9fafb] rounded-lg p-4 border border-[#e5e7eb]">
            <div className="text-sm text-[#4b5563] mb-1">処理後の在庫数</div>
            <div className="flex items-center gap-2">
              <span className="text-lg text-[#4b5563]">{material.stock_quantity}</span>
              <span className={`text-lg ${modeInfo.color}`}>
                {mode === 'in' && `+ ${quantity}`}
                {mode === 'out' && `- ${quantity}`}
                {mode === 'adjust' && `→`}
              </span>
              <span className="text-lg font-bold text-[#1f2937]">
                {mode === 'adjust' ? '' : '= '}
                {previewQuantity} {material.unit}
              </span>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-3 pt-4 border-t border-[#e5e7eb]">
          <Button variant="secondary" type="button" onClick={onClose}>
            キャンセル
          </Button>
          <Button type="submit" isLoading={isSubmitting}>
            {modeInfo.action}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
