'use client';

import { useState, useEffect } from 'react';
import { Modal, InlineLoading } from '@/components/ui';
import { Badge } from '@/components/ui';
import type { Material, MaterialStockTransaction } from '@/types/database';
import { getStockTransactions } from '@/lib/api/inventory';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';

interface StockHistoryDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  material: Material;
}

const TYPE_BADGES: Record<
  string,
  { label: string; variant: 'default' | 'destructive' | 'secondary' }
> = {
  in: { label: '入庫', variant: 'default' },
  out: { label: '出庫', variant: 'destructive' },
  adjust: { label: '調整', variant: 'secondary' },
};

export function StockHistoryDrawer({ isOpen, onClose, material }: StockHistoryDrawerProps) {
  const [transactions, setTransactions] = useState<MaterialStockTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      fetchHistory();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, material.id]);

  const fetchHistory = async () => {
    setIsLoading(true);
    setError('');
    try {
      const data = await getStockTransactions(material.id, { limit: 50 });
      setTransactions(data);
    } catch (err) {
      setError(getUserErrorMessage(err, '履歴の取得に失敗しました'));
    } finally {
      setIsLoading(false);
    }
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`${material.name} - 在庫履歴`} size="lg">
      <div className="space-y-4">
        {/* 現在の在庫情報 */}
        <div className="bg-[#f9fafb] rounded-lg p-4 flex items-center justify-between">
          <div>
            <div className="text-sm text-[#4b5563]">現在の在庫数</div>
            <div className="text-xl font-bold text-[#1f2937]">
              {material.stock_quantity}{' '}
              <span className="text-sm font-normal text-[#4b5563]">{material.unit}</span>
            </div>
          </div>
          {material.stock_quantity < material.low_stock_threshold && (
            <Badge variant="destructive">在庫不足</Badge>
          )}
        </div>

        {error && (
          <div className="bg-[#ef4444]/20 text-[#ef4444] px-4 py-2 rounded border border-[#ef4444] text-sm">
            {error}
          </div>
        )}

        {isLoading ? (
          <div className="py-8">
            <InlineLoading />
          </div>
        ) : transactions.length === 0 ? (
          <div className="text-center py-8 text-[#4b5563]">履歴がありません。</div>
        ) : (
          <div className="divide-y divide-[#e5e7eb] max-h-[400px] overflow-y-auto">
            {transactions.map((txn) => {
              const badge = TYPE_BADGES[txn.transaction_type] || {
                label: txn.transaction_type,
                variant: 'secondary' as const,
              };
              return (
                <div key={txn.id} className="py-3 flex items-start gap-3">
                  <div className="flex-shrink-0 pt-0.5">
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-[#1f2937]">
                        {txn.transaction_type === 'in' && `+${txn.quantity}`}
                        {txn.transaction_type === 'out' && `-${txn.quantity}`}
                        {txn.transaction_type === 'adjust' && `→ ${txn.quantity}`}
                      </span>
                      <span className="text-xs text-[#4b5563]">{formatDate(txn.created_at)}</span>
                    </div>
                    {txn.reason && <p className="text-xs text-[#4b5563] mt-0.5">{txn.reason}</p>}
                    {txn.related_student_id && (
                      <p className="text-xs text-[#4b5563] mt-0.5">
                        生徒ID: {txn.related_student_id}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}
