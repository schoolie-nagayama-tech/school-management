'use client';

import { useCallback } from 'react';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, Button } from '@/components/ui';
import { SelectShadcn as Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui';
import { OrderStatusBadge } from './OrderStatusBadge';
import type { MaterialOrderWithDetails, OrderStatus } from '@/types/database';

const STATUS_OPTIONS: { value: OrderStatus; label: string }[] = [
  { value: 'pending', label: '未発注' },
  { value: 'ordered', label: '発注済' },
  { value: 'delivered', label: '納品済' },
  { value: 'distributed', label: '配布済' },
  { value: 'cancelled', label: 'キャンセル' },
];

const ROW_COLORS: Record<OrderStatus, string> = {
  pending: '',
  ordered: 'bg-blue-50',
  delivered: 'bg-green-50',
  distributed: 'bg-gray-50',
  cancelled: 'bg-red-50',
};

interface OrderListProps {
  orders: MaterialOrderWithDetails[];
  canEdit: boolean;
  onStatusChange: (id: string, status: OrderStatus) => void;
  onDelete: (id: string) => void;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

export function OrderList({ orders, canEdit, onStatusChange, onDelete }: OrderListProps) {
  const handleStatusChange = useCallback(
    (orderId: string, newStatus: string) => {
      onStatusChange(orderId, newStatus as OrderStatus);
    },
    [onStatusChange]
  );

  if (orders.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-[#e5e7eb] p-8 text-center">
        <p className="text-[#4b5563]">発注データがありません。</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-[#e5e7eb] overflow-hidden">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>生徒名</TableHead>
              <TableHead>教材名</TableHead>
              <TableHead className="text-center">数量</TableHead>
              <TableHead>ステータス</TableHead>
              <TableHead>発注日</TableHead>
              <TableHead>納品日</TableHead>
              {canEdit && <TableHead className="text-center">操作</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.map((order) => (
              <TableRow
                key={order.id}
                className={`${ROW_COLORS[order.status]} ${order.status === 'cancelled' ? 'line-through text-gray-400' : ''}`}
              >
                <TableCell>
                  {order.student?.last_name} {order.student?.first_name}
                </TableCell>
                <TableCell>{order.material?.name ?? '-'}</TableCell>
                <TableCell className="text-center">{order.quantity}</TableCell>
                <TableCell>
                  {canEdit ? (
                    <Select
                      value={order.status}
                      onValueChange={(value) => handleStatusChange(order.id, value)}
                    >
                      <SelectTrigger className="w-[130px] h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STATUS_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <OrderStatusBadge status={order.status} />
                  )}
                </TableCell>
                <TableCell>{formatDate(order.ordered_at)}</TableCell>
                <TableCell>{formatDate(order.delivered_at)}</TableCell>
                {canEdit && (
                  <TableCell className="text-center">
                    {order.status === 'pending' && (
                      <Button
                        variant="ghost"
                        onClick={() => onDelete(order.id)}
                        className="text-red-600 hover:text-red-800 text-xs px-2 py-1"
                      >
                        削除
                      </Button>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
