'use client';

import { useState, useMemo } from 'react';
import type { MonthlyTaskWithChecks, School } from '@/types/database';
import { CheckCircle2, Circle, GripVertical, Plus, ChevronDown, ChevronRight } from 'lucide-react';

interface TaskListPanelProps {
  tasks: MonthlyTaskWithChecks[];
  schools: School[];
  year: number;
  month: number;
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
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
  year: _year,
  month: _month,
  selectedDate,
  onSelectDate,
  canEdit,
}: TaskListPanelProps) {
  const [filter, setFilter] = useState<'all' | 'incomplete' | 'overdue'>('all');
  const [collapsedDates, setCollapsedDates] = useState<Set<string>>(new Set());
  const today = getToday();
  const schoolIds = schools.map(s => s.id);

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
            onClick={() => {
              // 選択中の日付のタスク追加へ
              if (selectedDate) onSelectDate(selectedDate);
            }}
          >
            <Plus className="w-3 h-3" />
            追加
          </button>
        )}
      </div>

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
                      onClick={() => onSelectDate(date)}
                      className={`flex items-center gap-2 px-3 py-2 border-b border-gray-50 cursor-pointer transition-colors ${
                        isSelected ? 'bg-blue-50/30' : 'hover:bg-gray-50'
                      }`}
                    >
                      <GripVertical className="w-3 h-3 text-gray-300 flex-shrink-0" />
                      {allDone ? (
                        <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                      ) : (
                        <Circle className={`w-4 h-4 flex-shrink-0 ${taskIsOverdue ? 'text-red-400' : 'text-gray-300'}`} />
                      )}
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
