'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { AdminLayout } from '@/components/layouts';
import { Loading, ToastContainer } from '@/components/ui';
import { OrderStatusSection } from '@/components/ordering/OrderStatusSection';
import { getOrders, updateOrderStatus, deleteOrder } from '@/lib/api/ordering';
import { useMasterData } from '@/contexts/MasterDataContext';
import type { MaterialOrderWithDetails, OrderStatus } from '@/types/database';
import { useRequirePermission, useCanEdit } from '@/hooks/usePermissions';
import AccessDenied from '@/components/AccessDenied';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/useToast';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';
import { ArrowLeft, Truck } from 'lucide-react';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { DistributorOrderDialog } from '@/components/ordering/DistributorOrderDialog';

/** Slack通知を送信（失敗しても無視） */
async function sendSlackNotification(orderIds: string[], newStatus: string) {
  try {
    const sb = getSupabaseBrowserClient();
    const {
      data: { session },
    } = await sb.auth.getSession();
    if (!session) return;
    await fetch('/api/ordering/status', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ orderIds, newStatus }),
    });
  } catch {
    // Slack通知失敗は無視
  }
}

const DISPLAY_STATUSES: OrderStatus[] = ['unconfirmed', 'ordered', 'delivered', 'distributed'];

export default function OrderHistoryPage() {
  const { hasPermission, isLoading: permLoading } = useRequirePermission(
    (p) => p.canAccessOrdering
  );
  const canEdit = useCanEdit('canEditOrdering');
  const { getSelectedSchoolIds, selectedSchoolId } = useAuth();
  const { schools: masterSchools } = useMasterData();
  const { toasts, removeToast, success, error: toastError } = useToast();

  const [orders, setOrders] = useState<MaterialOrderWithDetails[]>([]);
  const [schoolMap, setSchoolMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [showAllDistributed, setShowAllDistributed] = useState(false);
  const [distributorOpen, setDistributorOpen] = useState(false);

  const fetchData = useCallback(async () => {
    const schoolIds = getSelectedSchoolIds();
    if (schoolIds.length === 0) return;
    setLoading(true);
    try {
      const ordersData = await getOrders(schoolIds);
      setOrders(ordersData);
      // Build school id -> name map
      const map: Record<string, string> = {};
      for (const school of masterSchools) {
        map[school.id] = school.name;
      }
      setSchoolMap(map);
    } catch (err) {
      toastError(getUserErrorMessage(err, 'データの取得に失敗しました'));
    } finally {
      setLoading(false);
    }
  }, [getSelectedSchoolIds, toastError, masterSchools]);

  useEffect(() => {
    if (selectedSchoolId !== null) fetchData();
  }, [selectedSchoolId, fetchData]);

  // Group orders by status (配布済みはデフォルト1ヶ月以内のみ表示)
  const { ordersByStatus, hiddenDistributedCount } = useMemo(() => {
    const map: Record<OrderStatus, MaterialOrderWithDetails[]> = {
      unconfirmed: [],
      ordered: [],
      delivered: [],
      distributed: [],
      cancelled: [],
    };
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
    let hiddenCount = 0;

    for (const order of orders) {
      if (!map[order.status]) continue;
      if (order.status === 'distributed' && !showAllDistributed) {
        const distributedDate = new Date(order.distributed_at || order.created_at);
        if (distributedDate < oneMonthAgo) {
          hiddenCount++;
          continue;
        }
      }
      map[order.status].push(order);
    }
    return { ordersByStatus: map, hiddenDistributedCount: hiddenCount };
  }, [orders, showAllDistributed]);

  // 取次発注ダイアログの宛先初期値: 未確認の発注が単一校舎なら、その校舎名/通知メールを既定にする
  const distributorDefaults = useMemo(() => {
    const unconfirmed = ordersByStatus.unconfirmed;
    const schoolIds = Array.from(new Set(unconfirmed.map((o) => o.school_id)));
    if (schoolIds.length !== 1) return { name: undefined, email: undefined };
    const school = masterSchools.find((s) => s.id === schoolIds[0]);
    return { name: school?.name, email: school?.notification_email };
  }, [ordersByStatus.unconfirmed, masterSchools]);

  const handleStatusChange = useCallback(
    async (orderId: string, newStatus: OrderStatus) => {
      try {
        await updateOrderStatus(orderId, newStatus);
        setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, status: newStatus } : o)));
        success('ステータスを更新しました');
        // Slack通知（発注・発送時のみ、バックグラウンド）
        sendSlackNotification([orderId], newStatus);
      } catch (err) {
        toastError(getUserErrorMessage(err, 'ステータスの更新に失敗しました'));
      }
    },
    [success, toastError]
  );

  const handleBulkStatusChange = useCallback(
    async (orderIds: string[], newStatus: OrderStatus) => {
      try {
        await Promise.all(orderIds.map((id) => updateOrderStatus(id, newStatus)));
        setOrders((prev) =>
          prev.map((o) => (orderIds.includes(o.id) ? { ...o, status: newStatus } : o))
        );
        success(`${orderIds.length}件のステータスを更新しました`);
        // Slack通知（発注・発送時のみ、バックグラウンド）
        sendSlackNotification(orderIds, newStatus);
      } catch (err) {
        toastError(getUserErrorMessage(err, '一括ステータス更新に失敗しました'));
      }
    },
    [success, toastError]
  );

  const handleDelete = useCallback(
    async (orderId: string) => {
      try {
        await deleteOrder(orderId);
        setOrders((prev) => prev.filter((o) => o.id !== orderId));
        success('発注を削除しました');
      } catch (err) {
        toastError(getUserErrorMessage(err, '削除に失敗しました'));
      }
    },
    [success, toastError]
  );

  if (permLoading) {
    return (
      <AdminLayout>
        <Loading className="min-h-[60vh]" />
      </AdminLayout>
    );
  }

  if (!hasPermission) {
    return (
      <AdminLayout>
        <AccessDenied />
      </AdminLayout>
    );
  }

  return (
    <AdminLayout headerTitle="教材発注履歴">
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      {/* Back link */}
      <div className="flex items-center justify-between mb-6">
        <Link
          href="/ordering"
          className="flex items-center gap-1.5 text-sm text-info hover:text-ink transition-[color] duration-150 ease-out"
        >
          <ArrowLeft className="w-4 h-4" />
          教材・発注管理に戻る
        </Link>
        {canEdit && ordersByStatus.unconfirmed.length > 0 && (
          <button
            onClick={() => setDistributorOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-info text-white rounded-lg hover:brightness-95 active:scale-[0.97] transition-[filter,transform] duration-150"
          >
            <Truck className="w-3.5 h-3.5" />
            取次サイトへ発注（{ordersByStatus.unconfirmed.length}）
          </button>
        )}
      </div>

      {loading ? (
        <Loading size="md" />
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
          {hiddenDistributedCount > 0 && (
            <div className="mt-2 text-center">
              <button
                onClick={() => setShowAllDistributed((v) => !v)}
                className="text-xs text-gray-500 hover:text-ink transition-[color] duration-150 ease-out"
              >
                {showAllDistributed
                  ? '1ヶ月以上前の配布済みを隠す'
                  : `1ヶ月以上前の配布済み（${hiddenDistributedCount}件）を表示`}
              </button>
            </div>
          )}
        </div>
      )}

      {distributorOpen && (
        <DistributorOrderDialog
          orders={ordersByStatus.unconfirmed}
          defaultSchoolName={distributorDefaults.name}
          defaultEmail={distributorDefaults.email}
          onClose={() => setDistributorOpen(false)}
        />
      )}
    </AdminLayout>
  );
}
