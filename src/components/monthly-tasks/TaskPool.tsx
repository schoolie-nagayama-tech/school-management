'use client';

import { useState } from 'react';
import type { MonthlyTaskTemplate } from '@/types/database';
import { GripVertical, ChevronDown, ChevronRight, Layers, Trash2, Pencil, Plus, X, Check } from 'lucide-react';

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
  onAddPoolItemAsTask?: (item: PoolItem, targetDate: string) => void;
  canEdit: boolean;
  poolItems: PoolItem[];
  onSetPoolItems: (items: PoolItem[]) => void;
  year: number;
  month: number;
}

export function TaskPool({
  templates,
  onLoadTemplate,
  canEdit,
  poolItems,
  onSetPoolItems,
  onAddPoolItemAsTask,
  year,
  month,
}: TaskPoolProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [trashOver, setTrashOver] = useState(false);
  // 編集
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editCategory, setEditCategory] = useState<'business' | 'course'>('business');
  const [editDay, setEditDay] = useState(1);
  // 日付選択して追加
  const [addingIndex, setAddingIndex] = useState<number | null>(null);
  const [addDate, setAddDate] = useState('');

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

  // 編集開始
  const startEdit = (index: number) => {
    const item = poolItems[index];
    setEditingIndex(index);
    setEditName(item.task_name);
    setEditCategory(item.category);
    setEditDay(item.day_of_month);
  };

  // 編集保存
  const saveEdit = () => {
    if (editingIndex === null || !editName.trim()) return;
    const updated = [...poolItems];
    updated[editingIndex] = {
      ...updated[editingIndex],
      task_name: editName.trim(),
      category: editCategory,
      day_of_month: editDay,
    };
    onSetPoolItems(updated);
    setEditingIndex(null);
  };

  // 日付選択して追加
  const handleAddToTaskList = (index: number) => {
    const item = poolItems[index];
    // デフォルト日付: テンプレートのday_of_monthをベースに
    const dayStr = String(item.day_of_month).padStart(2, '0');
    const monthStr = String(month).padStart(2, '0');
    setAddDate(`${year}-${monthStr}-${dayStr}`);
    setAddingIndex(index);
  };

  const confirmAdd = () => {
    if (addingIndex === null || !addDate || !onAddPoolItemAsTask) return;
    const item = poolItems[addingIndex];
    onAddPoolItemAsTask(item, addDate);
    // プールから削除
    onSetPoolItems(poolItems.filter((_, i) => i !== addingIndex));
    setAddingIndex(null);
    setAddDate('');
  };

  // 月の日数
  const daysInMonth = new Date(year, month, 0).getDate();

  return (
    <div className="border border-gray-200 rounded-lg bg-white">
      {/* ヘッダー */}
      <div className="flex items-center">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex-1 flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 transition-[background-color] duration-150 ease-out"
        >
          {isExpanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
          )}
          <Layers className="w-3.5 h-3.5 text-gray-500" />
          <span className="text-xs font-bold text-gray-700">タスクプール</span>
          {poolItems.length > 0 && (
            <span className="text-[11px] text-gray-400 ml-auto">{poolItems.length}件</span>
          )}
        </button>
        {/* ゴミ箱ドロップゾーン */}
        {poolItems.length > 0 && (
          <div
            onDragOver={(e) => { e.preventDefault(); setTrashOver(true); }}
            onDragLeave={() => setTrashOver(false)}
            onDrop={handleTrashDrop}
            className={`flex items-center gap-1 px-3 py-2 mr-1 rounded transition-[background-color,color,transform] duration-150 ease-out ${
              trashOver
                ? 'bg-red-100 text-red-600 scale-110'
                : isDragging
                  ? 'bg-red-50 text-red-400 animate-pulse'
                  : 'text-gray-300 hover:text-gray-400'
            }`}
            title="ドロップで削除"
          >
            <Trash2 className={`w-4 h-4 transition-transform ${trashOver ? 'scale-125' : ''}`} />
          </div>
        )}
      </div>

      {isExpanded && (
        <div className="px-3 pb-3 space-y-2">
          {/* テンプレート選択（プールが空のときだけでなく常に表示） */}
          {canEdit && templates.length > 0 && (
            <div>
              <p className="text-[11px] text-gray-400 mb-1.5">テンプレートを選択してプールに読み込み:</p>
              <div className="flex flex-wrap gap-1">
                {templates.map((tpl) => (
                  <button
                    key={tpl.id}
                    onClick={() => handleLoadTemplate(tpl)}
                    className={`text-xs px-2 py-1 rounded transition-[background-color,color] duration-150 ease-out ${
                      selectedTemplateId === tpl.id
                        ? 'bg-[#d32f2f] text-white'
                        : 'bg-gray-50 hover:bg-gray-100 text-gray-700'
                    }`}
                  >
                    {tpl.name}
                    <span className="text-gray-400 ml-1">({tpl.template_data.length})</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {canEdit && templates.length === 0 && poolItems.length === 0 && (
            <p className="text-[11px] text-gray-300 italic">テンプレートなし（テンプレートボタンから作成できます）</p>
          )}

          {/* プールアイテム */}
          {poolItems.length > 0 && (
            <div className="space-y-1 max-h-64 overflow-y-auto">
              <div className="flex items-center justify-between mb-1">
                <p className="text-[11px] text-gray-400">タスクリストにD&D、または＋ボタンで日付を選んで追加</p>
                {canEdit && (
                  <button
                    onClick={() => { onSetPoolItems([]); setSelectedTemplateId(null); }}
                    className="text-[11px] text-gray-400 hover:text-red-500"
                  >
                    クリア
                  </button>
                )}
              </div>
              {poolItems.map((item, idx) => (
                <div key={`${item.task_name}-${idx}`}>
                  {editingIndex === idx ? (
                    /* 編集モード */
                    <div className="text-xs px-2 py-2 border rounded-lg border-blue-300 bg-blue-50/50 space-y-1.5">
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="w-full text-xs px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
                        placeholder="タスク名"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.nativeEvent.isComposing) saveEdit();
                          if (e.key === 'Escape') setEditingIndex(null);
                        }}
                      />
                      <div className="flex items-center gap-2">
                        <select
                          value={editCategory}
                          onChange={(e) => setEditCategory(e.target.value as 'business' | 'course')}
                          className="text-xs px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
                        >
                          <option value="business">業務</option>
                          <option value="course">講習</option>
                        </select>
                        <div className="flex items-center gap-1">
                          <span className="text-gray-500">日:</span>
                          <input
                            type="number"
                            min={1}
                            max={daysInMonth}
                            value={editDay}
                            onChange={(e) => setEditDay(Number(e.target.value))}
                            className="w-14 text-xs px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
                          />
                        </div>
                        <div className="flex gap-1 ml-auto">
                          <button
                            onClick={() => setEditingIndex(null)}
                            className="p-1 text-gray-400 hover:text-gray-600 rounded hover:bg-gray-100"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={saveEdit}
                            disabled={!editName.trim()}
                            className="p-1 text-blue-600 hover:text-blue-800 rounded hover:bg-blue-50 disabled:opacity-50"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : addingIndex === idx ? (
                    /* 日付選択して追加モード */
                    <div className="text-xs px-2 py-2 border rounded-lg border-green-300 bg-green-50/50">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                          item.category === 'business' ? 'bg-orange-400' : 'bg-purple-400'
                        }`} />
                        <span className="font-medium truncate flex-1">{item.task_name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-gray-500">追加先:</span>
                        <input
                          type="date"
                          value={addDate}
                          onChange={(e) => setAddDate(e.target.value)}
                          className="text-xs px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-green-400"
                          autoFocus
                        />
                        <div className="flex gap-1 ml-auto">
                          <button
                            onClick={() => setAddingIndex(null)}
                            className="p-1 text-gray-400 hover:text-gray-600 rounded hover:bg-gray-100"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={confirmAdd}
                            disabled={!addDate}
                            className="p-1 text-green-600 hover:text-green-800 rounded hover:bg-green-50 disabled:opacity-50"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* 通常表示 */
                    <div
                      draggable={canEdit}
                      onDragStart={(e) => handleDragStart(e, item, idx)}
                      onDragEnd={handleDragEnd}
                      className={`flex items-center gap-1 text-xs px-2 py-1.5 border rounded-lg transition-[background-color] duration-150 ease-out group ${
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
                      <span className="text-[11px] text-gray-400 flex-shrink-0">{item.day_of_month}日</span>
                      {/* 編集ボタン */}
                      {canEdit && (
                        <button
                          onClick={(e) => { e.stopPropagation(); startEdit(idx); }}
                          className="p-0.5 text-gray-300 hover:text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity duration-150 flex-shrink-0"
                          title="編集"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                      )}
                      {/* 日付選択追加ボタン */}
                      {canEdit && onAddPoolItemAsTask && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleAddToTaskList(idx); }}
                          className="p-0.5 text-gray-300 hover:text-green-500 opacity-0 group-hover:opacity-100 transition-opacity duration-150 flex-shrink-0"
                          title="日付を選んでタスクリストに追加"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
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
              className="w-full text-xs py-1.5 bg-[#d32f2f] text-white rounded hover:bg-[#b71c1c] transition-[background-color] duration-150 ease-out"
            >
              テンプレート日付で一括配置
            </button>
          )}
        </div>
      )}
    </div>
  );
}
