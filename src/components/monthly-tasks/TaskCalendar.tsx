'use client';

import { useMemo } from 'react';
import type { MonthlyTaskWithChecks, School } from '@/types/database';

interface TaskCalendarProps {
  tasks: MonthlyTaskWithChecks[];
  schools: School[];
  year: number;
  month: number;
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
  onDropTask: (taskId: string, newDate: string) => void;
  onDropPoolItem?: (item: { task_name: string; category: string; sort_order: number }, date: string) => void;
  canEdit: boolean;
}

const WEEKDAY_LABELS = ['月', '火', '水', '木', '金', '土', '日'];

function toDateStr(y: number, m: number, d: number) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function TaskCalendar({
  tasks,
  schools,
  year,
  month,
  selectedDate,
  onSelectDate,
  onDropTask,
  onDropPoolItem,
  canEdit,
}: TaskCalendarProps) {
  const today = new Date();
  const todayStr = toDateStr(today.getFullYear(), today.getMonth() + 1, today.getDate());

  // カレンダーグリッドを生成
  const calendarWeeks = useMemo(() => {
    const firstDay = new Date(year, month - 1, 1);
    const daysInMonth = new Date(year, month, 0).getDate();
    // 月曜始まり: 0=月, 6=日
    let startDow = firstDay.getDay() - 1;
    if (startDow < 0) startDow = 6;

    const weeks: (number | null)[][] = [];
    let week: (number | null)[] = [];

    // 前月の空白
    for (let i = 0; i < startDow; i++) week.push(null);

    for (let d = 1; d <= daysInMonth; d++) {
      week.push(d);
      if (week.length === 7) {
        weeks.push(week);
        week = [];
      }
    }
    // 最終週の空白
    if (week.length > 0) {
      while (week.length < 7) week.push(null);
      weeks.push(week);
    }

    return weeks;
  }, [year, month]);

  // 日付ごとのタスク集計
  const dateStats = useMemo(() => {
    const schoolIds = schools.map((s) => s.id);
    const stats = new Map<string, { total: number; completed: number; overdue: boolean; business: number; course: number }>();

    for (const task of tasks) {
      const existing = stats.get(task.task_date) || { total: 0, completed: 0, overdue: false, business: 0, course: 0 };
      existing.total++;
      if (task.category === 'business') existing.business++;
      else existing.course++;

      const allDone = schoolIds.every((sid) => {
        const check = task.checks.find((c) => c.school_id === sid);
        return check?.is_completed;
      });
      if (allDone) existing.completed++;
      if (task.task_date < todayStr && !allDone) existing.overdue = true;

      stats.set(task.task_date, existing);
    }
    return stats;
  }, [tasks, schools, todayStr]);

  // D&D ハンドラ
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, date: string) => {
    e.preventDefault();
    const taskId = e.dataTransfer.getData('text/task-id');
    const poolItemData = e.dataTransfer.getData('text/pool-item');
    if (taskId && canEdit) {
      onDropTask(taskId, date);
    } else if (poolItemData && canEdit && onDropPoolItem) {
      try {
        const item = JSON.parse(poolItemData);
        onDropPoolItem(item, date);
      } catch { /* ignore */ }
    }
  };

  return (
    <div className="select-none">
      {/* 曜日ヘッダー */}
      <div className="grid grid-cols-7 mb-1">
        {WEEKDAY_LABELS.map((label, i) => (
          <div
            key={label}
            className={`text-center text-[11px] font-medium py-1 ${
              i === 5 ? 'text-blue-500' : i === 6 ? 'text-red-500' : 'text-gray-500'
            }`}
          >
            {label}
          </div>
        ))}
      </div>

      {/* カレンダーグリッド */}
      <div className="grid grid-cols-7 gap-[2px]">
        {calendarWeeks.flat().map((day, idx) => {
          if (day === null) {
            return <div key={`empty-${idx}`} className="aspect-square bg-gray-50/50 rounded" />;
          }

          const dateStr = toDateStr(year, month, day);
          const stat = dateStats.get(dateStr);
          const isToday = dateStr === todayStr;
          const isSelected = dateStr === selectedDate;
          const isPast = dateStr < todayStr;
          const dow = idx % 7; // 0=月 ... 6=日

          // タスク密度で背景色を決定
          let bgClass = 'bg-white hover:bg-gray-50';
          if (stat) {
            if (stat.overdue) {
              bgClass = 'bg-red-50 hover:bg-red-100';
            } else if (stat.total === stat.completed && stat.total > 0) {
              bgClass = 'bg-green-50 hover:bg-green-100';
            } else if (stat.total > 0) {
              bgClass = stat.total >= 5
                ? 'bg-blue-100 hover:bg-blue-150'
                : stat.total >= 3
                ? 'bg-blue-50 hover:bg-blue-100'
                : 'bg-slate-50 hover:bg-slate-100';
            }
          }

          return (
            <div
              key={dateStr}
              onClick={() => onSelectDate(dateStr)}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, dateStr)}
              className={`aspect-square rounded cursor-pointer transition-[background-color,box-shadow] duration-150 ease-out flex flex-col p-1 relative ${bgClass} ${
                isSelected
                  ? 'ring-2 ring-blue-500 shadow-md z-10'
                  : ''
              } ${isToday ? 'ring-2 ring-blue-400' : ''}`}
            >
              {/* 日付数字 */}
              <div className="flex items-center justify-between">
                <span
                  className={`text-xs font-medium leading-none ${
                    isToday
                      ? 'bg-blue-500 text-white w-5 h-5 rounded-full flex items-center justify-center text-[11px]'
                      : dow === 5
                      ? 'text-blue-600'
                      : dow === 6
                      ? 'text-red-500'
                      : isPast
                      ? 'text-gray-400'
                      : 'text-gray-700'
                  }`}
                >
                  {day}
                </span>
                {stat && stat.total > 0 && (
                  <span className={`text-[8px] font-medium ${
                    stat.completed === stat.total ? 'text-green-500' : stat.overdue ? 'text-red-500' : 'text-gray-400'
                  }`}>
                    {stat.completed}/{stat.total}
                  </span>
                )}
              </div>

              {/* タスクドット */}
              {stat && stat.total > 0 && (
                <div className="flex-1 flex flex-col justify-end gap-[1px] mt-0.5 overflow-hidden">
                  {/* 業務ドット */}
                  {stat.business > 0 && (
                    <div className="flex gap-[2px] flex-wrap">
                      {Array.from({ length: Math.min(stat.business, 4) }).map((_, i) => (
                        <div key={`b-${i}`} className="w-1.5 h-1.5 rounded-full bg-orange-400" />
                      ))}
                      {stat.business > 4 && (
                        <span className="text-[7px] text-orange-500">+{stat.business - 4}</span>
                      )}
                    </div>
                  )}
                  {/* 講習ドット */}
                  {stat.course > 0 && (
                    <div className="flex gap-[2px] flex-wrap">
                      {Array.from({ length: Math.min(stat.course, 4) }).map((_, i) => (
                        <div key={`c-${i}`} className="w-1.5 h-1.5 rounded-full bg-purple-400" />
                      ))}
                      {stat.course > 4 && (
                        <span className="text-[7px] text-purple-500">+{stat.course - 4}</span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 凡例 */}
      <div className="flex items-center gap-3 mt-2 text-[11px] text-gray-500">
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-orange-400" />
          業務
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-purple-400" />
          講習
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-2 rounded bg-red-50 border border-red-200" />
          超過
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-2 rounded bg-green-50 border border-green-200" />
          完了
        </div>
      </div>
    </div>
  );
}
