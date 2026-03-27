'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { AdminLayout } from '@/components/layouts';
import { Button } from '@/components/ui';
import {
  MaterialForm,
  StockTransactionModal,
  StockHistoryDrawer,
} from '@/components/inventory';
import type { MaterialFormData } from '@/components/inventory';
import Link from 'next/link';
import { TextbookCatalog } from '@/components/ordering/TextbookCatalog';
import type { CartItem } from '@/components/ordering/TextbookCatalog';
import {
  getMaterials,
  createMaterial,
  updateMaterial,
  createStockTransaction,
} from '@/lib/api/inventory';
import {
  getOrders,
  createOrder,
  createOrderWithBilling,
  createBulkOrders,
} from '@/lib/api/ordering';
import { getStudents } from '@/lib/api/students';
import { getBillingPeriods } from '@/lib/api/billing';
import { getTextbooks } from '@/lib/api/textbooks';
import type {
  Material,
  MaterialOrderWithDetails,
  StockTransactionType,
  BillingPeriod,
  Textbook,
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
  const [textbooks, setTextbooks] = useState<Textbook[]>([]);
  const [activeBillingPeriod, setActiveBillingPeriod] = useState<BillingPeriod | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

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

      const [materialsData, ordersData, studentsData, billingPeriods, textbooksData] = await Promise.all([
        getMaterials(schoolIds),
        getOrders(schoolIds).catch(() => [] as MaterialOrderWithDetails[]),
        getStudents(undefined, schoolIds),
        getBillingPeriods(schoolIds).catch(() => [] as BillingPeriod[]),
        getTextbooks().catch(() => [] as Textbook[]),
      ]);

      setMaterials(materialsData);
      setOrders(ordersData);
      setTextbooks(textbooksData);
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

  const handleStockAdjust = (material: Material) => {
    setStockTxnMaterial(material);
    setStockTxnMode('adjust');
    setIsStockTxnOpen(true);
  };

  // --- Textbook Ordering (with auto stock decrement) ---
  const handleTextbookOrder = async (
    textbookName: string,
    studentId: string,
    quantity: number,
    notes: string
  ) => {
    const schoolId = schoolIds.length > 0 ? schoolIds[0] : undefined;

    // Check if a material already exists with this textbook name
    let material = materials.find((m) => m.name === textbookName);

    if (!material) {
      // Create a new material for this textbook
      material = await createMaterial(
        {
          name: textbookName,
          category: 'テキスト',
          unit: '冊',
        },
        schoolIds.length > 0 ? schoolIds : undefined
      );
    }

    const orderData = {
      material_id: material.id,
      student_id: studentId,
      quantity,
      notes: notes || undefined,
    };

    if (activeBillingPeriod) {
      await createOrderWithBilling(orderData, activeBillingPeriod.id, schoolId);
    } else {
      await createOrder(orderData, schoolId);
    }

    // Auto-decrement stock by creating an 'out' transaction
    if (schoolId) {
      try {
        await createStockTransaction({
          school_id: schoolId,
          material_id: material.id,
          transaction_type: 'out' as StockTransactionType,
          quantity,
          reason: '発注による自動出庫',
        });
      } catch {
        // Stock decrement is best-effort; don't block the order
        console.warn('Auto stock decrement failed');
      }
    }

    // Refresh all data
    fetchData();
  };

  // --- Bulk Order (Cart) ---
  const handleBulkOrder = async (items: CartItem[]) => {
    const schoolId = schoolIds.length > 0 ? schoolIds[0] : undefined;

    // Ensure materials exist for all items
    const materialCache = new Map<string, Material>();
    for (const m of materials) {
      materialCache.set(m.name, m);
    }

    const orderEntries: Array<{
      material_id: string;
      student_id: string;
      quantity: number;
      notes?: string;
    }> = [];

    for (const item of items) {
      let material = materialCache.get(item.textbookName);
      if (!material) {
        material = await createMaterial(
          { name: item.textbookName, category: 'テキスト', unit: '冊' },
          schoolIds.length > 0 ? schoolIds : undefined
        );
        materialCache.set(item.textbookName, material);
      }
      orderEntries.push({
        material_id: material.id,
        student_id: item.studentId,
        quantity: item.quantity,
      });
    }

    // Bulk insert orders
    if (activeBillingPeriod) {
      // With billing: create individually for billing linkage
      for (const entry of orderEntries) {
        await createOrderWithBilling(entry, activeBillingPeriod.id, schoolId);
      }
    } else {
      await createBulkOrders(orderEntries, schoolId);
    }

    // Auto-decrement stock
    if (schoolId) {
      for (const entry of orderEntries) {
        try {
          await createStockTransaction({
            school_id: schoolId,
            material_id: entry.material_id,
            transaction_type: 'out' as StockTransactionType,
            quantity: entry.quantity,
            reason: '発注による自動出庫',
          });
        } catch {
          console.warn('Auto stock decrement failed');
        }
      }
    }

    fetchData();
  };

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
          <Link
            href="/ordering/history"
            className="px-4 py-2 rounded-lg text-sm font-medium border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 transition-colors"
          >
            発注履歴 ({orders.length})
          </Link>
          {canEdit && (
            <Button
              onClick={() => {
                setEditingMaterial(null);
                setIsFormOpen(true);
              }}
              className="text-sm"
            >
              教材登録
            </Button>
          )}
        </div>
      </div>

      {/* Textbook Catalog (main content) */}
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
      ) : (
        <TextbookCatalog
          textbooks={textbooks}
          students={students}
          canEdit={canEdit}
          materials={materials}
          onOrder={handleTextbookOrder}
          onBulkOrder={handleBulkOrder}
          onStockAdjust={handleStockAdjust}
          onStockRegister={async (textbookName: string) => {
            // 在庫未登録のテキスト → まず Material を作成してから在庫調整モーダルを開く
            try {
              const schoolIds = getSelectedSchoolIds();
              const newMaterial = await createMaterial(
                { name: textbookName, category: 'テキスト', unit: '冊', low_stock_threshold: 3 },
                schoolIds
              );
              setStockTxnMaterial(newMaterial);
              setStockTxnMode('in');
              setIsStockTxnOpen(true);
            } catch (err) {
              setErrorMessage(getUserErrorMessage(err, '教材の登録に失敗しました'));
            }
          }}
        />
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
