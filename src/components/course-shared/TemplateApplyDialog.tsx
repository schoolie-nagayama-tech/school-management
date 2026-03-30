'use client';

import { useState } from 'react';
import type { CourseTemplate } from '@/types/database';

interface TemplateApplyDialogProps {
  templates: CourseTemplate[];
  onApply: (templateId: string) => Promise<void>;
  onClose: () => void;
  isLoading?: boolean;
}

export function TemplateApplyDialog({
  templates,
  onApply,
  onClose,
  isLoading,
}: TemplateApplyDialogProps) {
  const [selectedId, setSelectedId] = useState<string>(
    templates.find((t) => t.is_default)?.id || templates[0]?.id || ''
  );
  const [applying, setApplying] = useState(false);

  const handleApply = async () => {
    if (!selectedId) return;
    setApplying(true);
    try {
      await onApply(selectedId);
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl border border-gray-200 shadow-2xl max-w-md w-full mx-4">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-bold text-[#1e3a5f]">テンプレートから作成</h3>
          <p className="text-sm text-gray-500 mt-1">
            テンプレートを選択して項目を初期化します
          </p>
        </div>
        <div className="px-6 py-4">
          {templates.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">
              利用可能なテンプレートがありません
            </p>
          ) : (
            <div className="space-y-2">
              {templates.map((t) => (
                <label
                  key={t.id}
                  className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    selectedId === t.id
                      ? 'border-[#3b82f6] bg-blue-50'
                      : 'border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="template"
                    value={t.id}
                    checked={selectedId === t.id}
                    onChange={(e) => setSelectedId(e.target.value)}
                    className="w-4 h-4 text-[#3b82f6]"
                  />
                  <div>
                    <p className="text-sm font-medium text-[#1e3a5f]">
                      {t.name}
                      {t.is_default && (
                        <span className="ml-2 px-1.5 py-0.5 text-[10px] bg-blue-100 text-blue-600 rounded">
                          デフォルト
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-gray-400">
                      {Array.isArray(t.template_data) ? t.template_data.length : 0}項目
                    </p>
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>
        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 rounded-lg"
            disabled={applying || isLoading}
          >
            キャンセル
          </button>
          <button
            onClick={handleApply}
            disabled={!selectedId || applying || isLoading || templates.length === 0}
            className="px-4 py-2 text-sm bg-[#1e3a5f] text-white rounded-lg hover:bg-[#2c5282] disabled:opacity-50"
          >
            {applying ? '適用中...' : '適用'}
          </button>
        </div>
      </div>
    </div>
  );
}
