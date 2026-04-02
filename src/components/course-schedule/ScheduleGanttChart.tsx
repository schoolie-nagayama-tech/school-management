'use client';

import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import type { ScheduleTaskWithMarkers, ScheduleMarker, CourseProgressItem, SeasonType } from '@/types/database';

interface ScheduleGanttChartProps {
  tasks: ScheduleTaskWithMarkers[];
  deadlineItems?: CourseProgressItem[];
  progressItems?: CourseProgressItem[];
  progressSummary?: { total: number; completed: number; itemSummaries?: { name: string; total: number; done: number }[] };
  startDate: Date;
  endDate: Date;
  season: SeasonType;
  year: number;
  canEdit: boolean;
  onToggleComplete: (taskId: string, completed: boolean) => void;
  onMarkerClick: (taskId: string, date: string, existing?: ScheduleMarker) => void;
  onUpdateTask?: (taskId: string, updates: Partial<{ name: string; description: string | null; start_date: string | null; end_date: string | null; linked_progress_item_id: string | null }>) => void;
  onDeleteTask?: (taskId: string) => void;
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function isWeekend(d: Date): boolean {
  return d.getDay() === 0 || d.getDay() === 6;
}
function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function isMilestone(task: ScheduleTaskWithMarkers): boolean {
  if (!task.start_date) return false;
  if (!task.end_date) return true;
  return task.start_date === task.end_date;
}
/** 期日を超過して未完了か */
function isOverdue(task: ScheduleTaskWithMarkers, today: Date): boolean {
  if (task.is_completed) return false;
  const deadline = task.end_date || task.start_date;
  if (!deadline) return false;
  return new Date(deadline) < today;
}
/** 日付の短縮表示 */
function shortDate(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// カテゴリ色パレット
const CATEGORY_COLORS = [
  { bg: '#eff6ff', border: '#3b82f6', text: '#1e40af' },   // blue
  { bg: '#f0fdf4', border: '#22c55e', text: '#166534' },   // green
  { bg: '#fefce8', border: '#eab308', text: '#854d0e' },   // yellow
  { bg: '#fdf2f8', border: '#ec4899', text: '#9d174d' },   // pink
  { bg: '#f5f3ff', border: '#8b5cf6', text: '#5b21b6' },   // violet
  { bg: '#ecfeff', border: '#06b6d4', text: '#155e75' },   // cyan
  { bg: '#fff7ed', border: '#f97316', text: '#9a3412' },   // orange
];

// インライン編集
function InlineEditCell({
  value, onSave, className, disabled,
}: {
  value: string; onSave: (val: string) => void; className?: string; disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing && inputRef.current) { inputRef.current.focus(); inputRef.current.select(); } }, [editing]);
  useEffect(() => { setDraft(value); }, [value]);
  if (disabled || !editing) {
    return (
      <span
        className={`${className || ''} ${!disabled ? 'cursor-pointer hover:bg-blue-50 rounded px-0.5 -mx-0.5' : ''}`}
        onDoubleClick={() => !disabled && setEditing(true)}
        title={disabled ? undefined : 'ダブルクリックで編集'}
      >{value}</span>
    );
  }
  const commit = () => { const t = draft.trim(); if (t && t !== value) onSave(t); setEditing(false); };
  return (
    <input ref={inputRef} type="text" value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(value); setEditing(false); } }}
      className="text-xs border border-blue-300 rounded px-1 py-0 w-full outline-none focus:ring-1 focus:ring-blue-400"
    />
  );
}

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

function generateWeekHeaders(dates: Date[]): { weekLabel: string; days: Date[] }[] {
  const weeks: { weekLabel: string; days: Date[] }[] = [];
  let currentWeek: Date[] = [];
  for (const d of dates) {
    if (d.getDay() === 1 && currentWeek.length > 0) {
      const first = currentWeek[0];
      weeks.push({ weekLabel: `${first.getMonth() + 1}/${first.getDate()}`, days: currentWeek });
      currentWeek = [];
    }
    currentWeek.push(d);
  }
  if (currentWeek.length > 0) {
    const first = currentWeek[0];
    weeks.push({ weekLabel: `${first.getMonth() + 1}/${first.getDate()}`, days: currentWeek });
  }
  return weeks;
}

