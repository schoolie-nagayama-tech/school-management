'use client';

import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import type { ScheduleTaskWithMarkers, SeasonType } from '@/types/database';

interface ScheduleBoardProps {
  tasks: ScheduleTaskWithMarkers[];
  canEdit: boolean;
  season: SeasonType;
  year: number;
  onToggleComplete: (taskId: string, completed: boolean) => Promise<void>;
  onUpdateTask: (taskId: string, updates: Partial<{
    name: string;
    description: string | null;
    start_date: string | null;
    end_date: string | null;
    major_category: string;
  }>) => Promise<void>;
  onDeleteTask: (taskId: string) => Promise<void>;
  onAddTask: (majorCategory: string, name: string, description?: string) => Promise<void>;
}

/** シーズンごとの全体期間 */
function getSeasonFullRange(season: SeasonType, year: number): { start: Date; end: Date } {
  switch (season) {
    case 'spring':
      return { start: new Date(year, 0, 1), end: new Date(year, 3, 30) };
    case 'summer':
      return { start: new Date(year, 3, 1), end: new Date(year, 7, 31) };
    case 'winter':
      return { start: new Date(year, 9, 1), end: new Date(year + 1, 0, 31) };
    default:
      return { start: new Date(year, 0, 1), end: new Date(year, 3, 30) };
  }
}

function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 日付バーの計算 */
function computeBarPosition(
  startDate: string | null,
  endDate: string | null,
  rangeStart: Date,
  rangeEnd: Date
): { left: number; width: number } | null {
  if (!startDate && !endDate) return null;
  const totalMs = rangeEnd.getTime() - rangeStart.getTime();
  if (totalMs <= 0) return null;

  const s = startDate ? new Date(startDate) : rangeStart;
  const e = endDate ? new Date(endDate) : (startDate ? new Date(startDate) : rangeEnd);

  const leftMs = Math.max(0, s.getTime() - rangeStart.getTime());
  const rightMs = Math.min(totalMs, e.getTime() - rangeStart.getTime());

  const left = (leftMs / totalMs) * 100;
  const width = Math.max(1, ((rightMs - leftMs) / totalMs) * 100);

  return { left, width };
}

/** タイムライン上の週マーカーを生成 */
function generateWeekMarkers(rangeStart: Date, rangeEnd: Date): { position: number; label: string }[] {
  const markers: { position: number; label: string }[] = [];
  const totalMs = rangeEnd.getTime() - rangeStart.getTime();
  if (totalMs <= 0) return markers;

  // 月の1日ごとにマーカーを生成
  const current = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1);
  while (current <= rangeEnd) {
    if (current >= rangeStart) {
      const pos = ((current.getTime() - rangeStart.getTime()) / totalMs) * 100;
      markers.push({
        position: pos,
        label: `${current.getMonth() + 1}月`,
      });
    }
    current.setMonth(current.getMonth() + 1);
  }
  return markers;
}

/** 今日のライン位置 */
function getTodayPosition(rangeStart: Date, rangeEnd: Date): number | null {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const totalMs = rangeEnd.getTime() - rangeStart.getTime();
  if (totalMs <= 0) return null;
  if (now < rangeStart || now > rangeEnd) return null;
  return ((now.getTime() - rangeStart.getTime()) / totalMs) * 100;
}

// ------- Inline editable text -------
function InlineEdit({
  value,
  onSave,
  className,
  placeholder,
  disabled,
}: {
  value: string;
  onSave: (val: string) => void;
  className?: string;
  placeholder?: string;
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

  useEffect(() => {
    setDraft(value);
  }, [value]);

  if (disabled || !editing) {
    return (
      <span
        className={`${className || ''} ${!disabled ? 'cursor-pointer hover:bg-gray-50 rounded px-1 -mx-1' : ''}`}
        onClick={() => !disabled && setEditing(true)}
        title={disabled ? undefined : 'クリックで編集'}
      >
        {value || <span className="text-gray-300 italic">{placeholder || '未設定'}</span>}
      </span>
    );
  }

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) {
      onSave(trimmed);
    }
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
      className={`${className || ''} border border-blue-300 rounded px-1 py-0 outline-none focus:ring-1 focus:ring-blue-400`}
      placeholder={placeholder}
    />
  );
}

