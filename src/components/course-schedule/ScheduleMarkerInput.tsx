'use client';

import { useState, useRef, useEffect } from 'react';
import type { ScheduleMarker } from '@/types/database';

interface ScheduleMarkerInputProps {
  taskId: string;
  date: string;
  existing?: ScheduleMarker;
  onSave: (taskId: string, date: string, label: string, color?: string) => void;
  onDelete: (taskId: string, date: string) => void;
  onClose: () => void;
}

const QUICK_LABELS = ['作成', '回収', '発送', '開始', '締切', '確認', '実施', '完了'];
const MARKER_COLORS = [
  { label: '青', value: '#3b82f6' },
  { label: '赤', value: '#ef4444' },
  { label: '緑', value: '#10b981' },
  { label: '黄', value: '#f59e0b' },
  { label: '紫', value: '#8b5cf6' },
  { label: '黒', value: '#1e3a5f' },
];

export function ScheduleMarkerInput({
  taskId,
  date,
  existing,
  onSave,
  onDelete,
  onClose,
}: ScheduleMarkerInputProps) {
  const [label, setLabel] = useState(existing?.label || '');
  const [color, setColor] = useState(existing?.color || '#1e3a5f');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 外側クリックで閉じる
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const handleSave = () => {
    if (label.trim()) {
      onSave(taskId, date, label.trim(), color);
    }
    onClose();
  };

  const handleQuickLabel = (l: string) => {
    onSave(taskId, date, l, color);
    onClose();
  };

  const displayDate = (() => {
    const d = new Date(date + 'T00:00:00');
    return `${d.getMonth() + 1}/${d.getDate()}`;
  })();

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div ref={ref} className="bg-white rounded-xl border border-gray-200 shadow-2xl w-72 p-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-bold text-[#1e3a5f]">マーカー ({displayDate})</h4>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">&times;</button>
        </div>

        {/* テキスト入力 */}
        <input
          ref={inputRef}
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSave()}
          placeholder="ラベルを入力..."
          className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg mb-2"
          maxLength={10}
        />

        {/* クイックラベル */}
        <div className="flex flex-wrap gap-1 mb-3">
          {QUICK_LABELS.map((l) => (
            <button
              key={l}
              onClick={() => handleQuickLabel(l)}
              className="px-2 py-0.5 text-[10px] bg-gray-100 hover:bg-gray-200 text-gray-600 rounded transition-colors duration-150"
            >
              {l}
            </button>
          ))}
        </div>

        {/* 色選択 */}
        <div className="flex items-center gap-1.5 mb-3">
          <span className="text-[10px] text-gray-500">色:</span>
          {MARKER_COLORS.map((c) => (
            <button
              key={c.value}
              onClick={() => setColor(c.value)}
              className={`w-5 h-5 rounded-full border-2 transition-transform ${
                color === c.value ? 'border-gray-800 scale-110' : 'border-transparent'
              }`}
              style={{ backgroundColor: c.value }}
              title={c.label}
            />
          ))}
        </div>

        {/* アクションボタン */}
        <div className="flex justify-between">
          {existing ? (
            <button
              onClick={() => { onDelete(taskId, date); onClose(); }}
              className="text-xs text-[#ef4444] hover:text-[#dc2626]"
            >
              削除
            </button>
          ) : (
            <div />
          )}
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1 text-xs text-gray-500 hover:bg-gray-50 rounded"
            >
              キャンセル
            </button>
            <button
              onClick={handleSave}
              disabled={!label.trim()}
              className="px-3 py-1 text-xs bg-[#1e3a5f] text-white rounded hover:bg-[#2c5282] disabled:opacity-50"
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
