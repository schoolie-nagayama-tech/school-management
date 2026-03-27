'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { AdminLayout } from '@/components/layouts';
import { OrderStatusSection } from '@/components/ordering/OrderStatusSection';
import { getOrders, updateOrderStatus, deleteOrder } from '@/lib/api/ordering';
import { getSchools } from '@/lib/api/schools';
import type { MaterialOrderWithDetails, OrderStatus } from '@/types/database';
import { useRequirePermission, useCanEdit } from '@/hooks/usePermissions';
import AccessDenied from '@/components/AccessDenied';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/useToast';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';
import { ArrowLeft } from 'lucide-react';
import { getSupabaseBrowserClient } from '@/lib/supabase';

/** Slack通知を送信（失敗しても無視） */
async function sendSlackNotification(orderIds: string[], newStatus: string) {
  try {
    const sb = getSupabaseBrowserClient();
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return;
    await fetch('/api/ordering/status', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ orderIds, newStatus }),
    });
  } catch {
    // Slack通知失敗は無視
  }
}

const DISPLAY_STATUSES: OrderStatus[] = ['unconfirmed', 'ordered', 'delivered', 'distributed'];

export default function OrderHistoryPage() {
  const { hasPermission, isLoading: permLoading } = useRequirePermission((p) => p.canAccessOrdering);
  const canEdit = useCanEdit('canEditOrdering');
  const { getSelectedSchoolIds, selectedSchoolId } = useAuth();
  const { success, error: toastError } = useToast();

  const [orders, setOrders] = useState<MaterialOrderWithDetails[]>([]);
  const [schoolMap, setSchoolMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    const schoolIds = getSelectedSchoolIds();
    if (schoolIds.length === 0) return;
    setLoading(true);
    try {
      const [ordersData, schoolsData] = await Promise.all([
        getOrders(schoolIds),
        getSchools(),
      ]);
      setOrders(ordersData);
      // Build school id -> name map
      const map: Record<string, string> = {};
      for (const school of schoolsData) {
        map[school.id] = school.name;
      }
      setSchoolMap(map);
    } catch (err) {
      toastError(getUserErrorMessage(err, 'データの取得に失敗しました'));
    } finally {
      setLoading(false);
    }
  }, [getSelectedSchoolIds, toastError]);

  useEffect(() => {
    if (selectedSchoolId !== null) fetchData();
  }, [selectedSchoolId, fetchData]);

  // Group orders by status
  const ordersByStatus = useMemo(() => {
    const map: Record<OrderStatus, MaterialOrderWithDetails[]> = {
      unconfirmed: [],
      ordered: [],
      delivered: [],
      distributed: [],
      cancelled: [],
    };
    for (const order of orders) {
      if (map[order.status]) {
        map[order.status].push(order);
      }
    }
    return map;
  }, [orders]);

  const handleStatusChange = useCallback(async (orderId: string, newStatus: OrderStatus) => {
    try {
      await updateOrderStatus(orderId, newStatus);
      setOrders((prev) => prev.map((o) => o.id === orderId ? { ...o, status: newStatus } : o));
      success('ステータスを更新しました');
      // Slack通知（発注・発送時のみ、バックグラウンド）
      sendSlackNotification([orderId], newStatus);
    } catch (err) {
      toastError(getUserErrorMessage(err, 'ステータスの更新に失敗しました'));
    }
  }, [success, toastError]);

  const handleBulkStatusChange = useCallback(async (orderIds: string[], newStatus: OrderStatus) => {
    try {
      await Promise.all(orderIds.map((id) => updateOrderStatus(id, newStatus)));
      setOrders((prev) => prev.map((o) => orderIds.includes(o.id) ? { ...o, status: newStatus } : o));
      success(`${orderIds.length}件のステータスを更新しました`);
      // Slack通知（発注・発送時のみ、バックグラウンド）
      sendSlackNotification(orderIds, newStatus);
    } catch (err) {
      toastError(getUserErrorMessage(err, '一括ステータス更新に失敗しました'));
    }
  }, [success, toastError]);

  const handleDelete = useCallback(async (orderId: string) => {
    try {
      await deleteOrder(orderId);
      setOrders((prev) => prev.filter((o) => o.id !== orderId));
      success('発注を削除しました');
    } catch (err) {
      toastError(getUserErrorMessage(err, '削除に失敗しました'));
    }
  }, [success, toastError]);

  if (permLoading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="w-10 h-10 border-4 border-[#1e3a5f] border-t-transparent rounded-full animate-spin" />
        </div>
      </AdminLayout>
    );
  }

  if (!hasPermission) {
    return <AdminLayout><AccessDenied /></AdminLayout>;
  }

  return (
    <AdminLayout headerTitle="教材発注履歴">
      {/* Back link */}
      <div className="flex items-center justify-between mb-6">
        <Link
          href="/ordering"
          className="flex items-center gap-1.5 text-sm text-[#3b82f6] hover:text-[#1e3a5f] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          教材・発注管理に戻る
        </Link>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-500 text-sm">読み込み中...</div>
      ) : orders.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <p className="text-gray-500 text-sm">発注履歴がありません</p>
        </div>
      ) : (
        <div className="space-y-0">
          {DISPLAY_STATUSES.map((status) => (
            <OrderStatusSection
              key={status}
              status={status}
              orders={ordersByStatus[status]}
              schoolMap={schoolMap}
              canEdit={canEdit}
              defaultOpen={status !== 'distributed'}
              onStatusChange={handleStatusChange}
              onBulkStatusChange={handleBulkStatusChange}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </AdminLayout>
  );
}
