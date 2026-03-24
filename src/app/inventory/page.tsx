'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { AdminLayout } from '@/components/layouts';
import { Button, Input } from '@/components/ui';
import {
  MaterialList,
  MaterialForm,
  StockTransactionModal,
  StockHistoryDrawer,
} from '@/components/inventory';
import type { MaterialFormData } from '@/components/inventory';
import {
  getMaterials,
  createMaterial,
  updateMaterial,
  createStockTransaction,
} from '@/lib/api/inventory';
import type { Material, StockTransactionType } from '@/types/database';
import { useRequirePermission, useCanEdit } from '@/hooks/usePermissions';
import AccessDenied from '@/components/AccessDenied';
import { useAuth } from '@/contexts/AuthContext';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';

export default function InventoryPage() {
  // 権限チェック
  const { hasPermission, isLoading: permissionLoading } = useRequirePermission(
    (p) => p.canAccessInventory
  );
  const canEdit = useCanEdit('canEditInventory');
  const { getSelectedSchoolIds, selectedSchoolId } = useAuth();

  // 状態管理
  const [materials, setMaterials] = useState<Material[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  // フィルター
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');

  // モーダル状態
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState<Material | null>(null);
  const [stockTxnMaterial, setStockTxnMaterial] = useState<Material | null>(
    null
  );
  const [stockTxnMode, setStockTxnMode] = useState<'in' | 'out' | 'adjust'>(
    'in'
  );
  const [isStockTxnOpen, setIsStockTxnOpen] = useState(false);
  const [historyMaterial, setHistoryMaterial] = useState<Material | null>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

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
      const data = await getMaterials(schoolIds);
      setMaterials(data);
    } catch (error) {
      console.error('Error fetching materials:', error);
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

  // カテゴリ一覧（フィルター用）
  const categories = useMemo(() => {
    const cats = new Set<string>();
    materials.forEach((m) => {
      if (m.category) cats.add(m.category);
    });
    return Array.from(cats).sort();
  }, [materials]);

  // フィルタリング
  const filteredMaterials = useMemo(() => {
    let result = materials;

    if (search) {
      const searchLower = search.toLowerCase();
      result = result.filter((m) =>
        m.name.toLowerCase().includes(searchLower)
      );
    }

    if (categoryFilter) {
      result = result.filter((m) => m.category === categoryFilter);
    }

    return result;
  }, [materials, search, categoryFilter]);

  // 教材作成（全ての選択教室に一括作成）
  const handleCreate = async (data: MaterialFormData) => {
    const schoolIds = getSelectedSchoolIds();
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

  // 教材更新
  const handleUpdate = async (data: MaterialFormData) => {
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

  // 在庫トランザクション
  const handleStockTransaction = async (txnData: {
    quantity: number;
    reason: string;
  }) => {
    if (!stockTxnMaterial) return;
    const schoolIds = getSelectedSchoolIds();
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

  // 編集を開く
  const handleEdit = (material: Material) => {
    setEditingMaterial(material);
    setIsFormOpen(true);
  };

  // 入庫を開く
  const handleStockIn = (material: Material) => {
    setStockTxnMaterial(material);
    setStockTxnMode('in');
    setIsStockTxnOpen(true);
  };

  // 出庫を開く
  const handleStockOut = (material: Material) => {
    setStockTxnMaterial(material);
    setStockTxnMode('out');
    setIsStockTxnOpen(true);
  };

  // 履歴を開く
  const handleHistory = (material: Material) => {
    setHistoryMaterial(material);
    setIsHistoryOpen(true);
  };

  // フォームを閉じる
  const handleFormClose = () => {
    setIsFormOpen(false);
    setEditingMaterial(null);
  };

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
    <AdminLayout headerTitle="在庫管理">
      {/* エラーメッセージ */}
      {errorMessage && (
        <div className="mb-4 bg-[#ef4444]/20 text-[#ef4444] px-4 py-2 rounded border border-[#ef4444]">
          {errorMessage}
        </div>
      )}

      {/* ツールバー */}
      <div className="mb-4 flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
          <Input
            placeholder="教材名で検索"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full sm:w-64"
          />
          <select
            className="px-3 py-2 border border-[#e5e7eb] rounded-lg bg-white text-[#4b5563] text-sm focus:ring-2 focus:ring-[#3b82f6] focus:border-[#3b82f6]"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          >
            <option value="">全てのカテゴリ</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </div>

        {canEdit && (
          <Button
            onClick={() => {
              setEditingMaterial(null);
              setIsFormOpen(true);
            }}
          >
            ＋ 教材追加
          </Button>
        )}
      </div>

      {/* テーブル */}
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
        <MaterialList
          materials={filteredMaterials}
          onEdit={handleEdit}
          onStockIn={handleStockIn}
          onStockOut={handleStockOut}
          onHistory={handleHistory}
          canEdit={canEdit}
        />
      )}

      {/* 教材作成・編集モーダル */}
      {isFormOpen && (
        <MaterialForm
          isOpen={isFormOpen}
          onClose={handleFormClose}
          onSubmit={editingMaterial ? handleUpdate : handleCreate}
          material={editingMaterial}
        />
      )}

      {/* 在庫トランザクションモーダル */}
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

      {/* 在庫履歴ドロワー */}
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
