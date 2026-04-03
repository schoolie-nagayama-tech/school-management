'use client';

import { useState } from 'react';
import type { MonthlyTaskTemplate } from '@/types/database';
import { X, Play, Save, Trash2 } from 'lucide-react';

interface TemplateDialogProps {
  templates: MonthlyTaskTemplate[];
  onGenerate: (templateId: string) => void;
  onSave: (name: string) => void;
  onDelete: (templateId: string) => void;
  onClose: () => void;
  hasExistingTasks: boolean;
}

export function TemplateDialog({
  templates,
  onGenerate,
  onSave,
  onDelete,
  onClose,
  hasExistingTasks,
}: TemplateDialogProps) {
  const [saveName, setSaveName] = useState('');
  const [confirmGenerateId, setConfirmGenerateId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const handleGenerate = (templateId: string) => {
    if (hasExistingTasks && confirmGenerateId !== templateId) {
      setConfirmGenerateId(templateId);
      return;
    }
    onGenerate(templateId);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4">
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h2 className="text-sm font-bold">テンプレート管理</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* テンプレート一覧 */}
          <div>
            <h3 className="text-xs font-medium text-gray-600 mb-2">テンプレートから生成</h3>
            {templates.length === 0 ? (
              <p className="text-xs text-gray-400 py-3 text-center">テンプレートがありません</p>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {templates.map((tpl) => (
                  <div key={tpl.id} className="flex items-center gap-2 p-2 border rounded-lg hover:bg-gray-50">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium truncate">{tpl.name}</div>
                      <div className="text-[10px] text-gray-400">
                        {tpl.template_data.length}件のタスク
                        {tpl.is_default && (
                          <span className="ml-1 px-1 py-0.5 bg-blue-100 text-blue-600 rounded">デフォルト</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {confirmGenerateId === tpl.id ? (
                        <button
                          onClick={() => onGenerate(tpl.id)}
                          className="text-[10px] px-2 py-1 bg-orange-500 text-white rounded hover:bg-orange-600"
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
                          className="text-[10px] px-2 py-1 bg-red-500 text-white rounded hover:bg-red-600"
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
