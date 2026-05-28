'use client';

import { useState } from 'react';
import type { MonthlyTaskTemplate } from '@/types/database';
import { X, Play, Save, Trash2, Pencil, ChevronDown, ChevronRight, Plus, GripVertical, ArrowLeft } from 'lucide-react';

interface TemplateItem {
  day_of_month: number;
  task_name: string;
  category: 'business' | 'course';
  sort_order: number;
}

interface TemplateDialogProps {
  templates: MonthlyTaskTemplate[];
  onGenerate: (templateId: string) => void;
  onSave: (name: string) => void;
  onDelete: (templateId: string) => void;
  onUpdateTemplate?: (templateId: string, updates: { name?: string; template_data?: TemplateItem[] }) => Promise<void>;
  onClose: () => void;
  hasExistingTasks: boolean;
}

export function TemplateDialog({
  templates,
  onGenerate,
  onSave,
  onDelete,
  onUpdateTemplate,
  onClose,
  hasExistingTasks,
}: TemplateDialogProps) {
  const [saveName, setSaveName] = useState('');
  const [confirmGenerateId, setConfirmGenerateId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  // テンプレート編集
  const [editingTemplate, setEditingTemplate] = useState<MonthlyTaskTemplate | null>(null);
  const [editName, setEditName] = useState('');
  const [editItems, setEditItems] = useState<TemplateItem[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  // 展開表示
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const handleGenerate = (templateId: string) => {
    if (hasExistingTasks && confirmGenerateId !== templateId) {
      setConfirmGenerateId(templateId);
      return;
    }
    onGenerate(templateId);
  };

  // 編集開始
  const startEdit = (tpl: MonthlyTaskTemplate) => {
    setEditingTemplate(tpl);
    setEditName(tpl.name);
    setEditItems(tpl.template_data.map((item) => ({
      day_of_month: item.day_of_month,
      task_name: item.task_name,
      category: item.category as 'business' | 'course',
      sort_order: item.sort_order,
    })));
  };

  // 編集保存
  const handleSaveEdit = async () => {
    if (!editingTemplate || !onUpdateTemplate || !editName.trim()) return;
    setIsSaving(true);
    try {
      // sort_orderを振り直す
      const sorted = editItems.map((item, i) => ({ ...item, sort_order: i }));
      await onUpdateTemplate(editingTemplate.id, { name: editName.trim(), template_data: sorted });
      setEditingTemplate(null);
    } catch { /* handled by parent */ }
    finally { setIsSaving(false); }
  };

  // アイテム操作
  const updateItem = (index: number, updates: Partial<TemplateItem>) => {
    setEditItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...updates } : item)));
  };

  const removeItem = (index: number) => {
    setEditItems((prev) => prev.filter((_, i) => i !== index));
  };

  const addItem = () => {
    setEditItems((prev) => [
      ...prev,
      { day_of_month: 1, task_name: '', category: 'business' as const, sort_order: prev.length },
    ]);
  };

  // 編集画面
  if (editingTemplate) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col">
          {/* ヘッダー */}
          <div className="flex items-center gap-2 px-5 py-3 border-b flex-shrink-0">
            <button
              onClick={() => setEditingTemplate(null)}
              className="p-1 text-gray-400 hover:text-gray-600 rounded hover:bg-gray-100"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <h2 className="text-sm font-bold flex-1">テンプレート編集</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-3">
            {/* テンプレート名 */}
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder="テンプレート名"
              className="w-full text-sm px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 font-medium"
              disabled={isSaving}
            />

            {/* タスク一覧 */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">{editItems.length}件のタスク</span>
                <button
                  onClick={addItem}
                  className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 px-2 py-1 rounded hover:bg-blue-50"
                >
                  <Plus className="w-3 h-3" />
                  追加
                </button>
              </div>
              {editItems.map((item, idx) => (
                <div
                  key={idx}
                  className={`flex items-center gap-1.5 px-2 py-1.5 border rounded-lg text-xs ${
                    item.category === 'business' ? 'border-orange-200 bg-orange-50/30' : 'border-purple-200 bg-purple-50/30'
                  }`}
                >
                  <GripVertical className="w-3 h-3 text-gray-300 flex-shrink-0" />
                  <input
                    type="number"
                    min={1}
                    max={31}
                    value={item.day_of_month}
                    onChange={(e) => updateItem(idx, { day_of_month: Number(e.target.value) })}
                    className="w-12 px-1.5 py-1 border border-gray-300 rounded text-center focus:outline-none focus:ring-1 focus:ring-blue-400"
                    disabled={isSaving}
                    title="日"
                  />
                  <span className="text-gray-400">日</span>
                  <input
                    type="text"
                    value={item.task_name}
                    onChange={(e) => updateItem(idx, { task_name: e.target.value })}
                    placeholder="タスク名"
                    className="flex-1 px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400 min-w-0"
                    disabled={isSaving}
                  />
                  <select
                    value={item.category}
                    onChange={(e) => updateItem(idx, { category: e.target.value as 'business' | 'course' })}
                    className={`px-1.5 py-1 border rounded text-[11px] font-medium focus:outline-none focus:ring-1 focus:ring-blue-400 ${
                      item.category === 'business'
                        ? 'border-orange-300 text-orange-600 bg-orange-50'
                        : 'border-purple-300 text-purple-600 bg-purple-50'
                    }`}
                    disabled={isSaving}
                  >
                    <option value="business">業務</option>
                    <option value="course">講習</option>
                  </select>
                  <button
                    onClick={() => removeItem(idx)}
                    className="p-0.5 text-gray-300 hover:text-red-500 flex-shrink-0"
                    disabled={isSaving}
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* フッター */}
          <div className="flex items-center justify-end gap-2 px-5 py-3 border-t flex-shrink-0">
            <button
              onClick={() => setEditingTemplate(null)}
              className="text-xs px-3 py-1.5 text-gray-500 hover:text-gray-700 transition-[color] duration-150 ease-out"
              disabled={isSaving}
            >
              キャンセル
            </button>
            <button
              onClick={handleSaveEdit}
              disabled={isSaving || !editName.trim()}
              className="flex items-center gap-1 text-xs px-4 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-[background-color] duration-150 ease-out"
            >
              <Save className="w-3.5 h-3.5" />
              {isSaving ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 一覧画面
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 max-h-[80vh] flex flex-col">
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-5 py-3 border-b flex-shrink-0">
          <h2 className="text-sm font-bold">テンプレート管理</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* テンプレート一覧 */}
          <div>
            <h3 className="text-xs font-medium text-gray-600 mb-2">テンプレートから生成</h3>
            {templates.length === 0 ? (
              <p className="text-xs text-gray-400 py-3 text-center">テンプレートがありません</p>
            ) : (
              <div className="space-y-2">
                {templates.map((tpl) => (
                  <div key={tpl.id} className="border rounded-lg hover:bg-gray-50 transition-[background-color] duration-150 ease-out">
                    <div className="flex items-center gap-2 p-2">
                      {/* 展開ボタン */}
                      <button
                        onClick={() => setExpandedId(expandedId === tpl.id ? null : tpl.id)}
                        className="p-0.5 text-gray-400 hover:text-gray-600 flex-shrink-0"
                      >
                        {expandedId === tpl.id ? (
                          <ChevronDown className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5" />
                        )}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium truncate">{tpl.name}</div>
                        <div className="text-[11px] text-gray-400">
                          {tpl.template_data.length}件のタスク
                          {tpl.is_default && (
                            <span className="ml-1 px-1 py-0.5 bg-blue-100 text-blue-600 rounded">デフォルト</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        {/* 編集ボタン */}
                        {onUpdateTemplate && (
                          <button
                            onClick={() => startEdit(tpl)}
                            className="p-1 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded"
                            title="編集"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {confirmGenerateId === tpl.id ? (
                          <button
                            onClick={() => onGenerate(tpl.id)}
                            className="text-[11px] px-2 py-1 bg-orange-500 text-white rounded hover:bg-orange-600"
                          >
                            追加生成
                          </button>
                        ) : (
                          <button
                            onClick={() => handleGenerate(tpl.id)}
                            className="p-1 text-green-600 hover:bg-green-50 rounded"
                            title="生成"
                          >
                            <Play className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {confirmDeleteId === tpl.id ? (
                          <button
                            onClick={() => { onDelete(tpl.id); setConfirmDeleteId(null); }}
                            className="text-[11px] px-2 py-1 bg-red-500 text-white rounded hover:bg-red-600"
                          >
                            削除
                          </button>
                        ) : (
                          <button
                            onClick={() => setConfirmDeleteId(tpl.id)}
                            className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded"
                            title="削除"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                    {/* 展開: タスクプレビュー */}
                    {expandedId === tpl.id && (
                      <div className="px-3 pb-2 border-t border-gray-100">
                        <div className="space-y-0.5 mt-1.5 max-h-40 overflow-y-auto">
                          {tpl.template_data
                            .slice()
                            .sort((a, b) => a.day_of_month - b.day_of_month || a.sort_order - b.sort_order)
                            .map((item, idx) => (
                              <div key={idx} className="flex items-center gap-2 text-[11px] py-0.5">
                                <span className="text-gray-400 w-6 text-right flex-shrink-0">{item.day_of_month}日</span>
                                <span className={`w-1 h-1 rounded-full flex-shrink-0 ${
                                  item.category === 'business' ? 'bg-orange-400' : 'bg-purple-400'
                                }`} />
                                <span className="truncate text-gray-700">{item.task_name}</span>
                              </div>
                            ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* テンプレート保存 */}
          {hasExistingTasks && (
            <div className="border-t pt-3">
              <h3 className="text-xs font-medium text-gray-600 mb-2">現在の月をテンプレートとして保存</h3>
              <div className="flex items-center gap-2">
                <input
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  placeholder="テンプレート名..."
                  className="flex-1 text-xs px-3 py-1.5 border rounded focus:outline-none focus:ring-1 focus:ring-blue-300"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && saveName.trim()) {
                      onSave(saveName.trim());
                      setSaveName('');
                    }
                  }}
                />
                <button
                  onClick={() => {
                    if (saveName.trim()) {
                      onSave(saveName.trim());
                      setSaveName('');
                    }
                  }}
                  disabled={!saveName.trim()}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  保存
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
