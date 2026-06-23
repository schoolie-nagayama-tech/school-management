'use client';

import { useState } from 'react';
import type { ScheduleTaskWithMarkers } from '@/types/database';

interface ScheduleTaskEditorProps {
  tasks: ScheduleTaskWithMarkers[];
  onAdd: (majorCategory: string, name: string, description?: string) => Promise<void>;
  onDelete: (taskId: string) => Promise<void>;
  onToggleComplete: (taskId: string, completed: boolean) => Promise<void>;
  onUpdateDates: (
    taskId: string,
    startDate: string | null,
    endDate: string | null
  ) => Promise<void>;
}

export function ScheduleTaskEditor({
  tasks,
  onAdd,
  onDelete,
  onToggleComplete,
  onUpdateDates,
}: ScheduleTaskEditorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');

  // 既存カテゴリ一覧
  const existingCategories = Array.from(new Set(tasks.map((t) => t.major_category)));

  const handleAdd = async () => {
    if (!newCategory.trim() || !newName.trim()) return;
    await onAdd(newCategory.trim(), newName.trim(), newDesc.trim() || undefined);
    setNewName('');
    setNewDesc('');
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600"
      >
        タスク管理
      </button>
    );
  }

  return (
    <div className="mb-4 bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-bold text-[#1e3a5f]">タスク管理</h4>
        <button
          onClick={() => setIsOpen(false)}
          className="text-xs text-gray-400 hover:text-gray-600"
        >
          閉じる
        </button>
      </div>

      {/* 新規追加 */}
      <div className="flex flex-wrap items-end gap-2 mb-4 pb-4 border-b border-gray-100">
        <div>
          <label className="text-[10px] text-gray-500 block mb-0.5">大項目</label>
          <input
            type="text"
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            placeholder="大項目名"
            className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg w-28"
            list="existing-categories"
          />
          <datalist id="existing-categories">
            {existingCategories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
        <div>
          <label className="text-[10px] text-gray-500 block mb-0.5">タスク名</label>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="タスク名"
            className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg w-36"
          />
        </div>
        <div>
          <label className="text-[10px] text-gray-500 block mb-0.5">説明</label>
          <input
            type="text"
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            placeholder="任意"
            className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg w-36"
          />
        </div>
        <button
          onClick={handleAdd}
          disabled={!newCategory.trim() || !newName.trim()}
          className="px-3 py-1.5 text-xs bg-[#1e3a5f] text-white rounded-lg hover:bg-[#2c5282] disabled:opacity-50"
        >
          追加
        </button>
      </div>

      {/* タスク一覧 */}
      <div className="space-y-1 max-h-72 overflow-y-auto">
        {tasks.map((task) => (
          <div
            key={task.id}
            className={`flex items-center justify-between gap-2 px-2 py-1.5 rounded text-xs ${
              task.is_completed ? 'bg-gray-50 text-gray-400' : ''
            }`}
          >
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <input
                type="checkbox"
                checked={task.is_completed}
                onChange={(e) => onToggleComplete(task.id, e.target.checked)}
                className="w-3.5 h-3.5 text-[#3b82f6] rounded shrink-0"
              />
              <span className="text-[10px] text-gray-400 shrink-0">[{task.major_category}]</span>
              <span className={`font-medium truncate ${task.is_completed ? 'line-through' : ''}`}>
                {task.name}
              </span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <input
                type="date"
                value={task.start_date || ''}
                onChange={(e) => onUpdateDates(task.id, e.target.value || null, task.end_date)}
                className="text-[10px] px-1 py-0.5 border border-gray-200 rounded w-[100px]"
                title="開始日"
              />
              <span className="text-gray-300">~</span>
              <input
                type="date"
                value={task.end_date || ''}
                onChange={(e) => onUpdateDates(task.id, task.start_date, e.target.value || null)}
                className="text-[10px] px-1 py-0.5 border border-gray-200 rounded w-[100px]"
                title="終了日"
              />
              <button
                onClick={() => {
                  if (confirm(`「${task.name}」を削除しますか？`)) onDelete(task.id);
                }}
                className="text-[10px] text-[#ef4444] hover:text-[#dc2626] px-1"
              >
                削除
              </button>
            </div>
          </div>
        ))}
        {tasks.length === 0 && (
          <p className="text-xs text-gray-400 text-center py-4">タスクがありません</p>
        )}
      </div>
    </div>
  );
}
