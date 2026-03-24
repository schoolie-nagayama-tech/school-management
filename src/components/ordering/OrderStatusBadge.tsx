'use client';

import type { OrderStatus } from '@/types/database';

const ORDER_STATUS_COLORS: Record<OrderStatus, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  ordered: 'bg-blue-100 text-blue-800',
  delivered: 'bg-green-100 text-green-800',
  distributed: 'bg-gray-100 text-gray-800',
  cancelled: 'bg-red-100 text-red-800',
};

const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: '未発注',
  ordered: '発注済',
  delivered: '納品済',
  distributed: '配布済',
  cancelled: 'キャンセル',
};

interface OrderStatusBadgeProps {
  status: OrderStatus;
  className?: string;
}

export function OrderStatusBadge({ status, className = '' }: OrderStatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${ORDER_STATUS_COLORS[status]} ${className}`}
    >
      {ORDER_STATUS_LABELS[status]}
    </span>
  );
}

export { ORDER_STATUS_LABELS };
