'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import type { MonthlyTaskWithChecks, School, MonthlyTaskCategory } from '@/types/database';
import { TaskCheckboxRow } from './TaskCheckboxRow';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';

interface TaskTimelineProps {
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

function formatDateHeader(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00');
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  return `${d.getMonth() + 1}/${d.getDate()}(${weekdays[d.getDay()]})`;
}

function getWeekdayClass(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay();
  if (day === 0) return 'text-red-600';
  if (day === 6) return 'text-blue-600';
  return '';
}

export function TaskTimeline({
  tasks,
  schools,
  year,
  month,
  canEdit,
  onToggleCheck,
  onCreateTask,
  onUpdateTask,
  onDeleteTask,
  onUpdateNote,
}: TaskTimelineProps) {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const todayRef = useRef<HTMLDivElement>(null);

  // 日付ごとにグループ化
  const dateGroups = useMemo(() => {
    const groups = new Map<string, MonthlyTaskWithChecks[]>();
    for (const task of tasks) {
      const existing = groups.get(task.task_date) || [];
      existing.push(task);
      groups.set(task.task_date, existing);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [tasks]);

  // 折りたたみ状態: 過去日付で全完了はデフォルト折りたたみ
  const [collapsedDates, setCollapsedDates] = useState<Set<string>>(new Set());

  useEffect(() => {
    const collapsed = new Set<string>();
    const schoolIds = schools.map((s) => s.id);
    for (const [date, dateTasks] of dateGroups) {
      if (date < todayStr) {
        const allDone = dateTasks.every((t) =>
          schoolIds.every((sid) => {
            const check = t.checks.find((c) => c.school_id === sid);
            return check?.is_completed;
          })
        );
        if (allDone) collapsed.add(date);
      }
    }
    setCollapsedDates(collapsed);
  }, [dateGroups, todayStr, schools]);

  // 今日の位置にスクロール
  useEffect(() => {
    const timer = setTimeout(() => {
      todayRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 200);
    return () => clearTimeout(timer);
  }, [year, month]);

  const toggleCollapse = (date: string) => {
    setCollapsedDates((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  };

  // 新規タスク追加の入力状態
  const [addingForDate, setAddingForDate] = useState<string | null>(null);
  const [newTaskName, setNewTaskName] = useState('');
  const [newTaskCategory, setNewTaskCategory] = useState<MonthlyTaskCategory>('business');
  const addInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (addingForDate) addInputRef.current?.focus();
  }, [addingForDate]);

  const handleAddSubmit = (date: string) => {
    if (!newTaskName.trim()) return;
    const dateTasks = tasks.filter((t) => t.task_date === date && t.category === newTaskCategory);
    const maxSort = dateTasks.length > 0 ? Math.max(...dateTasks.map((t) => t.sort_order)) + 1 : 0;
    onCreateTask(date, newTaskCategory, newTaskName.trim(), maxSort);
    setNewTaskName('');
    setAddingForDate(null);
  };

  return (
    <div className="space-y-1 overflow-y-auto pr-1" style={{ maxHeight: 'calc(100vh - 200px)' }}>
      {dateGroups.map(([date, dateTasks]) => {
        const isToday = date === todayStr;
        const isPast = date < todayStr;
        const isCollapsed = collapsedDates.has(date);
        const schoolIds = schools.map((s) => s.id);
        const allDone = dateTasks.every((t) =>
          schoolIds.every((sid) => {
            const check = t.checks.find((c) => c.school_id === sid);
            return check?.is_completed;
          })
        );

        // カテゴリ分け
        const businessTasks = dateTasks.filter((t) => t.category === 'business');
        const courseTasks = dateTasks.filter((t) => t.category === 'course');

        const completedCount = dateTasks.filter((t) =>
          schoolIds.every((sid) => {
            const check = t.checks.find((c) => c.school_id === sid);
            return check?.is_completed;
          })
        ).length;

        return (
          <div
            key={date}
            ref={isToday ? todayRef : undefined}
            className={`rounded-lg border ${
              isToday
                ? 'border-blue-400 bg-blue-50/30 shadow-sm'
                : isPast && allDone
                ? 'border-gray-200 bg-gray-50/50'
                : isPast
                ? 'border-orange-200 bg-orange-50/20'
                : 'border-gray-200'
            }`}
          >
            {/* 日付ヘッダー */}
            <button
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50/50 transition-colors"
              onClick={() => toggleCollapse(date)}
            >
              {isCollapsed ? (
                <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
              ) : (
                <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />
              )}
              <span className={`text-sm font-bold ${getWeekdayClass(date)} ${isPast && allDone ? 'text-gray-400' : ''}`}>
                {formatDateHeader(date)}
              </span>
              {isToday && (
                <span className="text-[10px] px-1.5 py-0.5 bg-blue-500 text-white rounded font-bold">
                  TODAY
                </span>
              )}
              <span className="text-[10px] text-gray-400 ml-auto">
                {completedCount}/{dateTasks.length}
              </span>
              {allDone && dateTasks.length > 0 && (
                <span className="text-[10px] text-green-600 font-medium">完了</span>
              )}
            </button>

            {/* タスクリスト */}
            {!isCollapsed && (
              <div className="px-3 pb-2 space-y-1">
                {/* 業務系 */}
                {businessTasks.length > 0 && (
                  <div>
                    {(businessTasks.length > 0 && courseTasks.length > 0) && (
                      <div className="text-[10px] text-orange-600 font-medium mb-0.5 pl-1">業務</div>
                    )}
                    {businessTasks.map((task) => (
                      <TaskCheckboxRow
                        key={task.id}
                        task={task}
                        schools={schools}
                        canEdit={canEdit}
                        onToggleCheck={onToggleCheck}
                        onUpdateTask={onUpdateTask}
                        onDeleteTask={onDeleteTask}
                        onUpdateNote={onUpdateNote}
                      />
                    ))}
                  </div>
                )}

                {/* 講習系 */}
                {courseTasks.length > 0 && (
                  <div>
                    {(businessTasks.length > 0 && courseTasks.length > 0) && (
                      <div className="text-[10px] text-purple-600 font-medium mb-0.5 pl-1 mt-1">講習</div>
                    )}
                    {courseTasks.map((task) => (
                      <TaskCheckboxRow
                        key={task.id}
                        task={task}
                        schools={schools}
                        canEdit={canEdit}
                        onToggleCheck={onToggleCheck}
                        onUpdateTask={onUpdateTask}
                        onDeleteTask={onDeleteTask}
                        onUpdateNote={onUpdateNote}
                      />
                    ))}
                  </div>
                )}

                {/* タスク追加 */}
                {canEdit && (
                  <>
                    {addingForDate === date ? (
                      <div className="flex items-center gap-1.5 mt-1">
                        <select
                          value={newTaskCategory}
                          onChange={(e) => setNewTaskCategory(e.target.value as MonthlyTaskCategory)}
                          className="text-[10px] px-1 py-1 border rounded bg-white"
                        >
                          <option value="business">業務</option>
                          <option value="course">講習</option>
                        </select>
                        <input
                          ref={addInputRef}
                          value={newTaskName}
                          onChange={(e) => setNewTaskName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleAddSubmit(date);
                            if (e.key === 'Escape') { setAddingForDate(null); setNewTaskName(''); }
                          }}
                          placeholder="タスク名を入力..."
                          className="flex-1 text-xs px-2 py-1 border rounded focus:outline-none focus:ring-1 focus:ring-blue-300"
                        />
                        <button
                          onClick={() => handleAddSubmit(date)}
                          className="text-xs px-2 py-1 bg-[#d32f2f] text-white rounded hover:bg-[#b71c1c]"
                        >
                          追加
                        </button>
                        <button
                          onClick={() => { setAddingForDate(null); setNewTaskName(''); }}
                          className="text-xs px-2 py-1 text-gray-500 hover:text-gray-700"
                        >
                          取消
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setAddingForDate(date)}
                        className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-gray-600 pl-1 mt-0.5"
                      >
                        <Plus className="w-3 h-3" />
                        タスク追加
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
