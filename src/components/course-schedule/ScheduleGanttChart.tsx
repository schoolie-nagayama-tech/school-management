'use client';

import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import type { ScheduleTaskWithMarkers, ScheduleMarker, CourseProgressItem, SeasonType } from '@/types/database';

interface ScheduleGanttChartProps {
  tasks: ScheduleTaskWithMarkers[];
  deadlineItems?: CourseProgressItem[];
  progressSummary?: { total: number; completed: number; itemSummaries?: { name: string; total: number; done: number }[] };
  startDate: Date;
  endDate: Date;
  season: SeasonType;
  year: number;
  canEdit: boolean;
  onToggleComplete: (taskId: string, completed: boolean) => void;
  onMarkerClick: (taskId: string, date: string, existing?: ScheduleMarker) => void;
  onUpdateTask?: (taskId: string, updates: Partial<{ name: string; description: string | null; start_date: string | null; end_date: string | null }>) => void;
  onDeleteTask?: (taskId: string) => void;
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

/** タスクがマイルストーン（単日）かどうか */
function isMilestone(task: ScheduleTaskWithMarkers): boolean {
  if (!task.start_date) return false;
  if (!task.end_date) return true;
  return task.start_date === task.end_date;
}

// インライン編集コンポーネント
function InlineEditCell({
  value,
  onSave,
  className,
  disabled,
}: {
  value: string;
  onSave: (val: string) => void;
  className?: string;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  useEffect(() => { setDraft(value); }, [value]);

  if (disabled || !editing) {
    return (
      <span
        className={`${className || ''} ${!disabled ? 'cursor-pointer hover:bg-blue-50 rounded px-0.5 -mx-0.5' : ''}`}
        onDoubleClick={() => !disabled && setEditing(true)}
        title={disabled ? undefined : 'ダブルクリックで編集'}
      >
        {value}
      </span>
    );
  }

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) onSave(trimmed);
    setEditing(false);
  };

  return (
    <input
      ref={inputRef}
      type="text"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') { setDraft(value); setEditing(false); }
      }}
      className="text-xs border border-blue-300 rounded px-1 py-0 w-full outline-none focus:ring-1 focus:ring-blue-400"
    />
  );
}

