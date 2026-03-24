'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { AdminLayout } from '@/components/layouts';
import { Button, Input } from '@/components/ui';
import { SelectShadcn as Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui';
import { OrderList, CreateOrderModal } from '@/components/ordering';
import { getOrders, updateOrderStatus, deleteOrder } from '@/lib/api/ordering';
import { getMaterials } from '@/lib/api/inventory';
import type { MaterialOrderWithDetails, Material, OrderStatus } from '@/types/database';
import { useRequirePermission, useCanEdit } from '@/hooks/usePermissions';
import AccessDenied from '@/components/AccessDenied';
import { useAuth } from '@/contexts/AuthContext';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';

const STATUS_FILTER_OPTIONS = [
  { value: 'all', label: 'すべて' },
  { value: 'pending', label: '未発注' },
  { value: 'ordered', label: '発注済' },
  { value: 'delivered', label: '納品済' },
  { value: 'distributed', label: '配布済' },
  { value: 'cancelled', label: 'キャンセル' },
];

export default function OrderingPage() {
  // 権限チェック
  const { hasPermission, isLoading: permissionLoading } = useRequirePermission(
    (p) => p.canAccessOrdering
  );
  const canEdit = useCanEdit('canEditOrdering');
  const { getSelectedSchoolIds, selectedSchoolId } = useAuth();

  // 状態管理
  const [orders, setOrders] = useState<MaterialOrderWithDetails[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // フィルター
  const [statusFilter, setStatusFilter] = useState('all');
  const [materialFilter, setMaterialFilter] = useState('all');
  const [searchFilter, setSearchFilter] = useState('');

  // データ取得
  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage('');
    try {
      const schoolIds = getSelectedSchoolIds();
      if (schoolIds.length === 0) {
        setErrorMessage('教室が選択されていません');
        setIsLoading(false);
        return;
      }

      const filters = {
        status: statusFilter !== 'all' ? statusFilter : undefined,
        materialId: materialFilter !== 'all' ? materialFilter : undefined,
        search: searchFilter || undefined,
      };

      const [ordersData, materialsData] = await Promise.all([
        getOrders(schoolIds, filters),
        getMaterials(schoolIds),
      ]);

      setOrders(ordersData);
      setMaterials(materialsData);
    } catch (error) {
      console.error('Error fetching ordering data:', error);
      setErrorMessage(getUserErrorMessage(error, 'データの取得に失敗しました'));
    } finally {
      setIsLoading(false);
    }
  }, [getSelectedSchoolIds, statusFilter, materialFilter, searchFilter]);

  // 初回読み込みと教室選択変更時
  useEffect(() => {
    if (selectedSchoolId !== null) {
      fetchData();
    }
  }, [fetchData, selectedSchoolId]);

  // ステータス変更
  const handleStatusChange = useCallback(
    async (orderId: string, newStatus: OrderStatus) => {
      try {
        await updateOrderStatus(orderId, newStatus);
        // ローカル状態を更新
        setOrders((prev) =>
          prev.map((order) => {
            if (order.id !== orderId) return order;
            const now = new Date().toISOString();
            const updates: Partial<MaterialOrderWithDetails> = { status: newStatus };
            if (newStatus === 'ordered') updates.ordered_at = now;
            if (newStatus === 'delivered') updates.delivered_at = now;
            if (newStatus === 'distributed') updates.distributed_at = now;
            return { ...order, ...updates };
          })
        );
      } catch (error) {
        console.error('Error updating order status:', error);
        setErrorMessage(getUserErrorMessage(error, 'ステータスの更新に失敗しました'));
      }
    },
    []
  );

  // 削除
  const handleDelete = useCallback(
    async (orderId: string) => {
      if (!confirm('この発注を削除しますか？')) return;
      try {
        await deleteOrder(orderId);
        setOrders((prev) => prev.filter((o) => o.id !== orderId));
      } catch (error) {
        console.error('Error deleting order:', error);
        setErrorMessage(getUserErrorMessage(error, '発注の削除に失敗しました'));
      }
    },
    []
  );

  // 作成後の再取得
  const handleOrderCreated = useCallback(() => {
    fetchData();
  }, [fetchData]);

  // schoolIds メモ
  const schoolIds = useMemo(() => getSelectedSchoolIds(), [getSelectedSchoolIds]);

  // 権限チェック中
  if (permissionLoading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <div className="w-12 h-12 border-4 border-[#1e3a5f] border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-[#4b5563]">読み込み中...</p>
          </div>
        </div>
      </AdminLayout>
    );
  }

  // 権限なし
  if (!hasPermission) {
    return (
      <AdminLayout>
        <AccessDenied />
      </AdminLayout>
    );
  }

  return (
    <AdminLayout headerTitle="発注管理">
      {/* エラーメッセージ */}
      {errorMessage && (
        <div className="mb-4 bg-[#ef4444]/20 text-[#ef4444] px-4 py-2 rounded border border-[#ef4444]">
          {errorMessage}
        </div>
      )}

      {/* フィルターバー */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {/* ステータスフィルター */}
        <div className="w-40">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger>
              <SelectValue placeholder="ステータス" />
            </SelectTrigger>
            <SelectContent>
              {STATUS_FILTER_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* 教材フィルター */}
        <div className="w-48">
          <Select value={materialFilter} onValueChange={setMaterialFilter}>
            <SelectTrigger>
              <SelectValue placeholder="教材" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">すべての教材</SelectItem>
              {materials.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* 検索 */}
        <div className="flex-1 min-w-[200px] max-w-xs">
          <Input
            placeholder="生徒名で検索..."
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
          />
        </div>

        {/* 新規発注ボタン */}
        {canEdit && (
          <div className="ml-auto">
            <Button onClick={() => setIsCreateModalOpen(true)}>
              ＋ 新規発注
            </Button>
          </div>
        )}
      </div>

      {/* 発注一覧 */}
      {isLoading ? (
        <div className="bg-white rounded-xl border border-[#e5e7eb] p-8">
          <div className="flex items-center justify-center">
            <svg
              className="animate-spin h-8 w-8 text-[#1e3a5f]"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            <span className="ml-3 text-[#4b5563]">読み込み中...</span>
          </div>
        </div>
      ) : (
        <OrderList
          orders={orders}
          canEdit={canEdit}
          onStatusChange={handleStatusChange}
          onDelete={handleDelete}
        />
      )}

      {/* 新規発注モーダル */}
      {canEdit && (
        <CreateOrderModal
          isOpen={isCreateModalOpen}
          onClose={() => setIsCreateModalOpen(false)}
          onCreated={handleOrderCreated}
          schoolIds={schoolIds}
        />
      )}
    </AdminLayout>
  );
}
