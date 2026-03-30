'use client';

import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import type { ScheduleTaskWithMarkers, ScheduleMarker, CourseProgressItem } from '@/types/database';

interface ScheduleGanttChartProps {
  tasks: ScheduleTaskWithMarkers[];
  deadlineItems?: CourseProgressItem[];
  startDate: Date;
  endDate: Date;
  canEdit: boolean;
  onToggleComplete: (taskId: string, completed: boolean) => void;
  onMarkerClick: (taskId: string, date: string, existing?: ScheduleMarker) => void;
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isWeekend(d: Date): boolean {
  const day = d.getDay();
  return day === 0 || day === 6;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function ScheduleGanttChart({
  tasks,
  deadlineItems = [],
  startDate,
  endDate,
  canEdit,
  onToggleComplete,
  onMarkerClick,
}: ScheduleGanttChartProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const todayRef = useRef<HTMLDivElement>(null);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  // 日付列を生成
  const dates = useMemo(() => {
    const result: Date[] = [];
    const d = new Date(startDate);
    while (d <= endDate) {
      result.push(new Date(d));
      d.setDate(d.getDate() + 1);
    }
    return result;
  }, [startDate, endDate]);

  // 月ヘッダー
  const monthHeaders = useMemo(() => {
    const months: { label: string; span: number }[] = [];
    let current = '';
    for (const d of dates) {
      const key = `${d.getFullYear()}/${d.getMonth() + 1}月`;
      if (key !== current) {
        months.push({ label: key, span: 1 });
        current = key;
      } else {
        months[months.length - 1].span++;
      }
    }
    return months;
  }, [dates]);

  // カテゴリでグループ化
  const categories = useMemo(() => {
    const map = new Map<string, ScheduleTaskWithMarkers[]>();
    for (const t of tasks) {
      if (!map.has(t.major_category)) map.set(t.major_category, []);
      map.get(t.major_category)!.push(t);
    }
    return Array.from(map.entries()).map(([category, categoryTasks]) => ({
      category,
      tasks: categoryTasks,
    }));
  }, [tasks]);

  // 今日に自動スクロール
  useEffect(() => {
    if (todayRef.current && scrollRef.current) {
      const container = scrollRef.current;
      const todayEl = todayRef.current;
      const containerRect = container.getBoundingClientRect();
      const todayRect = todayEl.getBoundingClientRect();
      const offset = todayRect.left - containerRect.left - containerRect.width / 3;
      container.scrollLeft += offset;
    }
  }, [dates]);

  const toggleCategory = useCallback((cat: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }, []);

  // タスクのバーが日付セルに該当するか
  const isInBar = useCallback((task: ScheduleTaskWithMarkers, date: Date): boolean => {
    if (!task.start_date || !task.end_date) return false;
    const s = new Date(task.start_date);
    const e = new Date(task.end_date);
    return date >= s && date <= e;
  }, []);

  const isBarStart = useCallback((task: ScheduleTaskWithMarkers, date: Date): boolean => {
    if (!task.start_date) return false;
    return isSameDay(new Date(task.start_date), date);
  }, []);

  const isBarEnd = useCallback((task: ScheduleTaskWithMarkers, date: Date): boolean => {
    if (!task.end_date) return false;
    return isSameDay(new Date(task.end_date), date);
  }, []);

  const getMarker = useCallback((task: ScheduleTaskWithMarkers, dateStr: string): ScheduleMarker | undefined => {
    return task.markers.find((m) => m.marker_date === dateStr);
  }, []);

  if (tasks.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-gray-400 italic">
        工程表タスクがありません。テンプレートから作成してください。
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="overflow-x-auto border border-gray-200 rounded-lg">
      <table className="border-collapse text-xs min-w-max">
        <thead>
          {/* 月ヘッダー */}
          <tr>
            <th className="sticky left-0 z-30 bg-gray-50 border border-gray-200 px-2 py-1 min-w-[32px]" />
            <th className="sticky left-[32px] z-30 bg-gray-50 border border-gray-200 px-2 py-1 min-w-[180px]" />
            {monthHeaders.map((m, i) => (
              <th
                key={i}
                colSpan={m.span}
                className="border border-gray-200 bg-gray-50 px-1 py-1 text-center text-[10px] font-medium text-gray-600"
              >
                {m.label}
              </th>
            ))}
          </tr>
          {/* 日付ヘッダー */}
          <tr>
            <th className="sticky left-0 z-30 bg-gray-100 border border-gray-200 px-2 py-1 text-center text-[10px] text-gray-500">
              済
            </th>
            <th className="sticky left-[32px] z-30 bg-gray-100 border border-gray-200 px-2 py-1 text-left text-[10px] text-gray-600">
              タスク
            </th>
            {dates.map((d) => {
              const isToday = isSameDay(d, today);
              const weekend = isWeekend(d);
              return (
                <th
                  key={formatDate(d)}
                  className={`border border-gray-200 px-0 py-1 text-center min-w-[28px] relative ${
                    isToday ? 'bg-red-50' : weekend ? 'bg-gray-50' : 'bg-gray-100'
                  }`}
                >
                  {isToday && <div ref={todayRef} className="absolute inset-0" />}
                  <div className={`text-[9px] ${isToday ? 'text-red-600 font-bold' : weekend ? 'text-gray-400' : 'text-gray-500'}`}>
                    {d.getDate()}
                  </div>
                  <div className={`text-[8px] ${isToday ? 'text-red-500' : weekend ? 'text-gray-300' : 'text-gray-400'}`}>
                    {['日', '月', '火', '水', '木', '金', '土'][d.getDay()]}
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {/* 期日マーカー行（進捗管理からの連動） */}
          {deadlineItems.length > 0 && (
            <>
              <tr>
                <td
                  colSpan={2 + dates.length}
                  className="sticky left-0 z-20 bg-orange-50 border border-gray-200 px-2 py-1"
                >
                  <span className="text-[10px] text-orange-600 font-bold">期日</span>
                </td>
              </tr>
              {deadlineItems.map((item) => (
                <tr key={`deadline-${item.id}`} className="bg-orange-50/30">
                  <td className="sticky left-0 z-10 bg-white border border-gray-200 px-1 py-1 text-center">
                    <span className="text-orange-400 text-[10px]">!</span>
                  </td>
                  <td className="sticky left-[32px] z-10 bg-white border border-gray-200 px-2 py-1">
                    <div className="text-xs text-orange-700">{item.name}</div>
                  </td>
                  {dates.map((d) => {
                    const dateStr = formatDate(d);
                    const isToday = isSameDay(d, today);
                    const isDeadline = item.deadline === dateStr;
                    const isPast = item.deadline ? new Date(item.deadline) < d : false;
                    return (
                      <td
                        key={dateStr}
                        className={`border border-gray-200 px-0 py-0 text-center relative ${
                          isDeadline ? 'bg-orange-100' : ''
                        }`}
                      >
                        {isToday && (
                          <div className="absolute top-0 bottom-0 left-1/2 w-0.5 bg-red-400 z-10 -translate-x-1/2" />
                        )}
                        {isDeadline && (
                          <div className="text-[8px] font-bold text-orange-600 leading-tight py-0.5">
                            !
                          </div>
                        )}
                        {!isDeadline && !isPast && item.deadline && new Date(item.deadline) > d && (
                          <div className="absolute top-1/2 -translate-y-1/2 h-1 bg-orange-200 left-0 right-0" />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </>
          )}
          {categories.map(({ category, tasks: catTasks }) => {
            const isCollapsed = collapsedCategories.has(category);
            const completedCount = catTasks.filter((t) => t.is_completed).length;
            return (
              <tr key={`cat-header-${category}`} className="contents">
                {/* カテゴリヘッダー行 */}
                <td
                  colSpan={2 + dates.length}
                  className="sticky left-0 z-20 bg-[#f0f4f8] border border-gray-200 px-2 py-1.5 cursor-pointer"
                  onClick={() => toggleCategory(category)}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-gray-400">{isCollapsed ? '▶' : '▼'}</span>
                    <span className="text-xs font-bold text-[#1e3a5f]">{category}</span>
                    <span className="text-[10px] text-gray-400">
                      {completedCount}/{catTasks.length}
                    </span>
                  </div>
                </td>
                {/* タスク行 */}
                {!isCollapsed &&
                  catTasks.map((task) => (
                    <tr key={task.id} className={task.is_completed ? 'opacity-60' : ''}>
                      {/* 完了チェック */}
                      <td className="sticky left-0 z-10 bg-white border border-gray-200 px-1 py-1 text-center">
                        <input
                          type="checkbox"
                          checked={task.is_completed}
                          onChange={(e) => canEdit && onToggleComplete(task.id, e.target.checked)}
                          disabled={!canEdit}
                          className="w-3.5 h-3.5 text-[#3b82f6] rounded cursor-pointer disabled:cursor-default"
                        />
                      </td>
                      {/* タスク名 */}
                      <td className="sticky left-[32px] z-10 bg-white border border-gray-200 px-2 py-1">
                        <div className={`text-xs ${task.is_completed ? 'line-through text-gray-400' : 'text-[#1e3a5f]'}`}>
                          {task.name}
                        </div>
                        {task.description && (
                          <div className="text-[9px] text-gray-400 truncate max-w-[160px]">{task.description}</div>
                        )}
                      </td>
                      {/* 日付セル */}
                      {dates.map((d) => {
                        const dateStr = formatDate(d);
                        const isToday = isSameDay(d, today);
                        const weekend = isWeekend(d);
                        const inBar = isInBar(task, d);
                        const barStart = isBarStart(task, d);
                        const barEnd = isBarEnd(task, d);
                        const marker = getMarker(task, dateStr);

                        return (
                          <td
                            key={dateStr}
                            className={`border border-gray-200 px-0 py-0 text-center relative cursor-pointer ${
                              weekend && !inBar ? 'bg-gray-50/50' : ''
                            }`}
                            onClick={() => canEdit && onMarkerClick(task.id, dateStr, marker)}
                            title={marker ? marker.label : `${dateStr} にマーカーを追加`}
                          >
                            {/* 今日ライン */}
                            {isToday && (
                              <div className="absolute top-0 bottom-0 left-1/2 w-0.5 bg-red-400 z-10 -translate-x-1/2" />
                            )}
                            {/* バー表示 */}
                            {inBar && (
                              <div
                                className={`absolute top-1/2 -translate-y-1/2 h-2.5 bg-[#3b82f6]/30 ${
                                  barStart ? 'left-0 rounded-l' : 'left-0'
                                } ${barEnd ? 'right-0 rounded-r' : 'right-0'}`}
                                style={{
                                  left: barStart ? '2px' : 0,
                                  right: barEnd ? '2px' : 0,
                                }}
                              />
                            )}
                            {/* マーカー */}
                            {marker && (
                              <div
                                className="relative z-20 text-[8px] font-bold leading-tight py-0.5 truncate max-w-[26px] mx-auto"
                                style={{ color: marker.color || '#1e3a5f' }}
                              >
                                {marker.label}
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