/** 進捗サマリーバッジ */
function ProgressBadge({ total, completed }: { total: number; completed: number }) {
  if (total === 0) return null;
  const pct = Math.round((completed / total) * 100);
  const color = pct >= 80 ? 'bg-green-100 text-green-700' : pct >= 50 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700';
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${color}`}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: pct >= 80 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444' }} />
      {pct}%
    </span>
  );
}

/** 週番号ヘッダーを生成 */
function generateWeekHeaders(dates: Date[]): { weekLabel: string; days: Date[]; monthLabel?: string }[] {
  const weeks: { weekLabel: string; days: Date[]; monthLabel?: string }[] = [];
  let currentWeek: Date[] = [];
  let lastMonth = -1;

  for (const d of dates) {
    // 月曜始まりで週を区切る
    if (d.getDay() === 1 && currentWeek.length > 0) {
      const first = currentWeek[0];
      const ml = first.getMonth() !== lastMonth ? `${first.getMonth() + 1}月` : undefined;
      if (ml) lastMonth = first.getMonth();
      weeks.push({
        weekLabel: `${first.getMonth() + 1}/${first.getDate()}`,
        days: currentWeek,
        monthLabel: ml,
      });
      currentWeek = [];
    }
    currentWeek.push(d);
  }
  if (currentWeek.length > 0) {
    const first = currentWeek[0];
    const ml = first.getMonth() !== lastMonth ? `${first.getMonth() + 1}月` : undefined;
    weeks.push({
      weekLabel: `${first.getMonth() + 1}/${first.getDate()}`,
      days: currentWeek,
      monthLabel: ml,
    });
  }
  return weeks;
}

type ViewScale = 'day' | 'week';

export function ScheduleGanttChart({
  tasks,
  deadlineItems = [],
  progressSummary,
  startDate,
  endDate,
  canEdit,
  onToggleComplete,
  onMarkerClick,
  onUpdateTask,
  onDeleteTask,
}: ScheduleGanttChartProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const todayRef = useRef<HTMLDivElement>(null);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [scale, setScale] = useState<ViewScale>('week');

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

  // 週ヘッダー
  const weeks = useMemo(() => generateWeekHeaders(dates), [dates]);

  // 月ヘッダー（日単位用）
  const monthHeaders = useMemo(() => {
    const months: { label: string; span: number }[] = [];
    let current = '';
    for (const d of dates) {
      const key = `${d.getMonth() + 1}月`;
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

  /** 週セルにバーやマイルストーンがあるか判定 */
  const getWeekCellState = useCallback((task: ScheduleTaskWithMarkers, weekDays: Date[]): {
    hasBar: boolean;
    isStart: boolean;
    isEnd: boolean;
    isMilestoneInWeek: boolean;
    hasMarker: boolean;
    markerLabel?: string;
    markerColor?: string;
  } => {
    let hasBar = false;
    let isStart = false;
    let isEnd = false;
    let isMilestoneInWeek = false;
    let hasMarker = false;
    let markerLabel: string | undefined;
    let markerColor: string | undefined;
    const milestone = isMilestone(task);

    for (const d of weekDays) {
      if (isInBar(task, d)) hasBar = true;
      if (isBarStart(task, d)) {
        isStart = true;
        if (milestone) isMilestoneInWeek = true;
      }
      if (isBarEnd(task, d)) isEnd = true;
      const m = getMarker(task, formatDate(d));
      if (m) {
        hasMarker = true;
        markerLabel = m.label;
        markerColor = m.color || undefined;
      }
    }
    return { hasBar, isStart, isEnd, isMilestoneInWeek, hasMarker, markerLabel, markerColor };
  }, [isInBar, isBarStart, isBarEnd, getMarker]);

  /** 週にdeadlineがあるか */
  const hasDeadlineInWeek = useCallback((item: CourseProgressItem, weekDays: Date[]): boolean => {
    if (!item.deadline) return false;
    return weekDays.some((d) => formatDate(d) === item.deadline);
  }, []);

  if (tasks.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-gray-400 italic">
        スケジュールがありません。テンプレートから作成してください。
      </div>
    );
  }

  const completedTotal = tasks.filter((t) => t.is_completed).length;
  const totalTasks = tasks.length;
  const overallPct = totalTasks > 0 ? Math.round((completedTotal / totalTasks) * 100) : 0;

  // === 日単位レンダリング ===
  const renderDayView = () => (
    <table className="border-collapse text-xs min-w-max">
      <thead>
        {/* 月ヘッダー */}
        <tr>
          <th className="sticky left-0 z-30 bg-[#f8fafc] border-b border-r border-gray-200 px-2 py-1.5 min-w-[28px]" />
          <th className="sticky left-[28px] z-30 bg-[#f8fafc] border-b border-r border-gray-200 px-2 py-1.5 min-w-[200px]" />
          {monthHeaders.map((m, i) => (
            <th
              key={i}
              colSpan={m.span}
              className="border-b border-r border-gray-200 bg-[#f8fafc] px-1 py-1.5 text-center text-[10px] font-semibold text-[#1e3a5f]"
            >
              {m.label}
            </th>
          ))}
        </tr>
        {/* 日付ヘッダー */}
        <tr>
          <th className="sticky left-0 z-30 bg-[#f0f4f8] border-b border-r border-gray-200 px-1 py-1 text-center text-[9px] text-gray-400">
            済
          </th>
          <th className="sticky left-[28px] z-30 bg-[#f0f4f8] border-b border-r border-gray-200 px-2 py-1 text-left text-[10px] text-gray-500 font-medium">
            タスク名
          </th>
          {dates.map((d) => {
            const isToday = isSameDay(d, today);
            const weekend = isWeekend(d);
            return (
              <th
                key={formatDate(d)}
                className={`border-b border-r border-gray-200 px-0 py-0.5 text-center min-w-[24px] relative ${
                  isToday ? 'bg-red-50' : weekend ? 'bg-gray-50' : 'bg-[#f0f4f8]'
                }`}
              >
                {isToday && <div ref={todayRef} className="absolute inset-0" />}
                <div className={`text-[9px] leading-tight ${isToday ? 'text-red-600 font-bold' : weekend ? 'text-gray-300' : 'text-gray-500'}`}>
                  {d.getDate()}
                </div>
                <div className={`text-[8px] leading-tight ${isToday ? 'text-red-500' : weekend ? 'text-gray-300' : 'text-gray-400'}`}>
                  {['日', '月', '火', '水', '木', '金', '土'][d.getDay()]}
                </div>
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {/* 期日マーカー行 */}
        {deadlineItems.length > 0 && (
          <>
            <tr>
              <td
                colSpan={2 + dates.length}
                className="sticky left-0 z-20 bg-amber-50 border-b border-r border-gray-200 px-3 py-1"
              >
                <span className="text-[10px] text-amber-600 font-bold">進捗管理 期日</span>
              </td>
            </tr>
            {deadlineItems.map((item) => (
              <tr key={`deadline-${item.id}`}>
                <td className="sticky left-0 z-10 bg-white border-b border-r border-gray-200 px-1 py-0.5 text-center">
                  <span className="text-amber-400 text-[9px]">!</span>
                </td>
                <td className="sticky left-[28px] z-10 bg-white border-b border-r border-gray-200 px-2 py-0.5">
                  <div className="text-[10px] text-amber-700 truncate max-w-[180px]">{item.name}</div>
                </td>
                {dates.map((d) => {
                  const dateStr = formatDate(d);
                  const isToday = isSameDay(d, today);
                  const isDeadline = item.deadline === dateStr;
                  return (
                    <td
                      key={dateStr}
                      className={`border-b border-r border-gray-100 px-0 py-0 text-center relative ${
                        isDeadline ? 'bg-amber-100' : ''
                      }`}
                    >
                      {isToday && (
                        <div className="absolute top-0 bottom-0 left-1/2 w-0.5 bg-red-400 z-10 -translate-x-1/2" />
                      )}
                      {isDeadline && (
                        <div className="text-[8px] font-bold text-amber-600 leading-tight py-0.5">
                          &#9670;
                        </div>
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
          const catPct = catTasks.length > 0 ? Math.round((completedCount / catTasks.length) * 100) : 0;
          return (
            <tr key={`cat-header-${category}`} className="contents">
              {/* カテゴリヘッダー */}
              <td
                colSpan={2 + dates.length}
                className="sticky left-0 z-20 bg-[#eef2f7] border-b border-r border-gray-200 px-3 py-1.5 cursor-pointer hover:bg-[#e4eaf1] transition-colors"
                onClick={() => toggleCategory(category)}
              >
                <div className="flex items-center gap-2">
                  <span className="text-[9px] text-gray-400 transition-transform" style={{ transform: isCollapsed ? 'rotate(-90deg)' : '' }}>
                    ▼
                  </span>
                  <span className="text-xs font-bold text-[#1e3a5f]">{category}</span>
                  <span className="text-[10px] text-gray-400">{completedCount}/{catTasks.length}</span>
                  <div className="w-12 h-1 bg-gray-200 rounded-full overflow-hidden ml-1">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${catPct}%`,
                        backgroundColor: catPct >= 80 ? '#10b981' : catPct >= 50 ? '#f59e0b' : '#ef4444',
                      }}
                    />
                  </div>
                </div>
              </td>
              {/* タスク行 */}
              {!isCollapsed &&
                catTasks.map((task) => {
                  const milestone = isMilestone(task);
                  return (
                    <tr key={task.id} className={`group/row ${task.is_completed ? 'opacity-50' : ''}`}>
                      <td className="sticky left-0 z-10 bg-white border-b border-r border-gray-200 px-1 py-0.5 text-center">
                        <input
                          type="checkbox"
                          checked={task.is_completed}
                          onChange={(e) => canEdit && onToggleComplete(task.id, e.target.checked)}
                          disabled={!canEdit}
                          className="w-3 h-3 text-[#3b82f6] rounded cursor-pointer disabled:cursor-default"
                        />
                      </td>
                      <td className="sticky left-[28px] z-10 bg-white border-b border-r border-gray-200 px-2 py-0.5 group/task">
                        <div className="flex items-center gap-1">
                          {/* マイルストーンアイコン */}
                          {milestone && (
                            <span className="text-[9px] text-purple-400 shrink-0" title="マイルストーン（単日）">&#9670;</span>
                          )}
                          <div className="flex-1 min-w-0">
                            <InlineEditCell
                              value={task.name}
                              onSave={(val) => onUpdateTask?.(task.id, { name: val })}
                              disabled={!canEdit || !onUpdateTask}
                              className={`text-[11px] ${task.is_completed ? 'line-through text-gray-400' : 'text-[#1e3a5f]'}`}
                            />
                            {task.description && (
                              <div className="text-[9px] text-gray-400 truncate max-w-[160px]">{task.description}</div>
                            )}
                          </div>
                          {/* 日付表示 */}
                          {task.start_date && (
                            <span className="text-[9px] text-gray-300 shrink-0 hidden group-hover/row:inline">
                              {milestone
                                ? `${new Date(task.start_date).getMonth() + 1}/${new Date(task.start_date).getDate()}`
                                : `${new Date(task.start_date).getMonth() + 1}/${new Date(task.start_date).getDate()}~${task.end_date ? `${new Date(task.end_date).getMonth() + 1}/${new Date(task.end_date).getDate()}` : ''}`
                              }
                            </span>
                          )}
                          {canEdit && onDeleteTask && (
                            <button
                              onClick={() => { if (confirm(`「${task.name}」を削除しますか？`)) onDeleteTask(task.id); }}
                              className="text-[9px] text-red-400 hover:text-red-600 opacity-0 group-hover/task:opacity-100 transition-opacity shrink-0"
                              title="削除"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      </td>
                      {dates.map((d) => {
                        const dateStr = formatDate(d);
                        const isToday = isSameDay(d, today);
                        const weekend = isWeekend(d);
                        const inBar = isInBar(task, d);
                        const barStart = isBarStart(task, d);
                        const barEnd = isBarEnd(task, d);
                        const marker = getMarker(task, dateStr);
                        const isMilestoneDay = milestone && barStart;

                        return (
                          <td
                            key={dateStr}
                            className={`border-b border-r border-gray-100 px-0 py-0 text-center relative cursor-pointer min-w-[24px] h-[30px] ${
                              weekend && !inBar ? 'bg-gray-50/30' : ''
                            }`}
                            onClick={() => canEdit && onMarkerClick(task.id, dateStr, marker)}
                            title={marker ? marker.label : `${dateStr}`}
                          >
                            {isToday && (
                              <div className="absolute top-0 bottom-0 left-1/2 w-0.5 bg-red-400 z-10 -translate-x-1/2" />
                            )}
                            {/* バー表示（期間タスク） */}
                            {inBar && !milestone && (
                              <div
                                className={`absolute top-1/2 -translate-y-1/2 h-[16px] ${
                                  task.is_completed
                                    ? 'bg-emerald-400/50 border border-emerald-500/30'
                                    : 'bg-blue-400/35 border border-blue-500/20'
                                } ${barStart ? 'rounded-l' : ''} ${barEnd ? 'rounded-r' : ''}`}
                                style={{
                                  left: barStart ? '1px' : 0,
                                  right: barEnd ? '1px' : 0,
                                }}
                              >
                                {/* バー内ラベル（開始日のみ） */}
                                {barStart && (
                                  <div className={`absolute inset-0 flex items-center pl-0.5 text-[7px] font-medium ${
                                    task.is_completed ? 'text-green-700' : 'text-[#1e3a5f]'
                                  } whitespace-nowrap overflow-hidden`}>
                                  </div>
                                )}
                              </div>
                            )}
                            {/* マイルストーン表示 */}
                            {isMilestoneDay && (
                              <div className="absolute inset-0 flex items-center justify-center z-5">
                                <span className={`text-[13px] drop-shadow-sm ${task.is_completed ? 'text-emerald-500' : 'text-purple-500'}`}>
                                  &#9670;
                                </span>
                              </div>
                            )}
                            {/* マーカー */}
                            {marker && (
                              <div
                                className="relative z-20 text-[7px] font-bold leading-tight py-0.5 truncate max-w-[22px] mx-auto"
                                style={{ color: marker.color || '#1e3a5f' }}
                              >
                                {marker.label}
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  // === 週単位レンダリング ===
  const renderWeekView = () => {
    // 月ヘッダー（週をまとめる）
    const weekMonthHeaders: { label: string; span: number }[] = [];
    let lastMonthLabel = '';
    for (const w of weeks) {
      const firstDay = w.days[0];
      const ml = `${firstDay.getMonth() + 1}月`;
      if (ml !== lastMonthLabel) {
        weekMonthHeaders.push({ label: ml, span: 1 });
        lastMonthLabel = ml;
      } else {
        weekMonthHeaders[weekMonthHeaders.length - 1].span++;
      }
    }

    return (
      <table className="border-collapse text-xs min-w-max">
        <thead>
          {/* 月ヘッダー */}
          <tr>
            <th className="sticky left-0 z-30 bg-[#f8fafc] border-b border-r border-gray-200 px-1 py-1.5 min-w-[28px]" />
            <th className="sticky left-[28px] z-30 bg-[#f8fafc] border-b border-r border-gray-200 px-2 py-1.5 min-w-[200px]" />
            {weekMonthHeaders.map((m, i) => (
              <th
                key={i}
                colSpan={m.span}
                className="border-b border-r border-gray-200 bg-[#f8fafc] px-1 py-1.5 text-center text-[10px] font-semibold text-[#1e3a5f]"
              >
                {m.label}
              </th>
            ))}
          </tr>
          {/* 週ヘッダー */}
          <tr>
            <th className="sticky left-0 z-30 bg-[#f0f4f8] border-b border-r border-gray-200 px-1 py-1 text-center text-[9px] text-gray-400">
              済
            </th>
            <th className="sticky left-[28px] z-30 bg-[#f0f4f8] border-b border-r border-gray-200 px-2 py-1 text-left text-[10px] text-gray-500 font-medium">
              タスク名
            </th>
            {weeks.map((w, i) => {
              const hasToday = w.days.some((d) => isSameDay(d, today));
              return (
                <th
                  key={i}
                  className={`border-b border-r border-gray-200 px-1 py-1 text-center min-w-[48px] relative ${
                    hasToday ? 'bg-red-50' : 'bg-[#f0f4f8]'
                  }`}
                >
                  {hasToday && <div ref={i === weeks.findIndex((ww) => ww.days.some((d) => isSameDay(d, today))) ? todayRef : undefined} className="absolute inset-0" />}
                  <div className={`text-[9px] leading-tight ${hasToday ? 'text-red-600 font-bold' : 'text-gray-500'}`}>
                    {w.weekLabel}~
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {/* 期日マーカー行 */}
          {deadlineItems.length > 0 && (
            <>
              <tr>
                <td
                  colSpan={2 + weeks.length}
                  className="sticky left-0 z-20 bg-amber-50 border-b border-r border-gray-200 px-3 py-1"
                >
                  <span className="text-[10px] text-amber-600 font-bold">進捗管理 期日</span>
                </td>
              </tr>
              {deadlineItems.map((item) => (
                <tr key={`deadline-${item.id}`}>
                  <td className="sticky left-0 z-10 bg-white border-b border-r border-gray-200 px-1 py-0.5 text-center">
                    <span className="text-amber-400 text-[9px]">!</span>
                  </td>
                  <td className="sticky left-[28px] z-10 bg-white border-b border-r border-gray-200 px-2 py-0.5">
                    <div className="text-[10px] text-amber-700 truncate max-w-[180px]">{item.name}</div>
                  </td>
                  {weeks.map((w, wi) => {
                    const hasDeadline = hasDeadlineInWeek(item, w.days);
                    const hasToday = w.days.some((d) => isSameDay(d, today));
                    return (
                      <td
                        key={wi}
                        className={`border-b border-r border-gray-100 px-0 py-0 text-center relative ${
                          hasDeadline ? 'bg-amber-100' : ''
                        }`}
                      >
                        {hasToday && (
                          <div className="absolute top-0 bottom-0 left-1/2 w-0.5 bg-red-400 z-10 -translate-x-1/2" />
                        )}
                        {hasDeadline && (
                          <span className="text-[9px] font-bold text-amber-600">&#9670;</span>
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
            const catPct = catTasks.length > 0 ? Math.round((completedCount / catTasks.length) * 100) : 0;
            return (
              <tr key={`cat-header-${category}`} className="contents">
                <td
                  colSpan={2 + weeks.length}
                  className="sticky left-0 z-20 bg-[#eef2f7] border-b border-r border-gray-200 px-3 py-1.5 cursor-pointer hover:bg-[#e4eaf1] transition-colors"
                  onClick={() => toggleCategory(category)}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] text-gray-400 transition-transform" style={{ transform: isCollapsed ? 'rotate(-90deg)' : '' }}>
                      ▼
                    </span>
                    <span className="text-xs font-bold text-[#1e3a5f]">{category}</span>
                    <span className="text-[10px] text-gray-400">{completedCount}/{catTasks.length}</span>
                    <div className="w-12 h-1 bg-gray-200 rounded-full overflow-hidden ml-1">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${catPct}%`,
                          backgroundColor: catPct >= 80 ? '#10b981' : catPct >= 50 ? '#f59e0b' : '#ef4444',
                        }}
                      />
                    </div>
                  </div>
                </td>
                {!isCollapsed &&
                  catTasks.map((task) => {
                    const milestone = isMilestone(task);
                    return (
                      <tr key={task.id} className={`group/row ${task.is_completed ? 'opacity-50' : ''}`}>
                        <td className="sticky left-0 z-10 bg-white border-b border-r border-gray-200 px-1 py-0.5 text-center">
                          <input
                            type="checkbox"
                            checked={task.is_completed}
                            onChange={(e) => canEdit && onToggleComplete(task.id, e.target.checked)}
                            disabled={!canEdit}
                            className="w-3 h-3 text-[#3b82f6] rounded cursor-pointer disabled:cursor-default"
                          />
                        </td>
                        <td className="sticky left-[28px] z-10 bg-white border-b border-r border-gray-200 px-2 py-0.5 group/task">
                          <div className="flex items-center gap-1">
                            {milestone && (
                              <span className="text-[9px] text-purple-400 shrink-0" title="マイルストーン（単日）">&#9670;</span>
                            )}
                            <div className="flex-1 min-w-0">
                              <InlineEditCell
                                value={task.name}
                                onSave={(val) => onUpdateTask?.(task.id, { name: val })}
                                disabled={!canEdit || !onUpdateTask}
                                className={`text-[11px] ${task.is_completed ? 'line-through text-gray-400' : 'text-[#1e3a5f]'}`}
                              />
                            </div>
                            {task.start_date && (
                              <span className="text-[9px] text-gray-300 shrink-0 hidden group-hover/row:inline">
                                {milestone
                                  ? `${new Date(task.start_date).getMonth() + 1}/${new Date(task.start_date).getDate()}`
                                  : `${new Date(task.start_date).getMonth() + 1}/${new Date(task.start_date).getDate()}~${task.end_date ? `${new Date(task.end_date).getMonth() + 1}/${new Date(task.end_date).getDate()}` : ''}`
                                }
                              </span>
                            )}
                            {canEdit && onDeleteTask && (
                              <button
                                onClick={() => { if (confirm(`「${task.name}」を削除しますか？`)) onDeleteTask(task.id); }}
                                className="text-[9px] text-red-400 hover:text-red-600 opacity-0 group-hover/task:opacity-100 transition-opacity shrink-0"
                                title="削除"
                              >
                                ✕
                              </button>
                            )}
                          </div>
                        </td>
                        {weeks.map((w, wi) => {
                          const state = getWeekCellState(task, w.days);
                          const hasToday = w.days.some((d) => isSameDay(d, today));

                          return (
                            <td
                              key={wi}
                              className="border-b border-r border-gray-100 px-0 py-0 text-center relative h-[30px] min-w-[48px]"
                            >
                              {hasToday && (
                                <div className="absolute top-0 bottom-0 left-1/2 w-0.5 bg-red-400 z-10 -translate-x-1/2" />
                              )}
                              {/* 期間バー */}
                              {state.hasBar && !state.isMilestoneInWeek && (
                                <div
                                  className={`absolute top-1/2 -translate-y-1/2 h-[16px] ${
                                    task.is_completed
                                      ? 'bg-emerald-400/50 border border-emerald-500/30'
                                      : 'bg-blue-400/35 border border-blue-500/20'
                                  } ${state.isStart ? 'rounded-l' : ''} ${state.isEnd ? 'rounded-r' : ''}`}
                                  style={{
                                    left: state.isStart ? '2px' : 0,
                                    right: state.isEnd ? '2px' : 0,
                                  }}
                                />
                              )}
                              {/* マイルストーン */}
                              {state.isMilestoneInWeek && (
                                <div className="absolute inset-0 flex items-center justify-center z-5">
                                  <span className={`text-[10px] ${task.is_completed ? 'text-green-500' : 'text-purple-500'}`}>
                                    &#9670;
                                  </span>
                                </div>
                              )}
                              {/* マーカー */}
                              {state.hasMarker && (
                                <div
                                  className="relative z-20 text-[7px] font-bold leading-tight py-0.5 truncate mx-auto"
                                  style={{ color: state.markerColor || '#1e3a5f' }}
                                >
                                  {state.markerLabel}
                                </div>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  };

  return (
    <div className="space-y-3">
      {/* サマリーヘッダー */}
      <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            {/* 工程進捗 */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">工程進捗</span>
              <div className="w-20 h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${overallPct}%`,
                    backgroundColor: overallPct >= 80 ? '#10b981' : overallPct >= 50 ? '#f59e0b' : '#ef4444',
                  }}
                />
              </div>
              <span className="text-xs font-bold text-[#1e3a5f]">{completedTotal}/{totalTasks}</span>
            </div>

            {/* 進捗管理サマリー */}
            {progressSummary && progressSummary.total > 0 && (
              <div className="flex items-center gap-2 border-l border-gray-200 pl-4">
                <span className="text-xs text-gray-500">進捗管理</span>
                <ProgressBadge total={progressSummary.total} completed={progressSummary.completed} />
                {progressSummary.itemSummaries && progressSummary.itemSummaries.length > 0 && (
                  <div className="flex items-center gap-1.5 ml-1">
                    {progressSummary.itemSummaries.slice(0, 4).map((s, i) => (
                      <span key={i} className="text-[9px] text-gray-400" title={`${s.name}: ${s.done}/${s.total}`}>
                        {s.name.slice(0, 4)} {s.done}/{s.total}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 表示スケール切替 */}
          <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
            <button
              onClick={() => setScale('week')}
              className={`px-2.5 py-1 text-[10px] rounded-md transition-colors ${
                scale === 'week' ? 'bg-white text-[#1e3a5f] font-medium shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              週表示
            </button>
            <button
              onClick={() => setScale('day')}
              className={`px-2.5 py-1 text-[10px] rounded-md transition-colors ${
                scale === 'day' ? 'bg-white text-[#1e3a5f] font-medium shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              日表示
            </button>
          </div>
        </div>
      </div>

      {/* 凡例 */}
      <div className="flex items-center gap-4 px-1">
        <div className="flex items-center gap-1">
          <div className="w-8 h-[14px] bg-blue-400/35 border border-blue-500/20 rounded" />
          <span className="text-[10px] text-gray-400">期間タスク</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[11px] text-purple-500">&#9670;</span>
          <span className="text-[10px] text-gray-400">マイルストーン（単日）</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-8 h-[14px] bg-emerald-400/50 border border-emerald-500/30 rounded" />
          <span className="text-[10px] text-gray-400">完了</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-amber-600">&#9670;</span>
          <span className="text-[10px] text-gray-400">期日</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-0.5 h-3 bg-red-400" />
          <span className="text-[10px] text-gray-400">今日</span>
        </div>
      </div>

      {/* ガントチャート */}
      <div ref={scrollRef} className="overflow-x-auto border border-gray-200 rounded-xl bg-white">
        {scale === 'day' ? renderDayView() : renderWeekView()}
      </div>
    </div>
  );
}
