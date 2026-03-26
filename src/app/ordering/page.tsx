'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { AdminLayout } from '@/components/layouts';
import { Button, Input } from '@/components/ui';
import {
  MaterialForm,
  StockTransactionModal,
  StockHistoryDrawer,
} from '@/components/inventory';
import type { MaterialFormData } from '@/components/inventory';
import { MaterialCard } from '@/components/ordering/MaterialCard';
import { OrderHistoryPanel } from '@/components/ordering/OrderHistoryPanel';
import {
  getMaterials,
  createMaterial,
  updateMaterial,
  deleteMaterial,
  createStockTransaction,
} from '@/lib/api/inventory';
import {
  getOrders,
  createOrder,
  createOrderWithBilling,
  updateOrderStatus,
  deleteOrder,
} from '@/lib/api/ordering';
import { getStudents } from '@/lib/api/students';
import { getBillingPeriods } from '@/lib/api/billing';
import type {
  Material,
  MaterialOrderWithDetails,
  OrderStatus,
  StockTransactionType,
  BillingPeriod,
} from '@/types/database';
import { useRequirePermission, useCanEdit } from '@/hooks/usePermissions';
import AccessDenied from '@/components/AccessDenied';
import { useAuth } from '@/contexts/AuthContext';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';

export default function OrderingPage() {
  // Permissions
  const { hasPermission, isLoading: permissionLoading } = useRequirePermission(
    (p) => p.canAccessOrdering
  );
  const canEdit = useCanEdit('canEditOrdering');
  const { getSelectedSchoolIds, selectedSchoolId } = useAuth();

  // Data state
  const [materials, setMaterials] = useState<Material[]>([]);
  const [orders, setOrders] = useState<MaterialOrderWithDetails[]>([]);
  const [students, setStudents] = useState<{ id: string; last_name: string; first_name: string; grade: number | null }[]>([]);
  const [activeBillingPeriod, setActiveBillingPeriod] = useState<BillingPeriod | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  // Filters
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');

  // Order history panel
  const [showOrderHistory, setShowOrderHistory] = useState(false);

  // Material form modal
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState<Material | null>(null);

  // Stock modals
  const [stockTxnMaterial, setStockTxnMaterial] = useState<Material | null>(null);
  const [stockTxnMode, setStockTxnMode] = useState<'in' | 'out' | 'adjust'>('in');
  const [isStockTxnOpen, setIsStockTxnOpen] = useState(false);
  const [historyMaterial, setHistoryMaterial] = useState<Material | null>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  // Fetch all data
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

      const [materialsData, ordersData, studentsData, billingPeriods] = await Promise.all([
        getMaterials(schoolIds),
        getOrders(schoolIds).catch(() => [] as MaterialOrderWithDetails[]),
        getStudents(undefined, schoolIds),
        getBillingPeriods(schoolIds).catch(() => [] as BillingPeriod[]),
      ]);

      setMaterials(materialsData);
      setOrders(ordersData);
      setStudents(
        studentsData
          .filter((s) => s.status === 'active')
          .map((s) => ({
            id: s.id,
            last_name: s.last_name,
            first_name: s.first_name,
            grade: s.grade,
          }))
      );
      const active = billingPeriods.find((p) => p.is_active) || null;
      setActiveBillingPeriod(active);
    } catch (error) {
      console.error('Error fetching data:', error);
      setErrorMessage(getUserErrorMessage(error, 'データの取得に失敗しました'));
    } finally {
      setIsLoading(false);
    }
  }, [getSelectedSchoolIds]);

  useEffect(() => {
    if (selectedSchoolId !== null) {
      fetchData();
    }
  }, [fetchData, selectedSchoolId]);

  // Categories for filter
  const categories = useMemo(() => {
    const cats = new Set<string>();
    materials.forEach((m) => {
      if (m.category) cats.add(m.category);
    });
    return Array.from(cats).sort();
  }, [materials]);

  // Filtered materials
  const filteredMaterials = useMemo(() => {
    let result = materials;
    if (search) {
      const searchLower = search.toLowerCase();
      result = result.filter((m) => m.name.toLowerCase().includes(searchLower));
    }
    if (categoryFilter) {
      result = result.filter((m) => m.category === categoryFilter);
    }
    return result;
  }, [materials, search, categoryFilter]);

  const schoolIds = useMemo(() => getSelectedSchoolIds(), [getSelectedSchoolIds]);

  // --- Material CRUD ---
  const handleCreateMaterial = async (data: MaterialFormData) => {
    const targetSchoolIds = schoolIds.length > 0 ? schoolIds : undefined;
    await createMaterial(
      {
        name: data.name,
        description: data.description || null,
        category: data.category || null,
        unit: data.unit,
        low_stock_threshold: data.low_stock_threshold,
      },
      targetSchoolIds
    );
    fetchData();
  };

  const handleUpdateMaterial = async (data: MaterialFormData) => {
    if (!editingMaterial) return;
    await updateMaterial(editingMaterial.id, {
      name: data.name,
      description: data.description || null,
      category: data.category || null,
      unit: data.unit,
      low_stock_threshold: data.low_stock_threshold,
    });
    fetchData();
  };

  const handleDeleteMaterial = async (material: Material) => {
    if (!confirm(`「${material.name}」を削除しますか？`)) return;
    try {
      await deleteMaterial(material.id);
      fetchData();
    } catch (error) {
      setErrorMessage(getUserErrorMessage(error, '教材の削除に失敗しました'));
    }
  };

  // --- Stock ---
  const handleStockTransaction = async (txnData: { quantity: number; reason: string }) => {
    if (!stockTxnMaterial) return;
    const schoolId = schoolIds.length > 0 ? schoolIds[0] : '';
    await createStockTransaction({
      school_id: schoolId,
      material_id: stockTxnMaterial.id,
      transaction_type: stockTxnMode as StockTransactionType,
      quantity: txnData.quantity,
      reason: txnData.reason || null,
    });
    fetchData();
  };

  const handleStockIn = (material: Material) => {
    setStockTxnMaterial(material);
    setStockTxnMode('in');
    setIsStockTxnOpen(true);
  };

  const handleStockOut = (material: Material) => {
    setStockTxnMaterial(material);
    setStockTxnMode('out');
    setIsStockTxnOpen(true);
  };

  const handleHistory = (material: Material) => {
    setHistoryMaterial(material);
    setIsHistoryOpen(true);
  };

  const handleEdit = (material: Material) => {
    setEditingMaterial(material);
    setIsFormOpen(true);
  };

  // --- Ordering ---
  const handleOrder = async (
    materialId: string,
    studentId: string,
    quantity: number,
    notes: string
  ) => {
    const schoolId = schoolIds.length > 0 ? schoolIds[0] : undefined;
    const orderData = {
      material_id: materialId,
      student_id: studentId,
      quantity,
      notes: notes || undefined,
    };

    if (activeBillingPeriod) {
      await createOrderWithBilling(orderData, activeBillingPeriod.id, schoolId);
    } else {
      await createOrder(orderData, schoolId);
    }
    // Refresh orders
    const updatedOrders = await getOrders(schoolIds).catch(() => [] as MaterialOrderWithDetails[]);
    setOrders(updatedOrders);
  };

  const handleStatusChange = useCallback(
    async (orderId: string, newStatus: OrderStatus) => {
      try {
        await updateOrderStatus(orderId, newStatus);
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
        // Refresh materials to update stock counts
        const updatedMaterials = await getMaterials(schoolIds);
        setMaterials(updatedMaterials);
      } catch (error) {
        setErrorMessage(getUserErrorMessage(error, 'ステータスの更新に失敗しました'));
      }
    },
    [schoolIds]
  );

  const handleDeleteOrder = useCallback(
    async (orderId: string) => {
      if (!confirm('この発注を削除しますか？')) return;
      try {
        await deleteOrder(orderId);
        setOrders((prev) => prev.filter((o) => o.id !== orderId));
      } catch (error) {
        setErrorMessage(getUserErrorMessage(error, '発注の削除に失敗しました'));
      }
    },
    []
  );

  const handleFormClose = () => {
    setIsFormOpen(false);
    setEditingMaterial(null);
  };

  // Loading
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

  // Access denied
  if (!hasPermission) {
    return (
      <AdminLayout>
        <AccessDenied />
      </AdminLayout>
    );
  }

  return (
    <AdminLayout headerTitle="教材・発注管理">
      {/* Error Message */}
      {errorMessage && (
        <div className="mb-4 bg-[#ef4444]/20 text-[#ef4444] px-4 py-2 rounded border border-[#ef4444]">
          {errorMessage}
        </div>
      )}

      {/* Header Actions */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-gray-900">教材・発注管理</h2>
        <div className="flex items-center gap-2">
          {canEdit && (
            <Button
              onClick={() => {
                setEditingMaterial(null);
                setIsFormOpen(true);
              }}
              className="text-sm"
            >
              ＋ 教材登録
            </Button>
          )}
          <button
            onClick={() => setShowOrderHistory(!showOrderHistory)}
            className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
              showOrderHistory
                ? 'bg-[#1e3a5f] text-white border-[#1e3a5f]'
                : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
            }`}
          >
            発注履歴 ({orders.length})
          </button>
        </div>
      </div>

      {/* Order History Panel */}
      {showOrderHistory && (
        <div className="mb-4 bg-white rounded-xl border border-gray-200 shadow-sm">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-800">発注履歴</h3>
            <button
              onClick={() => setShowOrderHistory(false)}
              className="text-gray-400 hover:text-gray-600 text-sm"
            >
              閉じる
            </button>
          </div>
          <div className="p-4">
            <OrderHistoryPanel
              orders={orders}
              canEdit={canEdit}
              onStatusChange={handleStatusChange}
              onDelete={handleDeleteOrder}
            />
          </div>
        </div>
      )}

      {/* Search & Filter Bar */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[200px] max-w-xs">
          <Input
            placeholder="🔍 教材名で検索..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="px-3 py-2 border border-gray-200 rounded-lg bg-white text-gray-600 text-sm focus:ring-2 focus:ring-[#3b82f6] focus:border-[#3b82f6]"
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
        >
          <option value="">カテゴリ: 全て</option>
          {categories.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>
      </div>

      {/* Material Cards Grid */}
      {isLoading ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8">
          <div className="flex items-center justify-center">
            <svg className="animate-spin h-8 w-8 text-[#1e3a5f]" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            <span className="ml-3 text-[#4b5563]">読み込み中...</span>
          </div>
        </div>
      ) : filteredMaterials.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <div className="text-4xl mb-3">📦</div>
          <h3 className="text-lg font-semibold text-gray-800 mb-1">
            {materials.length === 0 ? '教材が登録されていません' : '検索条件に一致する教材がありません'}
          </h3>
          <p className="text-sm text-gray-500 mb-4">
            {materials.length === 0
              ? '「＋教材登録」ボタンから最初の教材を登録しましょう'
              : '検索条件やカテゴリフィルターを変更してみてください'}
          </p>
          {materials.length === 0 && canEdit && (
            <Button
              onClick={() => {
                setEditingMaterial(null);
                setIsFormOpen(true);
              }}
            >
              ＋ 教材を登録する
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredMaterials.map((material) => (
            <MaterialCard
              key={material.id}
              material={material}
              students={students}
              canEdit={canEdit}
              onEdit={handleEdit}
              onDelete={handleDeleteMaterial}
              onStockIn={handleStockIn}
              onStockOut={handleStockOut}
              onHistory={handleHistory}
              onOrder={handleOrder}
            />
          ))}
        </div>
      )}

      {/* Material Form Modal */}
      {isFormOpen && (
        <MaterialForm
          isOpen={isFormOpen}
          onClose={handleFormClose}
          onSubmit={editingMaterial ? handleUpdateMaterial : handleCreateMaterial}
          material={editingMaterial}
        />
      )}

      {/* Stock Transaction Modal */}
      {isStockTxnOpen && stockTxnMaterial && (
        <StockTransactionModal
          isOpen={isStockTxnOpen}
          onClose={() => {
            setIsStockTxnOpen(false);
            setStockTxnMaterial(null);
          }}
          material={stockTxnMaterial}
          mode={stockTxnMode}
          onSubmit={handleStockTransaction}
        />
      )}

      {/* Stock History Drawer */}
      {isHistoryOpen && historyMaterial && (
        <StockHistoryDrawer
          isOpen={isHistoryOpen}
          onClose={() => {
            setIsHistoryOpen(false);
            setHistoryMaterial(null);
          }}
          material={historyMaterial}
        />
      )}
    </AdminLayout>
  );
}
