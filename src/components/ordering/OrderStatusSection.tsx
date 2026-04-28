'use client';

import { useState, useCallback, useMemo } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { MaterialOrderWithDetails, OrderStatus } from '@/types/database';
import { GRADE_LABELS } from '@/types/database';

// Section style config per status
const SECTION_STYLES: Record<string, { dot: string; bg: string }> = {
  unconfirmed: { dot: 'bg-yellow-400', bg: 'bg-yellow-50' },
  ordered: { dot: 'bg-blue-400', bg: 'bg-blue-50' },
  delivered: { dot: 'bg-green-400', bg: 'bg-green-50' },
  distributed: { dot: 'bg-gray-400', bg: 'bg-gray-50' },
  cancelled: { dot: 'bg-gray-400', bg: 'bg-gray-50' },
};

const NEXT_STATUS: Record<string, OrderStatus> = {
  unconfirmed: 'ordered',
  ordered: 'delivered',
  delivered: 'distributed',
};

const BULK_ACTION_LABELS: Record<string, string> = {
  unconfirmed: '一括発注済みにする',
  ordered: '一括発送済みにする',
  delivered: '一括配布済みにする',
};

const STATUS_OPTIONS: OrderStatus[] = ['unconfirmed', 'ordered', 'delivered', 'distributed', 'cancelled'];
const STATUS_LABELS: Record<OrderStatus, string> = {
  unconfirmed: '未確認', ordered: '発注済み', delivered: '発送済み', distributed: '配布済み', cancelled: 'キャンセル',
};

interface OrderStatusSectionProps {
  status: OrderStatus;
  orders: MaterialOrderWithDetails[];
  schoolMap: Record<string, string>;
  canEdit: boolean;
  defaultOpen?: boolean;
  onStatusChange: (orderId: string, newStatus: OrderStatus) => Promise<void>;
  onBulkStatusChange: (orderIds: string[], newStatus: OrderStatus) => Promise<void>;
  onDelete: (orderId: string) => Promise<void>;
}