type ViewScale = 'day' | 'week';

/** 進捗率バッジ */
function ProgressRateBadge({ rate }: { rate: { total: number; completed: number } }) {
  const pct = rate.total > 0 ? Math.round((rate.completed / rate.total) * 100) : 0;
  const color = pct >= 80 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444';
  return (
    <span
      className="text-[9px] px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap shrink-0"
      style={{ backgroundColor: `${color}18`, color, border: `1px solid ${color}40` }}
      title={`進捗: ${rate.completed}/${rate.total} (${pct}%)`}
    >
      {rate.completed}/{rate.total}
    </span>
  );
}

/** タスク名セル共通（日付を常時表示、期日超過を赤く、進捗率バッジ表示） */
function TaskNameCell({
  task, milestone, overdue, canEdit, onUpdateTask, onDeleteTask,
  progressItems, onLinkProgressItem,
}: {
  task: ScheduleTaskWithMarkers; milestone: boolean; overdue: boolean;
  canEdit: boolean;
  onUpdateTask?: ScheduleGanttChartProps['onUpdateTask'];
  onDeleteTask?: ScheduleGanttChartProps['onDeleteTask'];
  progressItems?: CourseProgressItem[];
  onLinkProgressItem?: (taskId: string, itemId: string | null) => void;
}) {
  const [showLinkMenu, setShowLinkMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showLinkMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowLinkMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showLinkMenu]);

  const nameColor = overdue
    ? 'text-red-700 font-semibold'
    : task.is_completed
      ? 'line-through text-gray-400'
      : 'text-[#1e3a5f]';

  const dateLabel = task.start_date
    ? milestone
      ? shortDate(task.start_date)
      : `${shortDate(task.start_date)}~${task.end_date ? shortDate(task.end_date) : ''}`
    : null;

  const linkedItemName = task.linked_progress_item_id && progressItems
    ? progressItems.find((i) => i.id === task.linked_progress_item_id)?.name
    : null;

  return (
    <div className="flex items-center gap-1.5">
      {milestone && (
        <span className={`text-[10px] shrink-0 ${overdue ? 'text-red-500' : 'text-purple-400'}`} title="マイルストーン（単日）">&#9670;</span>
      )}
      {overdue && !milestone && (
        <span className="text-[9px] shrink-0 text-red-500" title="期日超過">!</span>
      )}
      <div className="flex-1 min-w-0">
        <InlineEditCell
          value={task.name}
          onSave={(val) => onUpdateTask?.(task.id, { name: val })}
          disabled={!canEdit || !onUpdateTask}
          className={`text-[11px] ${nameColor}`}
        />
      </div>
      {/* 進捗率バッジ */}
      {task.linked_progress_rate && (
        <ProgressRateBadge rate={task.linked_progress_rate} />
      )}
      {/* リンクボタン */}
      {canEdit && onLinkProgressItem && progressItems && progressItems.length > 0 && (
        <div className="relative shrink-0">
          <button
            onClick={() => setShowLinkMenu(!showLinkMenu)}
            className={`text-[9px] px-1 py-0.5 rounded transition-all shrink-0 ${
              task.linked_progress_item_id
                ? 'text-blue-600 bg-blue-50 hover:bg-blue-100'
                : 'text-gray-400 hover:text-blue-500 opacity-0 group-hover/task:opacity-100'
            }`}
            title={linkedItemName ? `リンク: ${linkedItemName}` : '進捗項目をリンク'}
          >
            {task.linked_progress_item_id ? '🔗' : '🔗'}
          </button>
          {showLinkMenu && (
            <div ref={menuRef} className="absolute top-full right-0 mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-xl py-1 min-w-[180px] max-h-48 overflow-y-auto">
              <div className="px-2 py-1 text-[9px] text-gray-400 border-b border-gray-100">進捗項目をリンク</div>
              {task.linked_progress_item_id && (
                <button
                  onClick={() => { onLinkProgressItem(task.id, null); setShowLinkMenu(false); }}
                  className="w-full text-left px-2 py-1.5 text-[10px] text-red-500 hover:bg-red-50"
                >
                  リンク解除
                </button>
              )}
              {progressItems.filter((i) => i.column_type === 'check').map((item) => (
                <button
                  key={item.id}
                  onClick={() => { onLinkProgressItem(task.id, item.id); setShowLinkMenu(false); }}
                  className={`w-full text-left px-2 py-1.5 text-[10px] hover:bg-blue-50 flex items-center gap-1.5 ${
                    task.linked_progress_item_id === item.id ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700'
                  }`}
                >
                  {task.linked_progress_item_id === item.id && <span className="text-blue-500">✓</span>}
                  <span>{item.name}</span>
                  {item.column_group && (
                    <span className="text-[8px] text-gray-400">({item.column_group})</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {/* 日付を常時表示 */}
      {dateLabel && (
        <span className={`text-[9px] shrink-0 whitespace-nowrap ${overdue ? 'text-red-400 font-medium' : 'text-gray-400'}`}>
          {dateLabel}
        </span>
      )}
      {canEdit && onDeleteTask && (
        <button
          onClick={() => { if (confirm(`「${task.name}」を削除しますか？`)) onDeleteTask(task.id); }}
          className="text-[9px] text-red-400 hover:text-red-600 opacity-0 group-hover/task:opacity-100 transition-opacity shrink-0"
          title="削除"
        >✕</button>
      )}
    </div>
  );
}

export function ScheduleGanttChart({
  tasks, deadlineItems = [], progressItems = [], progressSummary,
  startDate, endDate, canEdit,
  onToggleComplete, onMarkerClick, onUpdateTask, onDeleteTask,
}: ScheduleGanttChartProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const todayRef = useRef<HTMLDivElement>(null);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [scale, setScale] = useState<ViewScale>('week');

  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);

  const dates = useMemo(() => {
    const result: Date[] = [];
    const d = new Date(startDate);
    while (d <= endDate) { result.push(new Date(d)); d.setDate(d.getDate() + 1); }
    return result;
  }, [startDate, endDate]);

  const weeks = useMemo(() => generateWeekHeaders(dates), [dates]);

  const monthHeaders = useMemo(() => {
    const months: { label: string; span: number }[] = [];
    let current = '';
    for (const d of dates) {
      const key = `${d.getMonth() + 1}月`;
      if (key !== current) { months.push({ label: key, span: 1 }); current = key; }
      else months[months.length - 1].span++;
    }
    return months;
  }, [dates]);

  const categories = useMemo(() => {
    const map = new Map<string, ScheduleTaskWithMarkers[]>();
    for (const t of tasks) {
      if (!map.has(t.major_category)) map.set(t.major_category, []);
      map.get(t.major_category)!.push(t);
    }
    return Array.from(map.entries()).map(([category, categoryTasks]) => ({ category, tasks: categoryTasks }));
  }, [tasks]);

  useEffect(() => {
    if (todayRef.current && scrollRef.current) {
      const container = scrollRef.current;
      const todayEl = todayRef.current;
      const containerRect = container.getBoundingClientRect();
      const todayRect = todayEl.getBoundingClientRect();
      container.scrollLeft += todayRect.left - containerRect.left - containerRect.width / 3;
    }
  }, [dates]);

  const toggleCategory = useCallback((cat: string) => {
    setCollapsedCategories((prev) => { const next = new Set(prev); if (next.has(cat)) next.delete(cat); else next.add(cat); return next; });
  }, []);

  const handleLinkProgressItem = useCallback((taskId: string, itemId: string | null) => {
    onUpdateTask?.(taskId, { linked_progress_item_id: itemId });
  }, [onUpdateTask]);

  const isInBar = useCallback((task: ScheduleTaskWithMarkers, date: Date): boolean => {
    if (!task.start_date || !task.end_date) return false;
    return date >= new Date(task.start_date) && date <= new Date(task.end_date);
  }, []);
  const isBarStart = useCallback((task: ScheduleTaskWithMarkers, date: Date): boolean => {
    return task.start_date ? isSameDay(new Date(task.start_date), date) : false;
  }, []);
  const isBarEnd = useCallback((task: ScheduleTaskWithMarkers, date: Date): boolean => {
    return task.end_date ? isSameDay(new Date(task.end_date), date) : false;
  }, []);
  const getMarker = useCallback((task: ScheduleTaskWithMarkers, dateStr: string): ScheduleMarker | undefined => {
    return task.markers.find((m) => m.marker_date === dateStr);
  }, []);

  const getWeekCellState = useCallback((task: ScheduleTaskWithMarkers, weekDays: Date[]) => {
    let hasBar = false, start = false, end = false, milestoneInWeek = false, hasMarker = false;
    let markerLabel: string | undefined, markerColor: string | undefined;
    const ms = isMilestone(task);
    for (const d of weekDays) {
      if (isInBar(task, d)) hasBar = true;
      if (isBarStart(task, d)) { start = true; if (ms) milestoneInWeek = true; }
      if (isBarEnd(task, d)) end = true;
      const m = getMarker(task, formatDate(d));
      if (m) { hasMarker = true; markerLabel = m.label; markerColor = m.color || undefined; }
    }
    return { hasBar, isStart: start, isEnd: end, isMilestoneInWeek: milestoneInWeek, hasMarker, markerLabel, markerColor };
  }, [isInBar, isBarStart, isBarEnd, getMarker]);

  const hasDeadlineInWeek = useCallback((item: CourseProgressItem, weekDays: Date[]): boolean => {
    return item.deadline ? weekDays.some((d) => formatDate(d) === item.deadline) : false;
  }, []);

  /** バーの色クラスを返す */
  const getBarClasses = (task: ScheduleTaskWithMarkers, od: boolean): string => {
    if (task.is_completed) return 'bg-emerald-400/60 border border-emerald-500/40';
    if (od) return 'bg-red-400/50 border border-red-500/40';
    return 'bg-blue-500/30 border border-blue-500/25';
  };

  if (tasks.length === 0) {
    return <div className="py-12 text-center text-sm text-gray-400 italic">スケジュールがありません。テンプレートから作成してください。</div>;
  }

  const completedTotal = tasks.filter((t) => t.is_completed).length;
  const totalTasks = tasks.length;
  const overallPct = totalTasks > 0 ? Math.round((completedTotal / totalTasks) * 100) : 0;
  const overdueCount = tasks.filter((t) => isOverdue(t, today)).length;

  // 左カラム幅
  const LEFT_CHECK_W = 28;
  const LEFT_NAME_W = 220;

  // ===== 共通: カテゴリヘッダーセル =====
  const renderCategoryHeader = (category: string, catTasks: ScheduleTaskWithMarkers[], colSpan: number, colorIdx: number) => {
    const isCollapsed = collapsedCategories.has(category);
    const completedCount = catTasks.filter((t) => t.is_completed).length;
    const catPct = catTasks.length > 0 ? Math.round((completedCount / catTasks.length) * 100) : 0;
    const catOverdue = catTasks.filter((t) => isOverdue(t, today)).length;
    const c = CATEGORY_COLORS[colorIdx % CATEGORY_COLORS.length];
    return (
      <td
        colSpan={colSpan}
        className="sticky left-0 z-20 border-b border-gray-200 px-3 py-2 cursor-pointer hover:brightness-95 transition-all"
        style={{ backgroundColor: c.bg, borderLeft: `3px solid ${c.border}` }}
        onClick={() => toggleCategory(category)}
      >
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-gray-400 transition-transform" style={{ transform: isCollapsed ? 'rotate(-90deg)' : '' }}>▼</span>
          <span className="text-xs font-bold" style={{ color: c.text }}>{category}</span>
          <span className="text-[10px] text-gray-400">{completedCount}/{catTasks.length}</span>
          <div className="w-16 h-1.5 bg-white/60 rounded-full overflow-hidden ml-1">
            <div className="h-full rounded-full transition-all" style={{ width: `${catPct}%`, backgroundColor: c.border }} />
          </div>
          <span className="text-[10px] font-medium" style={{ color: c.border }}>{catPct}%</span>
          {catOverdue > 0 && (
            <span className="text-[9px] text-red-600 bg-red-100 px-1.5 py-0.5 rounded font-medium ml-1">
              {catOverdue}件超過
            </span>
          )}
        </div>
      </td>
    );
  };

  // ===== 共通: タスク行の左側セル（チェック + タスク名） =====
  const renderTaskLeftCells = (task: ScheduleTaskWithMarkers, od: boolean, ms: boolean, rowIdx: number) => {
    const rowBg = od ? 'bg-red-50/60' : rowIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50/40';
    return (
      <>
        <td className={`sticky left-0 z-10 ${rowBg} border-b border-r border-gray-200 px-1 py-1 text-center`}
          style={{ minWidth: LEFT_CHECK_W }}>
          <input type="checkbox" checked={task.is_completed}
            onChange={(e) => canEdit && onToggleComplete(task.id, e.target.checked)}
            disabled={!canEdit} className="w-3.5 h-3.5 text-[#3b82f6] rounded cursor-pointer disabled:cursor-default" />
        </td>
        <td className={`sticky z-10 ${rowBg} border-b border-r border-gray-200 px-2 py-1 group/task`}
          style={{ left: LEFT_CHECK_W, minWidth: LEFT_NAME_W }}>
          <TaskNameCell task={task} milestone={ms} overdue={od} canEdit={canEdit} onUpdateTask={onUpdateTask} onDeleteTask={onDeleteTask} progressItems={progressItems} onLinkProgressItem={handleLinkProgressItem} />
        </td>
      </>
    );
  };

  // ===== 日表示 =====
  const renderDayView = () => (
    <table className="border-collapse text-xs min-w-max">
      <thead>
        <tr>
          <th className="sticky left-0 z-30 bg-[#f8fafc] border-b border-r border-gray-200" style={{ minWidth: LEFT_CHECK_W }} />
          <th className="sticky z-30 bg-[#f8fafc] border-b border-r border-gray-200" style={{ left: LEFT_CHECK_W, minWidth: LEFT_NAME_W }} />
          {monthHeaders.map((m, i) => (
            <th key={i} colSpan={m.span} className="border-b border-r border-gray-200 bg-[#f8fafc] px-1 py-1.5 text-center text-[10px] font-semibold text-[#1e3a5f]">{m.label}</th>
          ))}
        </tr>
        <tr>
          <th className="sticky left-0 z-30 bg-[#eef2f7] border-b border-r border-gray-200 px-1 py-1 text-center text-[9px] text-gray-400" style={{ minWidth: LEFT_CHECK_W }}>済</th>
          <th className="sticky z-30 bg-[#eef2f7] border-b border-r border-gray-200 px-2 py-1 text-left text-[10px] text-gray-500 font-medium" style={{ left: LEFT_CHECK_W, minWidth: LEFT_NAME_W }}>タスク名</th>
          {dates.map((d) => {
            const isToday = isSameDay(d, today);
            const weekend = isWeekend(d);
            return (
              <th key={formatDate(d)} className={`border-b border-r border-gray-200 px-0 py-0.5 text-center min-w-[24px] relative ${isToday ? 'bg-red-50' : weekend ? 'bg-gray-50' : 'bg-[#eef2f7]'}`}>
                {isToday && <div ref={todayRef} className="absolute inset-0" />}
                <div className={`text-[9px] leading-tight ${isToday ? 'text-red-600 font-bold' : weekend ? 'text-gray-300' : 'text-gray-500'}`}>{d.getDate()}</div>
                <div className={`text-[8px] leading-tight ${isToday ? 'text-red-500' : weekend ? 'text-gray-300' : 'text-gray-400'}`}>{['日','月','火','水','木','金','土'][d.getDay()]}</div>
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {deadlineItems.length > 0 && (
          <>
            <tr>
              <td colSpan={2 + dates.length} className="sticky left-0 z-20 bg-amber-50/80 border-b border-gray-200 px-3 py-1" style={{ borderLeft: '3px solid #f59e0b' }}>
                <span className="text-[10px] text-amber-700 font-bold">進捗管理 期日</span>
              </td>
            </tr>
            {deadlineItems.map((item) => (
              <tr key={`dl-${item.id}`}>
                <td className="sticky left-0 z-10 bg-white border-b border-r border-gray-200 px-1 text-center" style={{ minWidth: LEFT_CHECK_W }}>
                  <span className="text-amber-500 text-[10px]">&#9670;</span>
                </td>
                <td className="sticky z-10 bg-white border-b border-r border-gray-200 px-2 py-0.5" style={{ left: LEFT_CHECK_W, minWidth: LEFT_NAME_W }}>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-amber-800 truncate">{item.name}</span>
                    {item.deadline && <span className="text-[9px] text-amber-500 shrink-0">{shortDate(item.deadline)}</span>}
                  </div>
                </td>
                {dates.map((d) => {
                  const dateStr = formatDate(d);
                  const isToday = isSameDay(d, today);
                  const isDL = item.deadline === dateStr;
                  return (
                    <td key={dateStr} className={`border-b border-r border-gray-100 relative ${isDL ? 'bg-amber-100' : ''}`}>
                      {isToday && <div className="absolute top-0 bottom-0 left-1/2 w-0.5 bg-red-400 z-10 -translate-x-1/2" />}
                      {isDL && <div className="flex items-center justify-center h-full"><span className="text-[10px] text-amber-600 font-bold">&#9670;</span></div>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </>
        )}
        {categories.map(({ category, tasks: catTasks }, catIdx) => {
          const isCollapsed = collapsedCategories.has(category);
          return (
            <tr key={`cat-${category}`} className="contents">
              {renderCategoryHeader(category, catTasks, 2 + dates.length, catIdx)}
              {!isCollapsed && catTasks.map((task, rowIdx) => {
                const ms = isMilestone(task);
                const od = isOverdue(task, today);
                return (
                  <tr key={task.id} className={`group/row ${task.is_completed ? 'opacity-50' : ''}`}>
                    {renderTaskLeftCells(task, od, ms, rowIdx)}
                    {dates.map((d) => {
                      const dateStr = formatDate(d);
                      const isToday = isSameDay(d, today);
                      const weekend = isWeekend(d);
                      const inBar = isInBar(task, d);
                      const barStart = isBarStart(task, d);
                      const barEnd = isBarEnd(task, d);
                      const marker = getMarker(task, dateStr);
                      const isMD = ms && barStart;
                      return (
                        <td key={dateStr}
                          className={`border-b border-r border-gray-100 px-0 py-0 text-center relative cursor-pointer min-w-[24px] h-[32px] ${weekend && !inBar ? 'bg-gray-50/30' : ''}`}
                          onClick={() => canEdit && onMarkerClick(task.id, dateStr, marker)}
                          title={marker ? marker.label : dateStr}
                        >
                          {isToday && <div className="absolute top-0 bottom-0 left-1/2 w-[2px] bg-red-500/70 z-10 -translate-x-1/2" />}
                          {inBar && !ms && (
                            <div className={`absolute top-1/2 -translate-y-1/2 h-[18px] ${getBarClasses(task, od)} ${barStart ? 'rounded-l' : ''} ${barEnd ? 'rounded-r' : ''}`}
                              style={{ left: barStart ? '1px' : 0, right: barEnd ? '1px' : 0 }} />
                          )}
                          {isMD && (
                            <div className="absolute inset-0 flex items-center justify-center z-5">
                              <span className={`text-[14px] drop-shadow-sm ${task.is_completed ? 'text-emerald-500' : od ? 'text-red-500' : 'text-purple-500'}`}>&#9670;</span>
                            </div>
                          )}
                          {marker && (
                            <div className="relative z-20 text-[7px] font-bold leading-tight py-0.5 truncate max-w-[22px] mx-auto" style={{ color: marker.color || '#1e3a5f' }}>{marker.label}</div>
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

  // ===== 週表示 =====
  const renderWeekView = () => {
    const weekMonthHeaders: { label: string; span: number }[] = [];
    let lastML = '';
    for (const w of weeks) {
      const ml = `${w.days[0].getMonth() + 1}月`;
      if (ml !== lastML) { weekMonthHeaders.push({ label: ml, span: 1 }); lastML = ml; }
      else weekMonthHeaders[weekMonthHeaders.length - 1].span++;
    }

    return (
      <table className="border-collapse text-xs min-w-max">
        <thead>
          <tr>
            <th className="sticky left-0 z-30 bg-[#f8fafc] border-b border-r border-gray-200" style={{ minWidth: LEFT_CHECK_W }} />
            <th className="sticky z-30 bg-[#f8fafc] border-b border-r border-gray-200" style={{ left: LEFT_CHECK_W, minWidth: LEFT_NAME_W }} />
            {weekMonthHeaders.map((m, i) => (
              <th key={i} colSpan={m.span} className="border-b border-r border-gray-200 bg-[#f8fafc] px-1 py-1.5 text-center text-[10px] font-semibold text-[#1e3a5f]">{m.label}</th>
            ))}
          </tr>
          <tr>
            <th className="sticky left-0 z-30 bg-[#eef2f7] border-b border-r border-gray-200 px-1 py-1 text-center text-[9px] text-gray-400" style={{ minWidth: LEFT_CHECK_W }}>済</th>
            <th className="sticky z-30 bg-[#eef2f7] border-b border-r border-gray-200 px-2 py-1 text-left text-[10px] text-gray-500 font-medium" style={{ left: LEFT_CHECK_W, minWidth: LEFT_NAME_W }}>タスク名</th>
            {weeks.map((w, i) => {
              const hasToday = w.days.some((d) => isSameDay(d, today));
              return (
                <th key={i} className={`border-b border-r border-gray-200 px-1 py-1 text-center min-w-[52px] relative ${hasToday ? 'bg-red-50' : 'bg-[#eef2f7]'}`}>
                  {hasToday && <div ref={i === weeks.findIndex((ww) => ww.days.some((dd) => isSameDay(dd, today))) ? todayRef : undefined} className="absolute inset-0" />}
                  <div className={`text-[9px] leading-tight ${hasToday ? 'text-red-600 font-bold' : 'text-gray-500'}`}>{w.weekLabel}~</div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {deadlineItems.length > 0 && (
            <>
              <tr>
                <td colSpan={2 + weeks.length} className="sticky left-0 z-20 bg-amber-50/80 border-b border-gray-200 px-3 py-1" style={{ borderLeft: '3px solid #f59e0b' }}>
                  <span className="text-[10px] text-amber-700 font-bold">進捗管理 期日</span>
                </td>
              </tr>
              {deadlineItems.map((item) => (
                <tr key={`dl-${item.id}`}>
                  <td className="sticky left-0 z-10 bg-white border-b border-r border-gray-200 px-1 text-center" style={{ minWidth: LEFT_CHECK_W }}>
                    <span className="text-amber-500 text-[10px]">&#9670;</span>
                  </td>
                  <td className="sticky z-10 bg-white border-b border-r border-gray-200 px-2 py-0.5" style={{ left: LEFT_CHECK_W, minWidth: LEFT_NAME_W }}>
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-amber-800 truncate">{item.name}</span>
                      {item.deadline && <span className="text-[9px] text-amber-500 shrink-0">{shortDate(item.deadline)}</span>}
                    </div>
                  </td>
                  {weeks.map((w, wi) => {
                    const hasDL = hasDeadlineInWeek(item, w.days);
                    const hasToday = w.days.some((d) => isSameDay(d, today));
                    return (
                      <td key={wi} className={`border-b border-r border-gray-100 text-center relative ${hasDL ? 'bg-amber-100' : ''}`}>
                        {hasToday && <div className="absolute top-0 bottom-0 left-1/2 w-[2px] bg-red-500/70 z-10 -translate-x-1/2" />}
                        {hasDL && <span className="text-[10px] font-bold text-amber-600">&#9670;</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </>
          )}
          {categories.map(({ category, tasks: catTasks }, catIdx) => {
            const isCollapsed = collapsedCategories.has(category);
            return (
              <tr key={`cat-${category}`} className="contents">
                {renderCategoryHeader(category, catTasks, 2 + weeks.length, catIdx)}
                {!isCollapsed && catTasks.map((task, rowIdx) => {
                  const ms = isMilestone(task);
                  const od = isOverdue(task, today);
                  return (
                    <tr key={task.id} className={`group/row ${task.is_completed ? 'opacity-50' : ''}`}>
                      {renderTaskLeftCells(task, od, ms, rowIdx)}
                      {weeks.map((w, wi) => {
                        const state = getWeekCellState(task, w.days);
                        const hasToday = w.days.some((d) => isSameDay(d, today));
                        return (
                          <td key={wi} className="border-b border-r border-gray-100 text-center relative h-[32px] min-w-[52px]">
                            {hasToday && <div className="absolute top-0 bottom-0 left-1/2 w-[2px] bg-red-500/70 z-10 -translate-x-1/2" />}
                            {state.hasBar && !state.isMilestoneInWeek && (
                              <div className={`absolute top-1/2 -translate-y-1/2 h-[18px] ${getBarClasses(task, od)} ${state.isStart ? 'rounded-l' : ''} ${state.isEnd ? 'rounded-r' : ''}`}
                                style={{ left: state.isStart ? '2px' : 0, right: state.isEnd ? '2px' : 0 }} />
                            )}
                            {state.isMilestoneInWeek && (
                              <div className="absolute inset-0 flex items-center justify-center z-5">
                                <span className={`text-[14px] drop-shadow-sm ${task.is_completed ? 'text-emerald-500' : od ? 'text-red-500' : 'text-purple-500'}`}>&#9670;</span>
                              </div>
                            )}
                            {state.hasMarker && (
                              <div className="relative z-20 text-[7px] font-bold leading-tight py-0.5 truncate mx-auto" style={{ color: state.markerColor || '#1e3a5f' }}>{state.markerLabel}</div>
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
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">準備進捗</span>
              <div className="w-24 h-2.5 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all"
                  style={{ width: `${overallPct}%`, backgroundColor: overallPct >= 80 ? '#10b981' : overallPct >= 50 ? '#f59e0b' : '#ef4444' }} />
              </div>
              <span className="text-xs font-bold text-[#1e3a5f]">{completedTotal}/{totalTasks}</span>
            </div>
            {overdueCount > 0 && (
              <span className="text-[11px] text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full font-medium">
                {overdueCount}件 期日超過
              </span>
            )}
            {progressSummary && progressSummary.total > 0 && (
              <div className="flex items-center gap-2 border-l border-gray-200 pl-4">
                <span className="text-xs text-gray-500">進捗管理</span>
                <ProgressBadge total={progressSummary.total} completed={progressSummary.completed} />
                {progressSummary.itemSummaries && progressSummary.itemSummaries.length > 0 && (
                  <div className="flex items-center gap-1.5 ml-1">
                    {progressSummary.itemSummaries.slice(0, 4).map((s, i) => (
                      <span key={i} className="text-[9px] text-gray-400" title={`${s.name}: ${s.done}/${s.total}`}>{s.name.slice(0, 4)} {s.done}/{s.total}</span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
            <button onClick={() => setScale('week')}
              className={`px-2.5 py-1 text-[10px] rounded-md transition-colors ${scale === 'week' ? 'bg-white text-[#1e3a5f] font-medium shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>週表示</button>
            <button onClick={() => setScale('day')}
              className={`px-2.5 py-1 text-[10px] rounded-md transition-colors ${scale === 'day' ? 'bg-white text-[#1e3a5f] font-medium shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>日表示</button>
          </div>
        </div>
      </div>

      {/* 凡例 */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-1">
        <div className="flex items-center gap-1.5">
          <div className="w-8 h-[14px] bg-blue-500/30 border border-blue-500/25 rounded" />
          <span className="text-[10px] text-gray-500">期間タスク</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[12px] text-purple-500">&#9670;</span>
          <span className="text-[10px] text-gray-500">単日タスク</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-8 h-[14px] bg-emerald-400/60 border border-emerald-500/40 rounded" />
          <span className="text-[10px] text-gray-500">完了</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-8 h-[14px] bg-red-400/50 border border-red-500/40 rounded" />
          <span className="text-[10px] text-gray-500">期日超過</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[12px] text-amber-600">&#9670;</span>
          <span className="text-[10px] text-gray-500">進捗管理 期日</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-[2px] h-3.5 bg-red-500/70 rounded" />
          <span className="text-[10px] text-gray-500">今日</span>
        </div>
      </div>

      {/* ガントチャート */}
      <div ref={scrollRef} className="overflow-x-auto border border-gray-200 rounded-xl bg-white shadow-sm">
        {scale === 'day' ? renderDayView() : renderWeekView()}
      </div>
    </div>
  );
}
