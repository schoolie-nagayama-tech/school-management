'use client';

import { useState } from 'react';
import { StudentSelector } from './StudentSelector';
import type { Material } from '@/types/database';
import { Package, Inbox, Send, ClipboardList, ShoppingCart } from 'lucide-react';

interface StudentOption {
  id: string;
  last_name: string;
  first_name: string;
  grade: number | null;
}

interface MaterialCardProps {
  material: Material;
  students: StudentOption[];
  canEdit: boolean;
  onEdit: (material: Material) => void;
  onDelete: (material: Material) => void;
  onStockIn: (material: Material) => void;
  onStockOut: (material: Material) => void;
  onHistory: (material: Material) => void;
  onOrder: (
    materialId: string,
    studentId: string,
    quantity: number,
    notes: string,
    isSample?: boolean
  ) => Promise<void>;
}

export function MaterialCard({
  material,
  students,
  canEdit,
  onEdit,
  onDelete,
  onStockIn,
  onStockOut,
  onHistory,
  onOrder,
}: MaterialCardProps) {
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');
  const [isOrdering, setIsOrdering] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [orderSuccess, setOrderSuccess] = useState(false);

  const isLowStock = material.stock_quantity < material.low_stock_threshold;
  const stockRatio =
    material.low_stock_threshold > 0
      ? Math.min(material.stock_quantity / material.low_stock_threshold, 1.5)
      : 1;

  const getProgressColor = () => {
    if (stockRatio < 0.5) return 'bg-red-500';
    if (stockRatio < 1) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  const SAMPLE_VALUE = '__SAMPLE__';

  const handleOrder = async () => {
    if (!selectedStudentId) return;
    const isSample = selectedStudentId === SAMPLE_VALUE;
    setIsOrdering(true);
    try {
      await onOrder(material.id, isSample ? '' : selectedStudentId, quantity, notes, isSample);
      setSelectedStudentId('');
      setQuantity(1);
      setNotes('');
      setOrderSuccess(true);
      setTimeout(() => setOrderSuccess(false), 2000);
    } finally {
      setIsOrdering(false);
    }
  };

  return (
    <div
      className={`bg-white rounded-xl shadow-sm border ${
        isLowStock ? 'border-red-300' : 'border-gray-200'
      } flex flex-col`}
    >
      {/* Header */}
      <div className="px-4 pt-4 pb-2 flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-gray-900 truncate flex items-center gap-1.5">
            <Package className="w-4 h-4 text-gray-600" />
            {material.name}
          </h3>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-gray-500">
            {material.category && <span>カテゴリ: {material.category}</span>}
            {material.category && <span>|</span>}
            <span>単位: {material.unit}</span>
          </div>
        </div>
        {canEdit && (
          <div className="relative">
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="p-1 text-gray-400 hover:text-gray-600 rounded transition-[background-color,color] duration-150 ease-out"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
              </svg>
            </button>
            {showMenu && (
              <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-10 min-w-[100px]">
                <button
                  onClick={() => {
                    setShowMenu(false);
                    onEdit(material);
                  }}
                  className="block w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
                >
                  編集
                </button>
                <button
                  onClick={() => {
                    setShowMenu(false);
                    onDelete(material);
                  }}
                  className="block w-full text-left px-3 py-1.5 text-xs text-red-600 hover:bg-red-50"
                >
                  削除
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Stock Display */}
      <div className="px-4 py-2">
        <div className="bg-gray-50 rounded-lg p-3">
          <div
            className={`text-sm font-medium mb-1.5 ${isLowStock ? 'text-red-600' : 'text-gray-800'}`}
          >
            在庫: {material.stock_quantity} {material.unit}
            {isLowStock && <span className="ml-1.5 text-xs text-red-500">(不足)</span>}
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-[width] duration-500 ease-out ${getProgressColor()}`}
              style={{
                width: `${Math.min((material.stock_quantity / Math.max(material.low_stock_threshold, 1)) * 100, 100)}%`,
              }}
            />
          </div>
          <div className="text-xs text-gray-400 mt-1">
            {material.stock_quantity} / {material.low_stock_threshold} (閾値)
          </div>
        </div>
      </div>

      {/* Stock Actions */}
      <div className="px-4 py-1 flex items-center gap-2">
        <button
          onClick={() => onStockIn(material)}
          disabled={!canEdit}
          className="flex-1 text-xs py-1.5 rounded-lg border border-green-200 text-green-700 hover:bg-green-50 disabled:opacity-50 transition-[background-color,color] duration-150 ease-out"
        >
          <Inbox className="inline h-3 w-3 mr-1" />
          入庫
        </button>
        <button
          onClick={() => onStockOut(material)}
          disabled={!canEdit}
          className="flex-1 text-xs py-1.5 rounded-lg border border-orange-200 text-orange-700 hover:bg-orange-50 disabled:opacity-50 transition-[background-color,color] duration-150 ease-out"
        >
          <Send className="inline h-3 w-3 mr-1" />
          出庫
        </button>
        <button
          onClick={() => onHistory(material)}
          className="flex-1 text-xs py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-[background-color,color] duration-150 ease-out"
        >
          <ClipboardList className="inline h-3 w-3 mr-1" />
          履歴
        </button>
      </div>

      {/* Order Section */}
      {canEdit && (
        <div className="px-4 pt-2 pb-4 mt-1 border-t border-gray-100 flex-1 flex flex-col">
          <div className="text-xs font-medium text-gray-500 mb-2">発注</div>

          {/* Student Selector */}
          <div className="mb-2">
            <label className="block text-xs text-gray-500 mb-1">生徒</label>
            <StudentSelector
              students={students}
              value={selectedStudentId}
              onChange={setSelectedStudentId}
              disabled={isOrdering}
              showSampleOption
            />
          </div>

          {/* Quantity */}
          <div className="mb-2">
            <label className="block text-xs text-gray-500 mb-1">数量</label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                disabled={isOrdering || quantity <= 1}
                className="w-7 h-7 rounded border border-gray-200 flex items-center justify-center text-gray-600 hover:bg-gray-50 disabled:opacity-40 text-sm"
              >
                −
              </button>
              <input
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                disabled={isOrdering}
                className="w-14 text-center px-1 py-1 border border-gray-200 rounded text-sm"
              />
              <button
                type="button"
                onClick={() => setQuantity((q) => q + 1)}
                disabled={isOrdering}
                className="w-7 h-7 rounded border border-gray-200 flex items-center justify-center text-gray-600 hover:bg-gray-50 disabled:opacity-40 text-sm"
              >
                ＋
              </button>
            </div>
          </div>

          {/* Notes */}
          <div className="mb-3">
            <label className="block text-xs text-gray-500 mb-1">メモ</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="メモ（任意）"
              disabled={isOrdering}
              className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-sm bg-white placeholder-gray-400 focus:ring-2 focus:ring-[#1e3a5f]/20 focus:border-[#1e3a5f] transition-[background-color,color] duration-150 ease-out"
            />
          </div>

          {/* Order Button */}
          <button
            onClick={handleOrder}
            disabled={!selectedStudentId || isOrdering}
            className={`w-full py-2 rounded-lg font-medium text-sm transition-[background-color,color] duration-150 ease-out ${
              orderSuccess
                ? 'bg-green-600 text-white'
                : 'bg-[#1e3a5f] text-white hover:bg-[#162d4a] disabled:opacity-50 disabled:cursor-not-allowed'
            }`}
          >
            {isOrdering ? (
              '発注中...'
            ) : orderSuccess ? (
              '発注しました!'
            ) : (
              <>
                <ShoppingCart className="inline h-4 w-4 mr-1" />
                発注する
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
