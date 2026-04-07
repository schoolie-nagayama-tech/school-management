'use client';

import { useState } from 'react';
import type { MonthlyTaskTemplate } from '@/types/database';
import { GripVertical, ChevronDown, ChevronRight, Layers, Trash2 } from 'lucide-react';

interface PoolItem {
  task_name: string;
  category: 'business' | 'course';
  day_of_month: number;
  sort_order: number;
}

interface TaskPoolProps {
  templates: MonthlyTaskTemplate[];
  onLoadTemplate: (templateId: string) => void;
  onDropPoolItem: (item: PoolItem, targetDate: string) => void;
  canEdit: boolean;
  poolItems: PoolItem[];
  onSetPoolItems: (items: PoolItem[]) => void;
}

export function TaskPool({
  templates,
  onLoadTemplate,
  canEdit,
  poolItems,
  onSetPoolItems,
}: TaskPoolProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [trashOver, setTrashOver] = useState(false);

  // テンプレートをプールに読み込み
  const handleLoadTemplate = (tpl: MonthlyTaskTemplate) => {
    const items: PoolItem[] = tpl.template_data.map((item) => ({
      task_name: item.task_name,
      category: item.category,
      day_of_month: item.day_of_month,
      sort_order: item.sort_order,
    }));
    onSetPoolItems(items);
    setSelectedTemplateId(tpl.id);
  };

  // プールアイテムをドラッグ
  const handleDragStart = (e: React.DragEvent, item: PoolItem, index: number) => {
    e.dataTransfer.setData('text/pool-item', JSON.stringify({ ...item, poolIndex: index }));
    e.dataTransfer.effectAllowed = 'move';
    setIsDragging(true);
  };

  const handleDragEnd = () => {
    setIsDragging(false);
    setTrashOver(false);
  };

  const handleTrashDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setTrashOver(false);
    setIsDragging(false);
    const raw = e.dataTransfer.getData('text/pool-item');
    if (!raw) return;
    try {
      const data = JSON.parse(raw);
      const idx = data.poolIndex as number;
      onSetPoolItems(poolItems.filter((_, i) => i !== idx));
    } catch { /* ignore */ }
  };

  return (
    <div className="border border-gray-200 rounded-lg bg-white">
      {/* ヘッダー */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 transition-colors"
      >
        {isExpanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
        )}
        <Layers className="w-3.5 h-3.5 text-gray-500" />
        <span className="text-xs font-bold text-gray-700">タスクプール</span>
        {poolItems.length > 0 && (
          <span className="text-[10px] text-gray-400 ml-auto">{poolItems.length}件</span>
        )}
      </button>

      {isExpanded && (
        <div className="px-3 pb-3 space-y-2">
          {/* テンプレート選択 */}
          {poolItems.length === 0 && canEdit && (
            <div>
              <p className="text-[10px] text-gray-400 mb-1.5">テンプレートを選択してプールに読み込み:</p>
              {templates.length === 0 ? (
                <p className="text-[10px] text-gray-300 italic">テンプレートなし</p>
              ) : (
                <div className="space-y-1">
                  {templates.map((tpl) => (
                    <button
                      key={tpl.id}
                      onClick={() => handleLoadTemplate(tpl)}
                      className="w-full text-left text-xs px-2 py-1.5 bg-gray-50 hover:bg-gray-100 rounded transition-colors"
                    >
                      <span className="font-medium">{tpl.name}</span>
                      <span className="text-gray-400 ml-1">({tpl.template_data.length}件)</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* プールアイテム */}
          {poolItems.length > 0 && (
            <div className="space-y-1 max-h-48 overflow-y-auto">
              <div className="flex items-center justify-between mb-1">
                <p className="text-[10px] text-gray-400">カレンダーにD&Dで配置</p>
                {canEdit && (
                  <button
                    onClick={() => { onSetPoolItems([]); setSelectedTemplateId(null); }}
                    className="text-[10px] text-gray-400 hover:text-red-500"
                  >
                    クリア
                  </button>
                )}
              </div>
              {poolItems.map((item, idx) => (
                <div
                  key={`${item.task_name}-${idx}`}
                  draggable={canEdit}
                  onDragStart={(e) => handleDragStart(e, item, idx)}
                  onDragEnd={handleDragEnd}
                  className={`flex items-center gap-1 text-xs px-2 py-1.5 border rounded-lg transition-colors ${
                    canEdit ? 'cursor-grab active:cursor-grabbing hover:shadow-sm hover:border-blue-300' : ''
                  } ${
                    item.category === 'business'
                      ? 'border-orange-200 bg-orange-50/50'
                      : 'border-purple-200 bg-purple-50/50'
                  }`}
                >
                  {canEdit && <GripVertical className="w-3 h-3 text-gray-300 flex-shrink-0" />}
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                    item.category === 'business' ? 'bg-orange-400' : 'bg-purple-400'
                  }`} />
                  <span className="truncate flex-1">{item.task_name}</span>
                  <span className="text-[10px] text-gray-400 flex-shrink-0">{item.day_of_month}日</span>
                </div>
              ))}
              {/* ゴミ箱ドロップゾーン（ドラッグ中のみ表示） */}
              {isDragging && (
                <div
                  onDragOver={(e) => { e.preventDefault(); setTrashOver(true); }}
                  onDragLeave={() => setTrashOver(false)}
                  onDrop={handleTrashDrop}
                  className={`flex items-center justify-center gap-1.5 py-2 mt-1 border-2 border-dashed rounded-lg transition-colors ${
                    trashOver
                      ? 'border-red-400 bg-red-50 text-red-600'
                      : 'border-gray-300 bg-gray-50 text-gray-400'
                  }`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span className="text-[10px] font-medium">ここにドロップで削除</span>
                </div>
              )}
            </div>
          )}

          {/* 一括配置ボタン */}
          {poolItems.length > 0 && canEdit && (
            <button
              onClick={() => {
                if (selectedTemplateId) {
                  onLoadTemplate(selectedTemplateId);
                  onSetPoolItems([]);
                  setSelectedTemplateId(null);
                }
              }}
              className="w-full text-xs py-1.5 bg-[#d32f2f] text-white rounded hover:bg-[#b71c1c] transition-colors"
            >
              テンプレート日付で一括配置
            </button>
          )}
        </div>
      )}
    </div>
  );
}
