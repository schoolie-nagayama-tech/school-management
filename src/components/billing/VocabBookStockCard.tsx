'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getMaterials, createStockTransaction } from '@/lib/api/inventory';
import type { Material } from '@/types/database';

interface VocabBookStockCardProps {
  schoolIds: string[];
  stockDelta: number; // 外部からの在庫変動を受け取る（計上による増減）
}

export function VocabBookStockCard({ schoolIds, stockDelta }: VocabBookStockCardProps) {
  const [material, setMaterial] = useState<Material | null>(null);
  const [loading, setLoading] = useState(true);
  const lastAppliedDelta = useRef(0);
  const materialRef = useRef<Material | null>(null);

  const fetchMaterial = useCallback(async () => {
    if (schoolIds.length === 0) return;
    try {
      const materials = await getMaterials(schoolIds);
      const vocabBook = materials.find(m => m.name === '単語練習帳') || null;
      setMaterial(vocabBook);
      materialRef.current = vocabBook;
    } catch {
      // silent fail
    } finally {
      setLoading(false);
    }
  }, [schoolIds]);

  useEffect(() => {
    fetchMaterial();
  }, [fetchMaterial]);

  // stockDeltaが変わったら在庫トランザクションを作成
  useEffect(() => {
    if (stockDelta === lastAppliedDelta.current) return;
    const mat = materialRef.current;
    if (!mat) return;

    const diff = stockDelta - lastAppliedDelta.current;
    if (diff === 0) return;
    lastAppliedDelta.current = stockDelta;

    const applyDelta = async () => {
      try {
        const txnType = diff < 0 ? 'out' as const : 'in' as const;
        await createStockTransaction({
          material_id: mat.id,
          school_id: mat.school_id,
          transaction_type: txnType,
          quantity: Math.abs(diff),
          reason: '請求管理の計上による自動更新',
        });
        await fetchMaterial();
      } catch {
        // silent fail
      }
    };

    applyDelta();
  }, [stockDelta, fetchMaterial]);

  if (loading) return null;
  if (!material) return null;

  const isLowStock = material.stock_quantity <= material.low_stock_threshold;

  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm ${
      isLowStock
        ? 'bg-red-50 border-red-200 text-red-700'
        : 'bg-blue-50 border-blue-200 text-blue-700'
    }`}>
      <span className="font-medium">単語練習帳</span>
      <span className="text-xs text-gray-500">在庫</span>
      <span className={`font-bold text-lg ${isLowStock ? 'text-red-600' : 'text-blue-600'}`}>
        {material.stock_quantity}
      </span>
      <span className="text-xs text-gray-500">{material.unit || '冊'}</span>
      {isLowStock && (
        <span className="text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-medium">
          残少
        </span>
      )}
    </div>
  );
}