// ------- Task Row -------
function TaskRow({
  task,
  canEdit,
  rangeStart,
  rangeEnd,
  onToggleComplete,
  onUpdateTask,
  onDeleteTask,
}: {
  task: ScheduleTaskWithMarkers;
  canEdit: boolean;
  rangeStart: Date;
  rangeEnd: Date;
  onToggleComplete: (taskId: string, completed: boolean) => Promise<void>;
  onUpdateTask: ScheduleBoardProps['onUpdateTask'];
  onDeleteTask: (taskId: string) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const bar = computeBarPosition(task.start_date, task.end_date, rangeStart, rangeEnd);
  const isCompleted = task.is_completed;

  return (
    <div
      className={`group border-b border-gray-50 last:border-b-0 ${
        isCompleted ? 'bg-gray-50/50' : 'hover:bg-blue-50/30'
      } transition-colors`}
    >
      {/* Main row */}
      <div className="flex items-center gap-2 px-3 py-2 min-h-[40px]">
        {/* Checkbox */}
        {canEdit ? (
          <input
            type="checkbox"
            checked={isCompleted}
            onChange={(e) => onToggleComplete(task.id, e.target.checked)}
            className="w-4 h-4 text-[#3b82f6] rounded shrink-0 cursor-pointer"
          />
        ) : (
          <span className={`w-4 h-4 shrink-0 flex items-center justify-center text-xs ${isCompleted ? 'text-green-500' : 'text-gray-300'}`}>
            {isCompleted ? '✓' : '○'}
          </span>
        )}

        {/* Task name */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1">
            <InlineEdit
              value={task.name}
              onSave={(val) => onUpdateTask(task.id, { name: val })}
              disabled={!canEdit}
              className={`text-sm font-medium ${isCompleted ? 'line-through text-gray-400' : 'text-[#1e3a5f]'}`}
            />
            {task.description && !expanded && (
              <span className="text-[10px] text-gray-400 truncate max-w-[120px] hidden sm:inline">
                — {task.description}
              </span>
            )}
          </div>
        </div>

        {/* Date pickers */}
        <div className="flex items-center gap-1 shrink-0">
          <input
            type="date"
            value={task.start_date || ''}
            onChange={(e) => onUpdateTask(task.id, { start_date: e.target.value || null })}
            disabled={!canEdit}
            className="text-[11px] px-1.5 py-0.5 border border-gray-200 rounded w-[110px] disabled:bg-transparent disabled:border-transparent"
            title="開始日"
          />
          <span className="text-gray-300 text-xs">~</span>
          <input
            type="date"
            value={task.end_date || ''}
            onChange={(e) => onUpdateTask(task.id, { end_date: e.target.value || null })}
            disabled={!canEdit}
            className="text-[11px] px-1.5 py-0.5 border border-gray-200 rounded w-[110px] disabled:bg-transparent disabled:border-transparent"
            title="終了日"
          />
        </div>

        {/* Mini bar */}
        <div className="hidden md:block w-32 lg:w-48 shrink-0">
          <div className="relative h-4 bg-gray-100 rounded-full overflow-hidden">
            {bar && (
              <div
                className={`absolute top-0 h-full rounded-full transition-all ${
                  isCompleted ? 'bg-green-400' : 'bg-[#3b82f6]'
                }`}
                style={{ left: `${bar.left}%`, width: `${bar.width}%` }}
                title={
                  task.start_date && task.end_date
                    ? `${formatDateShort(task.start_date)} ~ ${formatDateShort(task.end_date)}`
                    : ''
                }
              />
            )}
            {/* Today marker */}
            {(() => {
              const todayPos = getTodayPosition(rangeStart, rangeEnd);
              if (todayPos === null) return null;
              return (
                <div
                  className="absolute top-0 h-full w-px bg-red-400"
                  style={{ left: `${todayPos}%` }}
                />
              );
            })()}
          </div>
        </div>

        {/* Expand / Delete */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-gray-400 hover:text-gray-600 px-1 py-0.5"
            title="詳細"
          >
            {expanded ? '▲' : '▼'}
          </button>
          {canEdit && (
            <button
              onClick={() => {
                if (confirm(`「${task.name}」を削除しますか？`)) onDeleteTask(task.id);
              }}
              className="text-[10px] text-[#ef4444] hover:text-[#dc2626] px-1 opacity-0 group-hover:opacity-100 transition-opacity"
              title="削除"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-10 pb-3 space-y-2">
          <div>
            <label className="text-[10px] text-gray-400 block mb-0.5">説明</label>
            {canEdit ? (
              <textarea
                value={task.description || ''}
                onChange={(e) => onUpdateTask(task.id, { description: e.target.value || null })}
                placeholder="タスクの説明を入力..."
                className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400 resize-none"
                rows={2}
              />
            ) : (
              <p className="text-xs text-gray-500">{task.description || '—'}</p>
            )}
          </div>
          {task.start_date && task.end_date && (
            <div className="text-[10px] text-gray-400">
              期間: {formatDateShort(task.start_date)} ~ {formatDateShort(task.end_date)}
              {(() => {
                const s = new Date(task.start_date);
                const e = new Date(task.end_date);
                const days = Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24));
                return ` (${days}日間)`;
              })()}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ------- Add Task Inline -------
function AddTaskInline({
  majorCategory,
  onAdd,
}: {
  majorCategory: string;
  onAdd: (majorCategory: string, name: string, description?: string) => Promise<void>;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const handleAdd = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onAdd(majorCategory, name.trim(), desc.trim() || undefined);
      setName('');
      setDesc('');
      setIsOpen(false);
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-1 px-3 py-1.5 text-xs text-gray-400 hover:text-[#3b82f6] hover:bg-blue-50/50 rounded transition-colors w-full"
      >
        <span className="text-sm">+</span> タスク追加
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-blue-50/30 rounded">
      <input
        ref={inputRef}
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') setIsOpen(false); }}
        placeholder="タスク名"
        className="flex-1 min-w-[120px] text-xs border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
      />
      <input
        type="text"
        value={desc}
        onChange={(e) => setDesc(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') setIsOpen(false); }}
        placeholder="説明(任意)"
        className="flex-1 min-w-[100px] text-xs border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
      />
      <div className="flex items-center gap-1">
        <button
          onClick={handleAdd}
          disabled={!name.trim() || saving}
          className="px-3 py-1.5 text-xs bg-[#1e3a5f] text-white rounded hover:bg-[#2c5282] disabled:opacity-50"
        >
          {saving ? '...' : '追加'}
        </button>
        <button
          onClick={() => { setIsOpen(false); setName(''); setDesc(''); }}
          className="px-2 py-1.5 text-xs text-gray-400 hover:text-gray-600"
        >
          キャンセル
        </button>
      </div>
    </div>
  );
}

// ------- Add New Category -------
function AddCategoryInline({
  existingCategories,
  onAdd,
}: {
  existingCategories: string[];
  onAdd: (majorCategory: string, name: string, description?: string) => Promise<void>;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [category, setCategory] = useState('');
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [saving, setSaving] = useState(false);

  const handleAdd = async () => {
    if (!category.trim() || !name.trim()) return;
    setSaving(true);
    try {
      await onAdd(category.trim(), name.trim(), desc.trim() || undefined);
      setCategory('');
      setName('');
      setDesc('');
      setIsOpen(false);
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-1.5 px-4 py-2 text-xs text-gray-400 hover:text-[#3b82f6] border border-dashed border-gray-200 hover:border-[#3b82f6] rounded-xl transition-colors w-full justify-center"
      >
        <span className="text-base">+</span> 新しいカテゴリを追加
      </button>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
      <h4 className="text-xs font-bold text-[#1e3a5f]">新しいカテゴリ</h4>
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="text-[10px] text-gray-400 block mb-0.5">カテゴリ名</label>
          <input
            type="text"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="カテゴリ名"
            className="text-xs border border-gray-200 rounded px-2 py-1.5 w-32 focus:outline-none focus:ring-1 focus:ring-blue-400"
            list="existing-cats"
          />
          <datalist id="existing-cats">
            {existingCategories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
        <div>
          <label className="text-[10px] text-gray-400 block mb-0.5">最初のタスク名</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="タスク名"
            className="text-xs border border-gray-200 rounded px-2 py-1.5 w-36 focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        </div>
        <div>
          <label className="text-[10px] text-gray-400 block mb-0.5">説明(任意)</label>
          <input
            type="text"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="任意"
            className="text-xs border border-gray-200 rounded px-2 py-1.5 w-36 focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleAdd}
            disabled={!category.trim() || !name.trim() || saving}
            className="px-3 py-1.5 text-xs bg-[#1e3a5f] text-white rounded hover:bg-[#2c5282] disabled:opacity-50"
          >
            {saving ? '...' : '追加'}
          </button>
          <button
            onClick={() => setIsOpen(false)}
            className="px-2 py-1.5 text-xs text-gray-400 hover:text-gray-600"
          >
            キャンセル
          </button>
        </div>
      </div>
    </div>
  );
}

// ------- Category Section -------
function CategorySection({
  category,
  tasks,
  canEdit,
  rangeStart,
  rangeEnd,
  onToggleComplete,
  onUpdateTask,
  onDeleteTask,
  onAddTask,
}: {
  category: string;
  tasks: ScheduleTaskWithMarkers[];
  canEdit: boolean;
  rangeStart: Date;
  rangeEnd: Date;
  onToggleComplete: ScheduleBoardProps['onToggleComplete'];
  onUpdateTask: ScheduleBoardProps['onUpdateTask'];
  onDeleteTask: ScheduleBoardProps['onDeleteTask'];
  onAddTask: ScheduleBoardProps['onAddTask'];
}) {
  const [collapsed, setCollapsed] = useState(false);
  const completed = tasks.filter((t) => t.is_completed).length;
  const total = tasks.length;
  const progress = total > 0 ? completed / total : 0;

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Category header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400 transition-transform" style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>
            ▼
          </span>
          <h3 className="text-sm font-bold text-[#1e3a5f]">{category}</h3>
          <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
            {completed}/{total} 完了
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-20 h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.round(progress * 100)}%`,
                backgroundColor: progress >= 0.8 ? '#10b981' : progress >= 0.5 ? '#f59e0b' : '#ef4444',
              }}
            />
          </div>
          <span className="text-[10px] text-gray-400 w-8 text-right">
            {Math.round(progress * 100)}%
          </span>
        </div>
      </button>

      {/* Tasks list */}
      {!collapsed && (
        <div className="border-t border-gray-100">
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              canEdit={canEdit}
              rangeStart={rangeStart}
              rangeEnd={rangeEnd}
              onToggleComplete={onToggleComplete}
              onUpdateTask={onUpdateTask}
              onDeleteTask={onDeleteTask}
            />
          ))}
          {canEdit && (
            <div className="border-t border-gray-50">
              <AddTaskInline majorCategory={category} onAdd={onAddTask} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ------- Timeline Header -------
function TimelineHeader({
  rangeStart,
  rangeEnd,
}: {
  rangeStart: Date;
  rangeEnd: Date;
}) {
  const markers = generateWeekMarkers(rangeStart, rangeEnd);
  const todayPos = getTodayPosition(rangeStart, rangeEnd);

  return (
    <div className="relative h-6 bg-gray-100 rounded-lg overflow-hidden mb-4">
      {markers.map((m, i) => (
        <div
          key={i}
          className="absolute top-0 h-full flex items-center"
          style={{ left: `${m.position}%` }}
        >
          <div className="w-px h-full bg-gray-300" />
          <span className="text-[9px] text-gray-500 ml-1 whitespace-nowrap">{m.label}</span>
        </div>
      ))}
      {todayPos !== null && (
        <div
          className="absolute top-0 h-full w-0.5 bg-red-500 z-10"
          style={{ left: `${todayPos}%` }}
          title="今日"
        >
          <div className="absolute -top-0 left-1/2 -translate-x-1/2 bg-red-500 text-white text-[8px] px-1 rounded-b leading-tight">
            今日
          </div>
        </div>
      )}
    </div>
  );
}

// ------- Main Component -------
export function ScheduleBoard({
  tasks,
  canEdit,
  season,
  year,
  onToggleComplete,
  onUpdateTask,
  onDeleteTask,
  onAddTask,
}: ScheduleBoardProps) {
  const { start: rangeStart, end: rangeEnd } = useMemo(
    () => getSeasonFullRange(season, year),
    [season, year]
  );

  // Group tasks by major_category preserving order
  const categories = useMemo(() => {
    const map = new Map<string, ScheduleTaskWithMarkers[]>();
    for (const task of tasks) {
      const cat = task.major_category;
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(task);
    }
    return Array.from(map.entries());
  }, [tasks]);

  const existingCategoryNames = useMemo(
    () => categories.map(([name]) => name),
    [categories]
  );

  // Overall progress
  const completionRate = useMemo(() => {
    if (tasks.length === 0) return 0;
    return tasks.filter((t) => t.is_completed).length / tasks.length;
  }, [tasks]);

  return (
    <div className="space-y-4">
      {/* Overall progress */}
      {tasks.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-4">
            <div className="text-xs text-gray-500 shrink-0">
              全体進捗: {tasks.filter((t) => t.is_completed).length}/{tasks.length}
            </div>
            <div className="flex-1 bg-gray-100 rounded-full h-2.5 max-w-md">
              <div
                className="h-2.5 rounded-full transition-all"
                style={{
                  width: `${Math.round(completionRate * 100)}%`,
                  backgroundColor:
                    completionRate >= 0.8 ? '#10b981' : completionRate >= 0.5 ? '#f59e0b' : '#ef4444',
                }}
              />
            </div>
            <span className="text-sm font-bold text-[#1e3a5f]">
              {Math.round(completionRate * 100)}%
            </span>
          </div>
        </div>
      )}

      {/* Timeline header */}
      <TimelineHeader rangeStart={rangeStart} rangeEnd={rangeEnd} />

      {/* Category sections */}
      {categories.map(([category, categoryTasks]) => (
        <CategorySection
          key={category}
          category={category}
          tasks={categoryTasks}
          canEdit={canEdit}
          rangeStart={rangeStart}
          rangeEnd={rangeEnd}
          onToggleComplete={onToggleComplete}
          onUpdateTask={onUpdateTask}
          onDeleteTask={onDeleteTask}
          onAddTask={onAddTask}
        />
      ))}

      {/* Add new category */}
      {canEdit && (
        <AddCategoryInline
          existingCategories={existingCategoryNames}
          onAdd={onAddTask}
        />
      )}

      {/* Empty state */}
      {tasks.length === 0 && (
        <div className="text-center py-8 text-gray-400 text-sm">
          タスクがありません。上の「テンプレート適用」またはカテゴリ追加から開始してください。
        </div>
      )}
    </div>
  );
}
