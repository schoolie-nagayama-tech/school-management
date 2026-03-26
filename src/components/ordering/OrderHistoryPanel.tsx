'use client';

import { useState, useCallback } from 'react';
import { OrderStatusBadge } from './OrderStatusBadge';
import type { MaterialOrderWithDetails, OrderStatus } from '@/types/database';

const STATUS_OPTIONS: { value: OrderStatus; label: string }[] = [
  { value: 'unconfirmed', label: '未確認' },
  { value: 'ordered', label: '発注済' },
  { value: 'delivered', label: '発送済' },
  { value: 'distributed', label: '配布済' },
  { value: 'cancelled', label: 'キャンセル' },
];

interface OrderHistoryPanelProps {
  orders: MaterialOrderWithDetails[];
  canEdit: boolean;
  onStatusChange: (orderId: string, status: OrderStatus) => Promise<void>;
  onDelete: (orderId: string) => Promise<void>;
}

export function OrderHistoryPanel({
  orders,
  canEdit,
  onStatusChange,
  onDelete,
}: OrderHistoryPanelProps) {
  const [changingId, setChangingId] = useState<string | null>(null);

  const handleStatusChange = useCallback(
    async (orderId: string, newStatus: OrderStatus) => {
      setChangingId(orderId);
      try {
        await onStatusChange(orderId, newStatus);
      } finally {
        setChangingId(null);
      }
    },
    [onStatusChange]
  );

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  };

  if (orders.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500 text-sm">
        発注履歴がありません。
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200">
            <th className="text-left py-2 px-3 text-xs font-medium text-gray-500">日付</th>
            <th className="text-left py-2 px-3 text-xs font-medium text-gray-500">生徒</th>
            <th className="text-left py-2 px-3 text-xs font-medium text-gray-500">教材</th>
            <th className="text-center py-2 px-3 text-xs font-medium text-gray-500">数量</th>
            <th className="text-center py-2 px-3 text-xs font-medium text-gray-500">ステータス</th>
            {canEdit && (
              <th className="text-center py-2 px-3 text-xs font-medium text-gray-500">操作</th>
            )}
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.id} className="border-b border-gray-100 hover:bg-gray-50">
              <td className="py-2 px-3 text-xs text-gray-600">
                {formatDate(order.created_at)}
              </td>
              <td className="py-2 px-3 text-xs text-gray-800">
                {order.student
                  ? `${order.student.last_name} ${order.student.first_name}`
                  : '-'}
              </td>
              <td className="py-2 px-3 text-xs text-gray-800">
                {order.material?.name || '-'}
              </td>
              <td className="py-2 px-3 text-center text-xs text-gray-800">
                {order.quantity}
              </td>
              <td className="py-2 px-3 text-center">
                {canEdit ? (
                  <select
                    value={order.status}
                    onChange={(e) =>
                      handleStatusChange(order.id, e.target.value as OrderStatus)
                    }
                    disabled={changingId === order.id}
                    className="text-xs border border-gray-200 rounded px-1.5 py-0.5 bg-white"
                  >
                    {STATUS_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <OrderStatusBadge status={order.status as OrderStatus} />
                )}
              </td>
              {canEdit && (
                <td className="py-2 px-3 text-center">
                  {order.status === 'unconfirmed' && (
                    <button
                      onClick={() => onDelete(order.id)}
                      className="text-xs text-red-500 hover:text-red-700 transition-colors"
                    >
                      削除
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
