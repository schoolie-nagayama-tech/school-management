'use client';

import { Pencil, Plus, Minus, Clock } from 'lucide-react';
import type { Material } from '@/types/database';

interface MaterialListProps {
  materials: Material[];
  onEdit: (material: Material) => void;
  onStockIn: (material: Material) => void;
  onStockOut: (material: Material) => void;
  onHistory: (material: Material) => void;
  canEdit: boolean;
}

export function MaterialList({
  materials,
  onEdit,
  onStockIn,
  onStockOut,
  onHistory,
  canEdit,
}: MaterialListProps) {
  if (materials.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-[#e5e7eb] p-8 text-center">
        <p className="text-[#4b5563]">教材が登録されていません。</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-[#e5e7eb] overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-[#f9fafb] border-b border-[#e5e7eb]">
              <th className="px-4 py-3 text-left text-xs font-medium text-[#4b5563] uppercase tracking-wider">
                名前
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-[#4b5563] uppercase tracking-wider">
                カテゴリ
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-[#4b5563] uppercase tracking-wider">
                単位
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-[#4b5563] uppercase tracking-wider">
                在庫数
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-[#4b5563] uppercase tracking-wider">
                閾値
              </th>
              <th className="px-4 py-3 text-center text-xs font-medium text-[#4b5563] uppercase tracking-wider">
                操作
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#e5e7eb]">
            {materials.map((material) => {
              const isLowStock = material.stock_quantity < material.low_stock_threshold;
              return (
                <tr key={material.id} className={isLowStock ? 'bg-red-50' : 'hover:bg-[#f9fafb]'}>
                  <td className="px-4 py-3 text-sm text-[#1f2937] font-medium">
                    {material.name}
                    {material.description && (
                      <span className="block text-xs text-[#4b5563] mt-0.5">
                        {material.description}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-[#4b5563]">{material.category || '-'}</td>
                  <td className="px-4 py-3 text-sm text-[#4b5563]">{material.unit}</td>
                  <td className="px-4 py-3 text-sm text-right">
                    <span className={isLowStock ? 'text-[#ef4444] font-bold' : 'text-[#1f2937]'}>
                      {material.stock_quantity}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-right text-[#4b5563]">
                    {material.low_stock_threshold}
                  </td>
                  <td className="px-4 py-3 text-sm text-center">
                    <div className="flex items-center justify-center gap-1">
                      {canEdit && (
                        <>
                          {/* 編集 */}
                          <button
                            onClick={() => onEdit(material)}
                            className="p-1.5 text-[#4b5563] hover:text-[#1e3a5f] hover:bg-[#f3f4f6] rounded-lg transition-[color,background-color] duration-150 ease-out"
                            title="編集"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          {/* 入庫 */}
                          <button
                            onClick={() => onStockIn(material)}
                            className="p-1.5 text-green-600 hover:text-green-800 hover:bg-green-50 rounded-lg transition-[color,background-color] duration-150 ease-out"
                            title="入庫"
                          >
                            <Plus className="w-4 h-4" />
                          </button>
                          {/* 出庫 */}
                          <button
                            onClick={() => onStockOut(material)}
                            className="p-1.5 text-[#ef4444] hover:text-red-800 hover:bg-red-50 rounded-lg transition-[color,background-color] duration-150 ease-out"
                            title="出庫"
                          >
                            <Minus className="w-4 h-4" />
                          </button>
                        </>
                      )}
                      {/* 履歴 */}
                      <button
                        onClick={() => onHistory(material)}
                        className="p-1.5 text-[#4b5563] hover:text-[#1e3a5f] hover:bg-[#f3f4f6] rounded-lg transition-[color,background-color] duration-150 ease-out"
                        title="履歴"
                      >
                        <Clock className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