export function OrderStatusSection({
  status,
  orders,
  schoolMap,
  canEdit,
  defaultOpen = true,
  onStatusChange,
  onBulkStatusChange,
  onDelete,
}: OrderStatusSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [changingId, setChangingId] = useState<string | null>(null);

  const style = SECTION_STYLES[status] || SECTION_STYLES.cancelled;
  const nextStatus = NEXT_STATUS[status] as OrderStatus | undefined;
  const bulkLabel = BULK_ACTION_LABELS[status];

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' });
  };

  const handleBulkAction = useCallback(async () => {
    if (!nextStatus || orders.length === 0) return;
    setBulkLoading(true);
    try {
      await onBulkStatusChange(orders.map((o) => o.id), nextStatus);
    } finally {
      setBulkLoading(false);
    }
  }, [nextStatus, orders, onBulkStatusChange]);

  const handleSingleStatusChange = useCallback(async (orderId: string, newStatus: OrderStatus) => {
    setChangingId(orderId);
    try {
      await onStatusChange(orderId, newStatus);
    } finally {
      setChangingId(null);
    }
  }, [onStatusChange]);

  const getSchoolName = useCallback((order: MaterialOrderWithDetails) => {
    return schoolMap[order.school_id] || '不明';
  }, [schoolMap]);

  return (
    <div className="mb-4">
      {/* Section Header */}
      <button
        onClick={() => setOpen(!open)}
        className={`w-full flex items-center justify-between px-4 py-3 border border-gray-200 ${style.bg} rounded-t-lg ${!open ? 'rounded-b-lg' : ''} hover:opacity-90 transition-opacity`}
      >
        <div className="flex items-center gap-2">
          {open ? <ChevronDown className="w-4 h-4 text-gray-500" /> : <ChevronRight className="w-4 h-4 text-gray-500" />}
          <span
            aria-hidden="true"
            className={`w-2 h-2 rounded-full ${style.dot}`}
          />
          <span className="font-medium text-sm text-gray-800">
            {STATUS_LABELS[status]}
          </span>
          <span className="bg-white/80 text-gray-600 text-xs font-medium px-2 py-0.5 rounded-full">
            {orders.length}件
          </span>
        </div>
        {canEdit && bulkLabel && nextStatus && orders.length > 0 && (
          <span
            role="button"
            onClick={(e) => {
              e.stopPropagation();
              handleBulkAction();
            }}
            className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${
              bulkLoading
                ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-300 cursor-pointer'
            }`}
          >
            {bulkLoading ? '処理中...' : bulkLabel}
          </span>
        )}
      </button>

      {/* Section Body */}
      {open && orders.length > 0 && (
        <div className="bg-white border border-t-0 border-gray-200 rounded-b-lg overflow-hidden">
          {status === 'unconfirmed' && (
            <UnconfirmedSection
              orders={orders}
              canEdit={canEdit}
              changingId={changingId}
              onStatusChange={handleSingleStatusChange}
              onDelete={onDelete}
              formatDate={formatDate}
              getSchoolName={getSchoolName}
            />
          )}
          {status === 'ordered' && (
            <OrderedSection
              orders={orders}
              canEdit={canEdit}
              changingId={changingId}
              onStatusChange={handleSingleStatusChange}
              onDelete={onDelete}
              formatDate={formatDate}
              getSchoolName={getSchoolName}
            />
          )}
          {status === 'delivered' && (
            <DeliveredSection
              orders={orders}
              canEdit={canEdit}
              changingId={changingId}
              onStatusChange={handleSingleStatusChange}
              formatDate={formatDate}
              getSchoolName={getSchoolName}
            />
          )}
          {status === 'distributed' && (
            <DistributedSection
              orders={orders}
              canEdit={canEdit}
              changingId={changingId}
              onStatusChange={handleSingleStatusChange}
              formatDate={formatDate}
              getSchoolName={getSchoolName}
            />
          )}
        </div>
      )}
      {open && orders.length === 0 && (
        <div className="bg-white border border-t-0 border-gray-200 rounded-b-lg p-6 text-center text-sm text-gray-400">
          該当する発注はありません
        </div>
      )}
    </div>
  );
}

// ============================
// Shared types for sub-sections
// ============================
interface SubSectionProps {
  orders: MaterialOrderWithDetails[];
  canEdit: boolean;
  changingId: string | null;
  onStatusChange: (orderId: string, newStatus: OrderStatus) => Promise<void>;
  formatDate: (dateStr: string | null) => string;
  getSchoolName: (order: MaterialOrderWithDetails) => string;
}

interface SubSectionWithDeleteProps extends SubSectionProps {
  onDelete: (orderId: string) => Promise<void>;
}

// Inline status dropdown
function StatusDropdown({
  order,
  changingId,
  onStatusChange,
}: {
  order: MaterialOrderWithDetails;
  changingId: string | null;
  onStatusChange: (orderId: string, newStatus: OrderStatus) => Promise<void>;
}) {
  return (
    <select
      value={order.status}
      onChange={(e) => onStatusChange(order.id, e.target.value as OrderStatus)}
      disabled={changingId === order.id}
      className="text-xs border border-gray-200 rounded-md px-2 py-1 bg-white focus:ring-1 focus:ring-[#1e3a5f]/30"
    >
      {STATUS_OPTIONS.map((opt) => (
        <option key={opt} value={opt}>{STATUS_LABELS[opt]}</option>
      ))}
    </select>
  );
}

// Helper: group orders by school name into sorted entries
function groupBySchool(
  orders: MaterialOrderWithDetails[],
  getSchoolName: (order: MaterialOrderWithDetails) => string
): Array<{ schoolName: string; orders: MaterialOrderWithDetails[] }> {
  const map: Record<string, MaterialOrderWithDetails[]> = {};
  const schoolOrder: string[] = [];
  for (const order of orders) {
    const schoolName = getSchoolName(order);
    if (!map[schoolName]) {
      map[schoolName] = [];
      schoolOrder.push(schoolName);
    }
    map[schoolName].push(order);
  }
  return schoolOrder.map((name) => ({ schoolName: name, orders: map[name] }));
}

// ============================
// Section 1: Unconfirmed - table view by textbook
// ============================
function UnconfirmedSection({
  orders,
  canEdit,
  changingId,
  onStatusChange,
  onDelete,
  formatDate,
  getSchoolName,
}: SubSectionWithDeleteProps) {
  const rows = useMemo(() => {
    return [...orders].sort((a, b) => {
      const nameA = a.material?.name || '';
      const nameB = b.material?.name || '';
      return nameA.localeCompare(nameB, 'ja');
    });
  }, [orders]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            <th className="text-left py-2 px-4 text-xs font-medium text-gray-500">テキスト名</th>
            <th className="text-left py-2 px-4 text-xs font-medium text-gray-500">教室</th>
            <th className="text-left py-2 px-4 text-xs font-medium text-gray-500">生徒</th>
            <th className="text-center py-2 px-4 text-xs font-medium text-gray-500">数量</th>
            <th className="text-left py-2 px-4 text-xs font-medium text-gray-500">発注日</th>
            {canEdit && (
              <>
                <th className="text-center py-2 px-4 text-xs font-medium text-gray-500">ステータス</th>
                <th className="text-center py-2 px-4 text-xs font-medium text-gray-500">操作</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((order) => (
            <tr key={order.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors duration-150">
              <td className="py-2 px-4 text-sm text-gray-900">{order.material?.name || '-'}</td>
              <td className="py-2 px-4 text-sm text-gray-600">{getSchoolName(order)}</td>
              <td className="py-2 px-4 text-sm text-gray-600">
                {order.student ? `${order.student.last_name} ${order.student.first_name}` : '-'}
              </td>
              <td className="py-2 px-4 text-center text-sm text-gray-900">{order.quantity}冊</td>
              <td className="py-2 px-4 text-sm text-gray-500">{formatDate(order.created_at)}</td>
              {canEdit && (
                <>
                  <td className="py-2 px-4 text-center">
                    <StatusDropdown order={order} changingId={changingId} onStatusChange={onStatusChange} />
                  </td>
                  <td className="py-2 px-4 text-center">
                    <button
                      onClick={() => { if (confirm('この発注を削除しますか？')) onDelete(order.id); }}
                      className="text-xs text-gray-400 hover:text-red-600 transition-colors duration-150"
                    >
                      削除
                    </button>
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============================
// Section 2: Ordered - grouped by classroom -> textbook
// ============================
function OrderedSection({
  orders,
  canEdit,
  changingId,
  onStatusChange,
  onDelete,
  formatDate,
  getSchoolName,
}: SubSectionWithDeleteProps) {
  const grouped = useMemo(() => {
    const groups = groupBySchool(orders, getSchoolName);
    for (const group of groups) {
      group.orders.sort((a: MaterialOrderWithDetails, b: MaterialOrderWithDetails) =>
        (a.material?.name || '').localeCompare(b.material?.name || '', 'ja')
      );
    }
    return groups;
  }, [orders, getSchoolName]);

  return (
    <div className="divide-y divide-gray-100">
      {grouped.map(({ schoolName, orders: schoolOrders }) => (
        <div key={schoolName} className="py-2">
          <div className="px-4 py-1.5 text-sm font-medium text-gray-700 bg-gray-50/50">
            {schoolName}
          </div>
          {schoolOrders.map((order) => (
            <div key={order.id} className="flex items-center justify-between px-4 py-1.5 pl-8 hover:bg-gray-50 transition-colors duration-150">
              <div className="flex items-center gap-4 flex-1 min-w-0">
                <span className="text-sm text-gray-900 truncate">{order.material?.name || '-'}</span>
                <span className="text-sm text-gray-600 whitespace-nowrap">{order.quantity}冊</span>
                <span className="text-xs text-gray-400 whitespace-nowrap">
                  {order.student ? `${order.student.last_name} ${order.student.first_name}` : ''}
                </span>
                <span className="text-xs text-gray-400 whitespace-nowrap">発注日: {formatDate(order.created_at)}</span>
              </div>
              {canEdit && (
                <div className="flex items-center gap-2 ml-2">
                  <StatusDropdown order={order} changingId={changingId} onStatusChange={onStatusChange} />
                  <button
                    onClick={() => { if (confirm('この発注を削除しますか？')) onDelete(order.id); }}
                    className="text-xs text-gray-400 hover:text-red-600 transition-colors duration-150"
                  >
                    削除
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ============================
// Section 3: Delivered - grouped by classroom -> student
// ============================
function DeliveredSection({
  orders,
  canEdit,
  changingId,
  onStatusChange,
  getSchoolName,
}: SubSectionProps) {
  const grouped = useMemo(() => {
    // Group by school, then by student
    const schoolGroups = groupBySchool(orders, getSchoolName);
    return schoolGroups.map(({ schoolName, orders: schoolOrders }) => {
      const studentMap: Record<string, MaterialOrderWithDetails[]> = {};
      const studentOrder: string[] = [];
      for (const order of schoolOrders) {
        const studentKey = order.student
          ? `${order.student.last_name} ${order.student.first_name}|${order.student.grade}`
          : '不明|0';
        if (!studentMap[studentKey]) {
          studentMap[studentKey] = [];
          studentOrder.push(studentKey);
        }
        studentMap[studentKey].push(order);
      }
      return {
        schoolName,
        students: studentOrder.map((key) => ({ key, orders: studentMap[key] })),
      };
    });
  }, [orders, getSchoolName]);

  return (
    <div className="divide-y divide-gray-100">
      {grouped.map(({ schoolName, students }) => (
        <div key={schoolName} className="py-2">
          <div className="px-4 py-1.5 text-sm font-medium text-gray-700 bg-gray-50/50">
            {schoolName}
          </div>
          {students.map(({ key: studentKey, orders: studentOrders }) => {
            const parts = studentKey.split('|');
            const name = parts[0];
            const grade = parseInt(parts[1], 10);
            const gradeLabel = GRADE_LABELS[grade] || '';
            return studentOrders.map((order) => (
              <div key={order.id} className="flex items-center justify-between px-4 py-1.5 pl-8 hover:bg-gray-50 transition-colors duration-150">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <span className="text-sm text-gray-900 whitespace-nowrap">
                    {name}{gradeLabel ? `（${gradeLabel}）` : ''}
                  </span>
                  <span className="text-sm text-gray-600 truncate">
                    {order.material?.name || '-'} x{order.quantity}
                  </span>
                </div>
                {canEdit && (
                  <div className="ml-2">
                    <StatusDropdown order={order} changingId={changingId} onStatusChange={onStatusChange} />
                  </div>
                )}
              </div>
            ));
          })}
        </div>
      ))}
    </div>
  );
}

// ============================
// Section 4: Distributed - grouped by classroom -> chronological
// ============================
function DistributedSection({
  orders,
  canEdit,
  changingId,
  onStatusChange,
  formatDate,
  getSchoolName,
}: SubSectionProps) {
  const grouped = useMemo(() => {
    const groups = groupBySchool(orders, getSchoolName);
    for (const group of groups) {
      group.orders.sort((a: MaterialOrderWithDetails, b: MaterialOrderWithDetails) => {
        const dateA = a.distributed_at || a.created_at || '';
        const dateB = b.distributed_at || b.created_at || '';
        return dateB.localeCompare(dateA);
      });
    }
    return groups;
  }, [orders, getSchoolName]);

  return (
    <div className="divide-y divide-gray-100">
      {grouped.map(({ schoolName, orders: schoolOrders }) => (
        <div key={schoolName} className="py-2">
          <div className="px-4 py-1.5 text-sm font-medium text-gray-700 bg-gray-50/50">
            {schoolName}
          </div>
          {schoolOrders.map((order) => (
            <div key={order.id} className="flex items-center justify-between px-4 py-1.5 pl-8 hover:bg-gray-50 transition-colors duration-150">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <span className="text-xs text-gray-400 whitespace-nowrap">
                  {formatDate(order.distributed_at || order.created_at)}
                </span>
                <span className="text-sm text-gray-900 whitespace-nowrap">
                  {order.student ? `${order.student.last_name} ${order.student.first_name}` : '-'}
                </span>
                <span className="text-sm text-gray-600 truncate">
                  {order.material?.name || '-'} x{order.quantity}
                </span>
              </div>
              {canEdit && (
                <div className="ml-2">
                  <StatusDropdown order={order} changingId={changingId} onStatusChange={onStatusChange} />
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
