'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { AdminLayout } from '@/components/layouts';
import { Button, Loading, InlineLoading } from '@/components/ui';
import dynamic from 'next/dynamic';
import type { MaterialFormData } from '@/components/inventory';
import Link from 'next/link';
import type { CartItem } from '@/components/ordering/TextbookCatalog';

const MaterialForm = dynamic(
  () => import('@/components/inventory').then((m) => m.MaterialForm),
  { ssr: false }
);
const StockTransactionModal = dynamic(
  () => import('@/components/inventory').then((m) => m.StockTransactionModal),
  { ssr: false }
);
const TextbookCatalog = dynamic(
  () => import('@/components/ordering/TextbookCatalog').then((m) => m.TextbookCatalog),
  { ssr: false }
);
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
  const [students, setStudents] = useState<{ id: string; school_id: string; last_name: string; first_name: string; grade: number | null }[]>([]);
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
            school_id: s.school_id,
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
      transaction_type: stockTxnMode,
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

  const SAMPLE_VALUE = '__SAMPLE__';
  // 単語練習帳は教室ごとに在庫を持つため、発注時に生徒の所属教室から減算する。
  // 他の教材は従来通り選択中の最初の教室 (schoolIds[0]) で扱う。
  const VOCAB_BOOK_NAME = '単語練習帳';

  // --- Textbook Ordering (with auto stock decrement) ---
  const handleTextbookOrder = async (
    textbookName: string,
    studentId: string,
    quantity: number,
    notes: string
  ) => {
    const isSample = studentId === SAMPLE_VALUE;
    const isVocab = textbookName === VOCAB_BOOK_NAME;

    // 単語練習帳 + 実生徒の場合は生徒の所属教室を、それ以外は schoolIds[0] を使う
    const student = !isSample ? students.find((s) => s.id === studentId) : null;
    const targetSchoolId =
      isVocab && student?.school_id
        ? student.school_id
        : schoolIds.length > 0
        ? schoolIds[0]
        : undefined;

    // 該当教室の material を取得（単語練習帳は教室別レコードを正確に当てる必要がある）
    let material = materials.find(
      (m) =>
        m.name === textbookName &&
        (targetSchoolId ? m.school_id === targetSchoolId : true)
    );

    if (!material) {
      // 該当教室分の material を作成（単語練習帳は targetSchoolId のみ、他は schoolIds 全体に作成）
      material = await createMaterial(
        { name: textbookName, category: 'テキスト', unit: '冊' },
        isVocab && targetSchoolId
          ? [targetSchoolId]
          : schoolIds.length > 0
          ? schoolIds
          : undefined
      );
    }

    const orderData = {
      material_id: material.id,
      ...(isSample ? { is_sample: true } : { student_id: studentId }),
      quantity,
      notes: notes || undefined,
    };

    if (!isSample && activeBillingPeriod) {
      await createOrderWithBilling(orderData, activeBillingPeriod.id, targetSchoolId);
    } else {
      await createOrder(orderData, targetSchoolId);
    }

    // Auto-decrement stock by creating an 'out' transaction
    if (targetSchoolId) {
      try {
        await createStockTransaction({
          school_id: targetSchoolId,
          material_id: material.id,
          transaction_type: 'out',
          quantity,
          reason: isSample ? '見本発注による自動出庫' : '発注による自動出庫',
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
  // 単語練習帳は生徒の所属教室から在庫減算するため、item ごとに対象教室を決定して
  // 発注レコード・在庫減算の school_id を分ける（他の教材は schoolIds[0] のまま）。
  const handleBulkOrder = async (items: CartItem[]) => {
    const fallbackSchoolId = schoolIds.length > 0 ? schoolIds[0] : undefined;

    // (school_id, material name) で材料をキャッシュ。単語練習帳は教室別レコードを使うので
    // material_name 単独では衝突するためキーに school_id を含める。
    const materialKey = (name: string, schoolId: string | undefined) => `${schoolId ?? ''}::${name}`;
    const materialCache = new Map<string, Material>();
    for (const m of materials) {
      materialCache.set(materialKey(m.name, m.school_id), m);
    }

    type Entry = {
      material_id: string;
      student_id?: string;
      is_sample?: boolean;
      quantity: number;
      notes?: string;
      targetSchoolId: string | undefined;
    };
    const orderEntries: Entry[] = [];

    for (const item of items) {
      const isSample = item.studentId === SAMPLE_VALUE;
      const isVocab = item.textbookName === VOCAB_BOOK_NAME;
      const student = !isSample ? students.find((s) => s.id === item.studentId) : null;
      const targetSchoolId =
        isVocab && student?.school_id ? student.school_id : fallbackSchoolId;

      let material = materialCache.get(materialKey(item.textbookName, targetSchoolId));
      if (!material) {
        material = await createMaterial(
          { name: item.textbookName, category: 'テキスト', unit: '冊' },
          isVocab && targetSchoolId
            ? [targetSchoolId]
            : schoolIds.length > 0
            ? schoolIds
            : undefined
        );
        materialCache.set(materialKey(material.name, material.school_id), material);
      }

      orderEntries.push({
        material_id: material.id,
        ...(isSample ? { is_sample: true } : { student_id: item.studentId }),
        quantity: item.quantity,
        targetSchoolId,
      });
    }

    // 発注レコード作成（target school 別にグルーピング）
    if (activeBillingPeriod) {
      for (const entry of orderEntries) {
        const { targetSchoolId, ...orderData } = entry;
        await createOrderWithBilling(orderData, activeBillingPeriod.id, targetSchoolId);
      }
    } else {
      // 単語練習帳が混在すると school_id が異なるため、bulk insert は単一 school 用に分割
      const hasMixedSchool =
        new Set(orderEntries.map((e) => e.targetSchoolId)).size > 1 ||
        orderEntries.some((e) => e.is_sample);
      if (hasMixedSchool) {
        for (const entry of orderEntries) {
          const { targetSchoolId, ...orderData } = entry;
          await createOrder(orderData, targetSchoolId);
        }
      } else {
        const { targetSchoolId } = orderEntries[0] ?? { targetSchoolId: fallbackSchoolId };
        const payload = orderEntries.map(({ targetSchoolId: _ts, ...rest }) => rest);
        await createBulkOrders(
          payload as Array<{ material_id: string; student_id: string; quantity: number }>,
          targetSchoolId
        );
      }
    }

    // 在庫減算（item ごとに targetSchoolId を使う）
    for (const entry of orderEntries) {
      if (!entry.targetSchoolId) continue;
      try {
        await createStockTransaction({
          school_id: entry.targetSchoolId,
          material_id: entry.material_id,
          transaction_type: 'out',
          quantity: entry.quantity,
          reason: entry.is_sample ? '見本発注による自動出庫' : '発注による自動出庫',
        });
      } catch {
        console.warn('Auto stock decrement failed');
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
        <Loading className="min-h-[60vh]" />
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
        <div className="mb-4 bg-danger/20 text-danger px-4 py-2 rounded border border-danger">
          {errorMessage}
        </div>
      )}

      {/* Header Actions */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-gray-900">教材・発注管理</h2>
        <div className="flex items-center gap-2">
          <Link
            href="/ordering/history"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 transition-[background-color] duration-150 ease-out active:scale-[0.97]"
          >
            発注履歴
            {(() => {
              const unconfirmed = orders.filter((o) => o.status === 'unconfirmed').length;
              const ordered = orders.filter((o) => o.status === 'ordered').length;
              const delivered = orders.filter((o) => o.status === 'delivered').length;
              return (
                <>
                  {unconfirmed > 0 && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[11px] font-bold bg-yellow-100 text-yellow-700" title="未確認">
                      未確認 {unconfirmed}
                    </span>
                  )}
                  {ordered > 0 && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-100 text-blue-700" title="発注済み">
                      発注済 {ordered}
                    </span>
                  )}
                  {delivered > 0 && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[11px] font-bold bg-green-100 text-green-700" title="発送済み">
                      発送済 {delivered}
                    </span>
                  )}
                </>
              );
            })()}
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
          <InlineLoading />
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
    </AdminLayout>
  );
}
