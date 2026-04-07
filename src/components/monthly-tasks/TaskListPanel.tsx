'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import type { MonthlyTaskWithChecks, School } from '@/types/database';
import { CheckCircle2, Circle, GripVertical, Plus, ChevronDown, ChevronRight, Trash2 } from 'lucide-react';

interface TaskListPanelProps {
  tasks: MonthlyTaskWithChecks[];
  schools: School[];
  year: number;
  month: number;
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
  onToggleCheck: (taskId: string, schoolId: string, isCompleted: boolean) => void;
  onCreateTask?: (taskDate: string, taskName: string, category: 'business' | 'course') => Promise<void>;
  onDeleteTask?: (taskId: string) => Promise<void>;
  canEdit: boolean;
}

function formatDow(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00');
  return ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
}

function getToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function TaskListPanel({
  tasks,
  schools,
  year,
  month,
  selectedDate,
  onSelectDate,
  onToggleCheck,
  onCreateTask,
  onDeleteTask,
  canEdit,
}: TaskListPanelProps) {
  const [filter, setFilter] = useState<'all' | 'incomplete' | 'overdue'>('all');
  const [collapsedDates, setCollapsedDates] = useState<Set<string>>(new Set());
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTaskName, setNewTaskName] = useState('');
  const [newTaskDate, setNewTaskDate] = useState('');
  const [newTaskCategory, setNewTaskCategory] = useState<'business' | 'course'>('business');
  const [isCreating, setIsCreating] = useState(false);
  const addInputRef = useRef<HTMLInputElement>(null);
  const today = getToday();
  const schoolIds = schools.map(s => s.id);

  // フォームを開いたらフォーカス
  useEffect(() => {
    if (showAddForm && addInputRef.current) {
      addInputRef.current.focus();
    }
  }, [showAddForm]);

  const handleOpenAddForm = () => {
    // デフォルト日付: 選択中の日付 or 今日
    const defaultDate = selectedDate || `${year}-${String(month).padStart(2, '0')}-01`;
    setNewTaskDate(defaultDate);
    setNewTaskName('');
    setNewTaskCategory('business');
    setShowAddForm(true);
  };

  const handleAddTask = async () => {
    if (!newTaskName.trim() || !newTaskDate || !onCreateTask) return;
    setIsCreating(true);
    try {
      await onCreateTask(newTaskDate, newTaskName.trim(), newTaskCategory);
      setShowAddForm(false);
      setNewTaskName('');
    } catch { /* handled by parent */ }
    finally { setIsCreating(false); }
  };

  const filtered = useMemo(() => {
    return tasks.filter(t => {
      const allDone = schoolIds.every(sid =>
        t.checks.find(c => c.school_id === sid)?.is_completed
      );
      if (filter === 'incomplete') return !allDone;
      if (filter === 'overdue') return t.task_date < today && !allDone;
      return true;
    });
  }, [tasks, filter, today, schoolIds]);

  // Group by date
  const grouped = useMemo(() => {
    const map: Record<string, MonthlyTaskWithChecks[]> = {};
    for (const task of filtered) {
      if (!map[task.task_date]) map[task.task_date] = [];
      map[task.task_date].push(task);
    }
    // Sort tasks within each date by sort_order
    for (const date of Object.keys(map)) {
      map[date].sort((a, b) => a.sort_order - b.sort_order);
    }
    return map;
  }, [filtered]);

  const sortedDates = Object.keys(grouped).sort();

  const toggleCollapse = (date: string) => {
    setCollapsedDates(prev => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  };

  const filterCounts = useMemo(() => {
    const allCount = tasks.length;
    const incompleteCount = tasks.filter(t =>
      !schoolIds.every(sid => t.checks.find(c => c.school_id === sid)?.is_completed)
    ).length;
    const overdueCount = tasks.filter(t => {
      const allDone = schoolIds.every(sid =>
        t.checks.find(c => c.school_id === sid)?.is_completed
      );
      return t.task_date < today && !allDone;
    }).length;
    return { allCount, incompleteCount, overdueCount };
  }, [tasks, today, schoolIds]);

  return (
    <div className="flex flex-col h-full bg-white rounded-lg border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-1 px-3 py-2 border-b bg-gray-50">
        {([
          { key: 'all' as const, label: '全て', count: filterCounts.allCount },
          { key: 'incomplete' as const, label: '未完了', count: filterCounts.incompleteCount },
          { key: 'overdue' as const, label: '超過', count: filterCounts.overdueCount },
        ]).map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
              filter === f.key
                ? 'bg-white shadow text-gray-900 font-medium'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {f.label}
            <span className={`ml-1 ${filter === f.key ? 'text-gray-600' : 'text-gray-400'}`}>
              {f.count}
            </span>
          </button>
        ))}
        {canEdit && (
          <button
            className="flex items-center gap-1 px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded transition-colors ml-auto"
            onClick={handleOpenAddForm}
          >
            <Plus className="w-3 h-3" />
            追加
          </button>
        )}
      </div>

      {/* 追加フォーム */}
      {showAddForm && (
        <div className="px-3 py-2 bg-blue-50 border-b border-blue-200">
          <div className="flex items-center gap-2 mb-1.5">
            <input
              ref={addInputRef}
              type="text"
              placeholder="タスク名を入力..."
              value={newTaskName}
              onChange={(e) => setNewTaskName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) handleAddTask();
                if (e.key === 'Escape') setShowAddForm(false);
              }}
              className="flex-1 text-xs px-2 py-1.5 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
              disabled={isCreating}
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={newTaskDate}
              onChange={(e) => setNewTaskDate(e.target.value)}
              className="text-xs px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
              disabled={isCreating}
            />
            <select
              value={newTaskCategory}
              onChange={(e) => setNewTaskCategory(e.target.value as 'business' | 'course')}
              className="text-xs px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
              disabled={isCreating}
            >
              <option value="business">業務</option>
              <option value="course">講習</option>
            </select>
            <button
              onClick={handleAddTask}
              disabled={!newTaskName.trim() || isCreating}
              className="text-xs px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {isCreating ? '追加中...' : '追加'}
            </button>
            <button
              onClick={() => setShowAddForm(false)}
              className="text-xs px-2 py-1 text-gray-500 hover:text-gray-700 transition-colors"
            >
              キャンセル
            </button>
          </div>
        </div>
      )}

      {/* Task list */}
      <div className="flex-1 overflow-y-auto">
        {sortedDates.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-gray-400 text-sm">
            {filter === 'all' ? 'タスクがありません' : '該当するタスクはありません'}
          </div>
        ) : (
          sortedDates.map(date => {
            const d = new Date(date + 'T00:00:00');
            const dayLabel = `${d.getMonth() + 1}/${d.getDate()}`;
            const dow = formatDow(date);
            const isOverdue = date < today;
            const isToday = date === today;
            const isSelected = date === selectedDate;
            const isCollapsed = collapsedDates.has(date);

            // Date group completion
            const dateTasks = grouped[date];
            const dateCompleted = dateTasks.filter(t =>
              schoolIds.every(sid => t.checks.find(c => c.school_id === sid)?.is_completed)
            ).length;
            const allDateDone = dateCompleted === dateTasks.length;

            return (
              <div key={date}>
                {/* Date header */}
                <div
                  className={`flex items-center gap-2 px-3 py-1.5 text-xs font-bold border-b sticky top-0 z-10 cursor-pointer select-none ${
                    isToday ? 'bg-blue-50 text-blue-700 border-blue-200' :
                    isSelected ? 'bg-indigo-50 text-indigo-700 border-indigo-200' :
                    isOverdue && !allDateDone ? 'bg-red-50 text-red-600 border-red-100' :
                    'bg-gray-50 text-gray-500 border-gray-100'
                  }`}
                  onClick={() => {
                    onSelectDate(date);
                    toggleCollapse(date);
                  }}
                >
                  {isCollapsed ? (
                    <ChevronRight className="w-3 h-3" />
                  ) : (
                    <ChevronDown className="w-3 h-3" />
                  )}
                  <span>{dayLabel}（{dow}）</span>
                  {isToday && (
                    <span className="px-1.5 py-0.5 bg-blue-500 text-white rounded text-[10px] font-normal">
                      今日
                    </span>
                  )}
                  <span className="ml-auto text-[10px] font-normal text-gray-400">
                    {dateCompleted}/{dateTasks.length}
                  </span>
                </div>

                {/* Tasks */}
                {!isCollapsed && dateTasks.map(task => {
                  const allDone = schoolIds.every(sid =>
                    task.checks.find(c => c.school_id === sid)?.is_completed
                  );
                  const taskIsOverdue = task.task_date < today && !allDone;

                  return (
                    <div
                      key={task.id}
                      className={`flex items-center gap-2 px-3 py-2 border-b border-gray-50 transition-colors group ${
                        isSelected ? 'bg-blue-50/30' : 'hover:bg-gray-50'
                      }`}
                    >
                      <GripVertical className="w-3 h-3 text-gray-300 flex-shrink-0" />
                      {/* 完了トグル: クリックで全教室の完了/未完了を切り替え */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const newState = !allDone;
                          for (const s of schools) {
                            const check = task.checks.find(c => c.school_id === s.id);
                            if ((check?.is_completed ?? false) !== newState) {
                              onToggleCheck(task.id, s.id, newState);
                            }
                          }
                        }}
                        className="flex-shrink-0 hover:scale-110 transition-transform"
                        title={allDone ? '未完了に戻す' : '完了にする'}
                      >
                        {allDone ? (
                          <CheckCircle2 className="w-4 h-4 text-green-500" />
                        ) : (
                          <Circle className={`w-4 h-4 ${taskIsOverdue ? 'text-red-400' : 'text-gray-300'}`} />
                        )}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className={`text-xs truncate ${allDone ? 'text-gray-400 line-through' : 'text-gray-800'}`}>
                          {task.task_name}
                        </div>
                        {task.note && (
                          <div className="text-[10px] text-gray-400 truncate mt-0.5">{task.note}</div>
                        )}
                      </div>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 ${
                        task.category === 'business' ? 'bg-orange-50 text-orange-600' : 'bg-purple-50 text-purple-600'
                      }`}>
                        {task.category === 'business' ? '業務' : '講習'}
                      </span>
                      {/* School completion dots */}
                      <div className="flex gap-0.5 flex-shrink-0">
                        {schools.map(s => {
                          const check = task.checks.find(c => c.school_id === s.id);
                          return (
                            <div
                              key={s.id}
                              className={`w-2 h-2 rounded-full ${
                                check?.is_completed
                                  ? 'bg-green-400'
                                  : taskIsOverdue ? 'bg-red-300' : 'bg-gray-200'
                              }`}
                              title={`${s.name}: ${check?.is_completed ? '完了' : '未完了'}`}
                            />
                          );
                        })}
                      </div>
                      {/* 削除ボタン（リンクされていないタスクのみ） */}
                      {canEdit && !task.linked_schedule_task_id && onDeleteTask && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteTask(task.id);
                          }}
                          className="flex-shrink-0 p-0.5 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                          title="削除"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
