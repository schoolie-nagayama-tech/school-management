'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import type { MonthlyTaskWithChecks, School, MonthlyTaskCategory } from '@/types/database';
import { TaskCheckboxRow } from './TaskCheckboxRow';
import { Plus, Calendar } from 'lucide-react';

interface TaskDayPanelProps {
  date: string;
  tasks: MonthlyTaskWithChecks[];
  schools: School[];
  year: number;
  month: number;
  canEdit: boolean;
  onToggleCheck: (taskId: string, schoolId: string, isCompleted: boolean) => void;
  onCreateTask: (taskDate: string, category: MonthlyTaskCategory, taskName: string, sortOrder: number) => void;
  onUpdateTask: (taskId: string, updates: Record<string, unknown>) => void;
  onDeleteTask: (taskId: string) => void;
  onUpdateNote: (taskId: string, note: string | null) => void;
}

function formatDateFull(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00');
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  return `${d.getMonth() + 1}月${d.getDate()}日(${weekdays[d.getDay()]})`;
}

function daysUntil(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + 'T00:00:00');
  return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

export function TaskDayPanel({
  date,
  tasks,
  schools,
  canEdit,
  onToggleCheck,
  onCreateTask,
  onUpdateTask,
  onDeleteTask,
  onUpdateNote,
}: TaskDayPanelProps) {
  const dayTasks = useMemo(
    () => tasks.filter((t) => t.task_date === date),
    [tasks, date]
  );
  const businessTasks = dayTasks.filter((t) => t.category === 'business');
  const courseTasks = dayTasks.filter((t) => t.category === 'course');

  const days = daysUntil(date);
  const isToday = days === 0;
  const isPast = days < 0;

  // 進捗
  const schoolIds = schools.map((s) => s.id);
  const completedCount = dayTasks.filter((t) =>
    schoolIds.every((sid) => t.checks.find((c) => c.school_id === sid)?.is_completed)
  ).length;

  // 新規追加
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState<MonthlyTaskCategory>('business');
  const addRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isAdding) addRef.current?.focus();
  }, [isAdding]);

  const handleAdd = () => {
    if (!newName.trim()) return;
    const maxSort = dayTasks.length > 0 ? Math.max(...dayTasks.map((t) => t.sort_order)) + 1 : 0;
    onCreateTask(date, newCategory, newName.trim(), maxSort);
    setNewName('');
    setIsAdding(false);
  };

  // D&Dソース（タスクをドラッグ可能にする）
  const handleDragStart = (e: React.DragEvent, taskId: string) => {
    e.dataTransfer.setData('text/task-id', taskId);
    e.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div className="h-full flex flex-col">
      {/* 日付ヘッダー */}
      <div className={`px-4 py-3 border-b ${
        isPast ? 'bg-red-50/50' : isToday ? 'bg-blue-50' : 'bg-white'
      }`}>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold">{formatDateFull(date)}</h2>
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
            isToday
              ? 'bg-blue-500 text-white'
              : isPast
              ? 'bg-red-100 text-red-700'
              : days <= 3
              ? 'bg-amber-100 text-amber-700'
              : 'bg-gray-100 text-gray-600'
          }`}>
            {isToday ? '今日' : isPast ? `${Math.abs(days)}日超過` : `あと${days}日`}
          </span>
        </div>
        {dayTasks.length > 0 && (
          <div className="text-[10px] text-gray-500 mt-1">
            {completedCount}/{dayTasks.length}件完了
          </div>
        )}
      </div>

      {/* タスクリスト */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {dayTasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-gray-400">
            <Calendar className="w-8 h-8 mb-2 text-gray-200" />
            <p className="text-xs">タスクなし</p>
          </div>
        ) : (
          <div className="space-y-2">
            {/* 業務系 */}
            {businessTasks.length > 0 && (
              <div>
                <div className="text-[10px] font-medium text-orange-600 mb-1 flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full bg-orange-400" />
                  業務 ({businessTasks.length})
                </div>
                <div className="space-y-0.5">
                  {businessTasks.map((task) => (
                    <div
                      key={task.id}
                      draggable={canEdit}
                      onDragStart={(e) => handleDragStart(e, task.id)}
                      className={canEdit ? 'cursor-grab active:cursor-grabbing' : ''}
                    >
                      <TaskCheckboxRow
                        task={task}
                        schools={schools}
                        canEdit={canEdit}
                        onToggleCheck={onToggleCheck}
                        onUpdateTask={onUpdateTask}
                        onDeleteTask={onDeleteTask}
                        onUpdateNote={onUpdateNote}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 講習系 */}
            {courseTasks.length > 0 && (
              <div>
                <div className="text-[10px] font-medium text-purple-600 mb-1 flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full bg-purple-400" />
                  講習 ({courseTasks.length})
                </div>
                <div className="space-y-0.5">
                  {courseTasks.map((task) => (
                    <div
                      key={task.id}
                      draggable={canEdit}
                      onDragStart={(e) => handleDragStart(e, task.id)}
                      className={canEdit ? 'cursor-grab active:cursor-grabbing' : ''}
                    >
                      <TaskCheckboxRow
                        task={task}
                        schools={schools}
                        canEdit={canEdit}
                        onToggleCheck={onToggleCheck}
                        onUpdateTask={onUpdateTask}
                        onDeleteTask={onDeleteTask}
                        onUpdateNote={onUpdateNote}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 新規追加 */}
        {canEdit && (
          <div className="mt-3">
            {isAdding ? (
              <div className="flex items-center gap-1.5 p-1.5 bg-gray-50 rounded-lg">
                <select
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value as MonthlyTaskCategory)}
                  className="text-[10px] px-1 py-1 border rounded bg-white"
                >
                  <option value="business">業務</option>
                  <option value="course">講習</option>
                </select>
                <input
                  ref={addRef}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAdd();
                    if (e.key === 'Escape') { setIsAdding(false); setNewName(''); }
                  }}
                  placeholder="タスク名..."
                  className="flex-1 text-xs px-2 py-1 border rounded focus:outline-none focus:ring-1 focus:ring-blue-300"
                />
                <button
                  onClick={handleAdd}
                  className="text-xs px-2 py-1 bg-[#d32f2f] text-white rounded hover:bg-[#b71c1c]"
                >
                  追加
                </button>
              </div>
            ) : (
              <button
                onClick={() => setIsAdding(true)}
                className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 w-full py-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                タスクを追加
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
