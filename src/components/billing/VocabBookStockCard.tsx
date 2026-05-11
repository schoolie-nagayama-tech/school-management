'use client';

import { useState, useEffect, useCallback } from 'react';
import { getMaterials, createStockTransaction } from '@/lib/api/inventory';
import type { Material } from '@/types/database';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/useToast';
import { Pencil, Check, X } from 'lucide-react';

interface VocabBookStockCardProps {
  schoolIds: string[];
  refreshKey: number;
}

export function VocabBookStockCard({ schoolIds, refreshKey }: VocabBookStockCardProps) {
  const [material, setMaterial] = useState<Material | null>(null);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const { profile } = useAuth();
  const { success, error: toastError } = useToast();
  const isAdmin = profile?.role === 'admin' || profile?.role === 'owner';

  const fetchMaterial = useCallback(async () => {
    if (schoolIds.length === 0) return;
    try {
      const materials = await getMaterials(schoolIds);
      const vocabBook = materials.find(m => m.name === '単語練習帳') || null;
      setMaterial(vocabBook);
    } catch {
      // silent fail
    } finally {
      setLoading(false);
    }
  }, [schoolIds]);

  useEffect(() => {
    fetchMaterial();
  }, [fetchMaterial, refreshKey]);

  const handleAdjust = async () => {
    if (!material) return;
    const newQty = parseInt(editValue, 10);
    if (isNaN(newQty) || newQty < 0) {
      toastError('0以上の数値を入力してください');
      return;
    }
    setIsSaving(true);
    try {
      await createStockTransaction({
        material_id: material.id,
        school_id: material.school_id,
        transaction_type: 'adjust',
        quantity: newQty,
        reason: '管理者による手動調整',
      });
      await fetchMaterial();
      setIsEditing(false);
      success(`在庫を ${newQty} に調整しました`);
    } catch {
      toastError('在庫の調整に失敗しました');
    } finally {
      setIsSaving(false);
    }
  };

  if (loading || !material) return null;

  const isLowStock = material.stock_quantity <= material.low_stock_threshold;

  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm ${
      isLowStock
        ? 'bg-red-50 border-red-200 text-red-700'
        : 'bg-blue-50 border-blue-200 text-blue-700'
    }`}>
      <span className="font-medium">単語練習帳</span>
      <span className="text-xs text-gray-500">在庫</span>
      {isEditing ? (
        <div className="flex items-center gap-1">
          <input
            type="number"
            min="0"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAdjust();
              if (e.key === 'Escape') setIsEditing(false);
            }}
            autoFocus
            disabled={isSaving}
            className="w-16 px-1.5 py-0.5 text-center text-sm border border-blue-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
          <button
            onClick={handleAdjust}
            disabled={isSaving}
            className="p-0.5 text-green-600 hover:text-green-700 disabled:opacity-50"
            title="確定"
          >
            <Check className="w-4 h-4" />
          </button>
          <button
            onClick={() => setIsEditing(false)}
            className="p-0.5 text-gray-400 hover:text-gray-600"
            title="キャンセル"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <>
          <span className={`font-bold text-lg ${isLowStock ? 'text-red-600' : 'text-blue-600'}`}>
            {material.stock_quantity}
          </span>
          <span className="text-xs text-gray-500">{material.unit || '冊'}</span>
          {isLowStock && (
            <span className="text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-medium">
              残少
            </span>
          )}
          {isAdmin && (
            <button
              onClick={() => {
                setEditValue(String(material.stock_quantity));
                setIsEditing(true);
              }}
              className="p-0.5 text-gray-400 hover:text-blue-600 transition-colors"
              title="在庫数を調整"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          )}
        </>
      )}
    </div>
  );
}
