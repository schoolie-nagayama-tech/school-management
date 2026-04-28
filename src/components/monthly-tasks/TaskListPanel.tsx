'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import type { MonthlyTaskWithChecks, MonthlyTaskOverride, School } from '@/types/database';
import { CheckCircle2, Circle, GripVertical, Plus, ChevronDown, ChevronRight, Trash2, ExternalLink, StickyNote, Link2, Calendar, Loader2 } from 'lucide-react';

interface TaskListPanelProps {
  tasks: MonthlyTaskWithChecks[];
  schools: School[];
  year: number;
  month: number;
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
  onToggleCheck: (taskId: string, schoolId: string, isCompleted: boolean) => void;
  onCreateTask?: (taskDate: string, taskName: string, category: 'business' | 'course', note?: string, url?: string) => Promise<void>;
  onDeleteTask?: (taskId: string) => Promise<void>;
  onUpdateTask?: (taskId: string, updates: Record<string, unknown>) => Promise<void>;
  onMoveTask?: (taskId: string, newDate: string) => Promise<void>;
  onSyncToCalendar?: (taskId: string) => Promise<void>;
  singleSchoolId?: string;
  canEdit: boolean;
  googleCalendarConnected?: boolean;
}

/** オーバーライドを適用したタスクを返す */
function applyOverride(task: MonthlyTaskWithChecks, schoolId?: string): MonthlyTaskWithChecks & { _overridden?: boolean } {
  if (!schoolId || !task.overrides?.length) return task;
  const ov = task.overrides.find((o: MonthlyTaskOverride) => o.school_id === schoolId);
  if (!ov) return task;
  if (ov.is_hidden) return { ...task, _hidden: true } as MonthlyTaskWithChecks & { _hidden: boolean };
  return {
    ...task,
    task_name: ov.task_name ?? task.task_name,
    task_date: ov.task_date ?? task.task_date,
    category: (ov.category ?? task.category) as MonthlyTaskWithChecks['category'],
    note: ov.note !== undefined ? ov.note : task.note,
    url: ov.url !== undefined ? ov.url : task.url,
    _overridden: true,
  };
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
  onUpdateTask,
  onMoveTask,
  onSyncToCalendar,
  singleSchoolId,
  canEdit,
  googleCalendarConnected,
}: TaskListPanelProps) {
  const [filter, setFilter] = useState<'all' | 'incomplete' | 'overdue'>('all');
  const [collapsedDates, setCollapsedDates] = useState<Set<string>>(new Set());
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTaskName, setNewTaskName] = useState('');
  const [newTaskDate, setNewTaskDate] = useState('');
  const [newTaskCategory, setNewTaskCategory] = useState<'business' | 'course'>('business');
  const [newTaskUrl, setNewTaskUrl] = useState('');
  const [newTaskNote, setNewTaskNote] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editCategory, setEditCategory] = useState<'business' | 'course'>('business');
  const [editUrl, setEditUrl] = useState('');
  const [editNote, setEditNote] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [syncingTaskId, setSyncingTaskId] = useState<string | null>(null);
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
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
    const defaultDate = selectedDate || `${year}-${String(month).padStart(2, '0')}-01`;
    setNewTaskDate(defaultDate);
    setNewTaskName('');
    setNewTaskCategory('business');
    setNewTaskUrl('');
    setNewTaskNote('');
    setShowAddForm(true);
  };

  const handleAddTask = async () => {
    if (!newTaskName.trim() || !newTaskDate || !onCreateTask) return;
    setIsCreating(true);
    try {
      await onCreateTask(newTaskDate, newTaskName.trim(), newTaskCategory, newTaskNote.trim() || undefined, newTaskUrl.trim() || undefined);
      setShowAddForm(false);
      setNewTaskName('');
      setNewTaskUrl('');
      setNewTaskNote('');
    } catch { /* handled by parent */ }
    finally { setIsCreating(false); }
  };

  const handleExpandTask = (task: MonthlyTaskWithChecks) => {
    if (expandedTaskId === task.id) {
      setExpandedTaskId(null);
    } else {
      setExpandedTaskId(task.id);
      setEditName(task.task_name);
      setEditDate(task.task_date);
      setEditCategory(task.category as 'business' | 'course');
      setEditUrl(task.url || '');
      setEditNote(task.note || '');
    }
  };

  const handleSaveTaskDetail = async (taskId: string) => {
    if (!onUpdateTask || !editName.trim()) return;
    setIsSaving(true);
    try {
      await onUpdateTask(taskId, {
        task_name: editName.trim(),
        task_date: editDate,
        category: editCategory,
        url: editUrl.trim() || null,
        note: editNote.trim() || null,
      });
      setExpandedTaskId(null);
    } catch { /* handled by parent */ }
    finally { setIsSaving(false); }
  };

  // ドラッグ&ドロップ: タスクを別の日付に移動
  const handleDragStart = (e: React.DragEvent, taskId: string, sourceDate: string) => {
    e.dataTransfer.setData('taskId', taskId);
    e.dataTransfer.setData('sourceDate', sourceDate);
    e.dataTransfer.effectAllowed = 'move';
    setDraggingTaskId(taskId);
  };

  const handleDragOver = (e: React.DragEvent, date: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverDate(date);
  };

  const handleDragLeave = () => {
    setDragOverDate(null);
  };

  const handleDrop = async (e: React.DragEvent, targetDate: string) => {
    e.preventDefault();
    setDragOverDate(null);
    setDraggingTaskId(null);

    // プールアイテムからのドロップ
    const poolRaw = e.dataTransfer.getData('text/pool-item');
    if (poolRaw && onCreateTask) {
      try {
        const poolItem = JSON.parse(poolRaw);
        await onCreateTask(targetDate, poolItem.task_name, poolItem.category);
      } catch { /* ignore */ }
      return;
    }

    // 既存タスクの移動
    const taskId = e.dataTransfer.getData('taskId');
    const sourceDate = e.dataTransfer.getData('sourceDate');
    if (!taskId || sourceDate === targetDate || !onMoveTask) return;
    await onMoveTask(taskId, targetDate);
  };

  const handleDragEnd = () => {
    setDragOverDate(null);
    setDraggingTaskId(null);
  };

  // オーバーライド適用済みタスク（教室別非表示を除外）
  const resolvedTasks = useMemo(() => {
    return tasks
      .map(t => applyOverride(t, singleSchoolId))
      .filter(t => !('_hidden' in t && (t as { _hidden?: boolean })._hidden));
  }, [tasks, singleSchoolId]);

  const filtered = useMemo(() => {
    return resolvedTasks.filter(t => {
      const allDone = schoolIds.every(sid =>
        t.checks.find(c => c.school_id === sid)?.is_completed
      );
      if (filter === 'incomplete') return !allDone;
      if (filter === 'overdue') return t.task_date < today && !allDone;
      return true;
    });
  }, [resolvedTasks, filter, today, schoolIds]);

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
    const allCount = resolvedTasks.length;
    const incompleteCount = resolvedTasks.filter(t =>
      !schoolIds.every(sid => t.checks.find(c => c.school_id === sid)?.is_completed)
    ).length;
    const overdueCount = resolvedTasks.filter(t => {
      const allDone = schoolIds.every(sid =>
        t.checks.find(c => c.school_id === sid)?.is_completed
      );
      return t.task_date < today && !allDone;
    }).length;
    return { allCount, incompleteCount, overdueCount };
  }, [resolvedTasks, today, schoolIds]);

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
          <div className="flex items-center gap-2 mt-1.5">
            <div className="flex items-center gap-1 flex-1">
              <Link2 className="w-3 h-3 text-gray-400 flex-shrink-0" />
              <input
                type="url"
                placeholder="URL（研修リンク等）"
                value={newTaskUrl}
                onChange={(e) => setNewTaskUrl(e.target.value)}
                className="flex-1 text-xs px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
                disabled={isCreating}
              />
            </div>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <div className="flex items-center gap-1 flex-1">
              <StickyNote className="w-3 h-3 text-gray-400 flex-shrink-0" />
              <input
                type="text"
                placeholder="メモ（ID・パスワード等）"
                value={newTaskNote}
                onChange={(e) => setNewTaskNote(e.target.value)}
                className="flex-1 text-xs px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
                disabled={isCreating}
              />
            </div>
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
                {/* Date header (drop target) */}
                <div
                  className={`flex items-center gap-2 px-3 py-1.5 text-xs font-bold border-b sticky top-0 z-10 cursor-pointer select-none transition-colors duration-150 ${
                    dragOverDate === date ? 'bg-blue-100 border-blue-400 ring-1 ring-blue-400' :
                    isToday ? 'bg-blue-50 text-blue-700 border-blue-200' :
                    isSelected ? 'bg-indigo-50 text-indigo-700 border-indigo-200' :
                    isOverdue && !allDateDone ? 'bg-red-50 text-red-600 border-red-100' :
                    'bg-gray-50 text-gray-500 border-gray-100'
                  }`}
                  onClick={() => {
                    onSelectDate(date);
                    toggleCollapse(date);
                  }}
                  onDragOver={(e) => handleDragOver(e, date)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, date)}
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
                  const isExpanded = expandedTaskId === task.id;

                  return (
                    <div key={task.id}>
                      <div
                        className={`flex items-center gap-2 px-3 py-2 border-b border-gray-50 transition-colors group cursor-pointer ${
                          isSelected ? 'bg-blue-50/30' : 'hover:bg-gray-50'
                        } ${isExpanded ? 'bg-blue-50/50' : ''} ${draggingTaskId === task.id ? 'opacity-40' : ''}`}
                        onClick={() => handleExpandTask(task)}
                        draggable={canEdit && !!onMoveTask}
                        onDragStart={(e) => handleDragStart(e, task.id, task.task_date)}
                        onDragEnd={handleDragEnd}
                      >
                        <GripVertical className={`w-3 h-3 flex-shrink-0 ${canEdit && onMoveTask ? 'text-gray-400 cursor-grab active:cursor-grabbing' : 'text-gray-300'}`} />
                        {/* 完了トグル */}
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
                          <div className="flex items-center gap-2 mt-0.5">
                            {task.note && (
                              <span className="flex items-center gap-0.5 text-[10px] text-gray-400 truncate">
                                <StickyNote className="w-2.5 h-2.5" />
                                {task.note}
                              </span>
                            )}
                            {task.url && (
                              <a
                                href={task.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="flex items-center gap-0.5 text-[10px] text-blue-500 hover:text-blue-700 flex-shrink-0"
                                title={task.url}
                              >
                                <ExternalLink className="w-2.5 h-2.5" />
                                リンク
                              </a>
                            )}
                          </div>
                        </div>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 ${
                          task.category === 'business' ? 'bg-orange-50 text-orange-600' : 'bg-purple-50 text-purple-600'
                        }`}>
                          {task.category === 'business' ? '業務' : '講習'}
                        </span>
                        {/* School completion indicators */}
                        <div className="flex gap-0.5 flex-shrink-0 items-center">
                          {schools.length > 1 ? (
                            /* 複数教室: 頭文字+色で表示 */
                            schools.map(s => {
                              const check = task.checks.find(c => c.school_id === s.id);
                              const initial = s.name.replace(/校$/, '').slice(0, 2);
                              return (
                                <span
                                  key={s.id}
                                  className={`text-[9px] leading-none px-1 py-0.5 rounded font-medium ${
                                    check?.is_completed
                                      ? 'bg-green-100 text-green-700'
                                      : taskIsOverdue ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-400'
                                  }`}
                                  title={`${s.name}: ${check?.is_completed ? '完了' : '未完了'}`}
                                >
                                  {initial}
                                </span>
                              );
                            })
                          ) : (
                            /* 1教室: ドットのみ */
                            schools.map(s => {
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
                            })
                          )}
                        </div>
                        {/* Googleカレンダー登録ボタン */}
                        {googleCalendarConnected && onSyncToCalendar && (
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              if (syncingTaskId === task.id) return;
                              setSyncingTaskId(task.id);
                              try { await onSyncToCalendar(task.id); }
                              finally { setSyncingTaskId(null); }
                            }}
                            disabled={syncingTaskId === task.id}
                            className={`flex-shrink-0 p-0.5 transition-[opacity,color] duration-150 ${
                              task.google_event_id
                                ? 'text-blue-500 hover:text-blue-700'
                                : 'text-gray-300 hover:text-blue-500 opacity-0 group-hover:opacity-100'
                            }`}
                            title={task.google_event_id ? 'カレンダー登録済み' : 'Googleカレンダーに登録'}
                          >
                            {syncingTaskId === task.id ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Calendar className={`w-3 h-3 ${task.google_event_id ? 'fill-current' : ''}`} />
                            )}
                          </button>
                        )}
                        {/* 削除ボタン */}
                        {canEdit && !task.linked_schedule_task_id && onDeleteTask && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteTask(task.id);
                            }}
                            className="flex-shrink-0 p-0.5 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity duration-150"
                            title="削除"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                      {/* 展開詳細: タスク編集 */}
                      {isExpanded && canEdit && (
                        <div className="px-3 py-2 bg-gray-50 border-b border-gray-100 space-y-1.5">
                          {/* タスク名 */}
                          <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            placeholder="タスク名"
                            className="w-full text-xs px-2 py-1.5 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400 font-medium"
                            disabled={isSaving}
                          />
                          {/* 日付・カテゴリ */}
                          <div className="flex items-center gap-2">
                            <input
                              type="date"
                              value={editDate}
                              onChange={(e) => setEditDate(e.target.value)}
                              onClick={(e) => e.stopPropagation()}
                              className="text-xs px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
                              disabled={isSaving}
                            />
                            <select
                              value={editCategory}
                              onChange={(e) => setEditCategory(e.target.value as 'business' | 'course')}
                              onClick={(e) => e.stopPropagation()}
                              className="text-xs px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
                              disabled={isSaving}
                            >
                              <option value="business">業務</option>
                              <option value="course">講習</option>
                            </select>
                          </div>
                          {/* URL */}
                          <div className="flex items-center gap-1.5">
                            <Link2 className="w-3 h-3 text-gray-400 flex-shrink-0" />
                            <input
                              type="url"
                              placeholder="URL（研修リンク等）"
                              value={editUrl}
                              onChange={(e) => setEditUrl(e.target.value)}
                              onClick={(e) => e.stopPropagation()}
                              className="flex-1 text-xs px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
                              disabled={isSaving}
                            />
                            {editUrl && (
                              <a
                                href={editUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="p-1 text-blue-500 hover:text-blue-700"
                                title="リンクを開く"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                              </a>
                            )}
                          </div>
                          {/* メモ */}
                          <div className="flex items-center gap-1.5">
                            <StickyNote className="w-3 h-3 text-gray-400 flex-shrink-0" />
                            <input
                              type="text"
                              placeholder="メモ（ID・パスワード等）"
                              value={editNote}
                              onChange={(e) => setEditNote(e.target.value)}
                              onClick={(e) => e.stopPropagation()}
                              className="flex-1 text-xs px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
                              disabled={isSaving}
                            />
                          </div>
                          {/* ボタン */}
                          <div className="flex justify-end gap-2 pt-0.5">
                            <button
                              onClick={(e) => { e.stopPropagation(); setExpandedTaskId(null); }}
                              className="text-xs px-2 py-1 text-gray-500 hover:text-gray-700 transition-colors"
                            >
                              キャンセル
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleSaveTaskDetail(task.id); }}
                              disabled={isSaving || !editName.trim()}
                              className="text-xs px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 transition-colors"
                            >
                              {isSaving ? '保存中...' : '保存'}
                            </button>
                          </div>
                        </div>
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
