'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useMasterData } from '@/contexts/MasterDataContext';
import { useAuth } from '@/contexts/AuthContext';
import {
  getMonthlyTasks,
  createTask,
  updateTask,
  deleteTask,
  toggleCheck,
  updateNote,
  generateFromTemplate,
  syncCourseTasks,
  getTemplates,
  saveTemplate,
  deleteTemplate as deleteTemplateApi,
} from '@/lib/api/monthlyTasks';
import type { MonthlyTaskWithChecks, MonthlyTaskTemplate, MonthlyTaskCategory } from '@/types/database';
import { useToast } from '@/hooks/useToast';
import { TaskCalendar } from './TaskCalendar';
import { TaskDayPanel } from './TaskDayPanel';
import { TaskListPanel } from './TaskListPanel';
import { TaskSummaryPanel } from './TaskSummaryPanel';
import { TaskPool } from './TaskPool';
import { TemplateDialog } from './TemplateDialog';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Settings,
  AlertTriangle,
  Building2,
  List,
  Calendar as CalendarIcon,
} from 'lucide-react';

interface PoolItem {
  task_name: string;
  category: 'business' | 'course';
  day_of_month: number;
  sort_order: number;
}

export function MonthlyTaskPage() {
  const { schools } = useMasterData();
  const { getSelectedSchoolIds, profile } = useAuth();
  const { success, error: toastError } = useToast();

  // 月選択
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  // データ
  const [tasks, setTasks] = useState<MonthlyTaskWithChecks[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);

  // UI state
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [showTemplateDialog, setShowTemplateDialog] = useState(false);
  const [templates, setTemplates] = useState<MonthlyTaskTemplate[]>([]);
  const [poolItems, setPoolItems] = useState<PoolItem[]>([]);
  const [layoutMode, setLayoutMode] = useState<'list' | 'calendar'>('list');

  // 編集権限
  const canEdit = profile?.role === 'admin' || profile?.role === 'owner' || profile?.role === 'manager';

  // 対象教室
  const activeSchools = useMemo(() => {
    const selectedIds = getSelectedSchoolIds();
    return schools.filter((s) => selectedIds.includes(s.id) && !s.is_demo);
  }, [schools, getSelectedSchoolIds]);

  // データ取得
  const fetchTasks = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await getMonthlyTasks(year, month);
      setTasks(data);
    } catch {
      toastError('タスクの取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [year, month, toastError]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  // 初回: 今日を選択
  useEffect(() => {
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    if (year === now.getFullYear() && month === now.getMonth() + 1) {
      setSelectedDate(todayStr);
    } else {
      setSelectedDate(`${year}-${String(month).padStart(2, '0')}-01`);
    }
  }, [year, month]);

  // 月切替
  const goToPrevMonth = () => {
    if (month === 1) { setYear(year - 1); setMonth(12); }
    else setMonth(month - 1);
  };
  const goToNextMonth = () => {
    if (month === 12) { setYear(year + 1); setMonth(1); }
    else setMonth(month + 1);
  };
  const goToCurrentMonth = () => {
    setYear(now.getFullYear());
    setMonth(now.getMonth() + 1);
  };

  // 進捗サマリー
  const progressSummary = useMemo(() => {
    const schoolIds = activeSchools.map((s) => s.id);
    let total = 0, completed = 0, businessTotal = 0, businessCompleted = 0, courseTotal = 0, courseCompleted = 0;

    for (const task of tasks) {
      for (const sid of schoolIds) {
        const check = task.checks.find((c) => c.school_id === sid);
        const isBusiness = task.category === 'business';
        total++;
        if (isBusiness) businessTotal++; else courseTotal++;
        if (check?.is_completed) {
          completed++;
          if (isBusiness) businessCompleted++; else courseCompleted++;
        }
      }
    }

    return {
      total, completed,
      percent: total > 0 ? Math.round((completed / total) * 100) : 0,
      businessTotal, businessCompleted, courseTotal, courseCompleted,
    };
  }, [tasks, activeSchools]);

  // 超過タスク数
  const overdueCount = useMemo(() => {
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const schoolIds = activeSchools.map((s) => s.id);
    return tasks.filter((t) => {
      if (t.task_date >= todayStr) return false;
      return schoolIds.some((sid) => {
        const check = t.checks.find((c) => c.school_id === sid);
        return !check || !check.is_completed;
      });
    }).length;
  }, [tasks, activeSchools, now]);

  // 教室別進捗
  const schoolProgress = useMemo(() => {
    return activeSchools.map((school) => {
      const total = tasks.length;
      const completed = tasks.filter((t) =>
        t.checks.find((c) => c.school_id === school.id)?.is_completed
      ).length;
      return { school, total, completed, percent: total > 0 ? Math.round((completed / total) * 100) : 0 };
    });
  }, [tasks, activeSchools]);

  // タスク操作
  const handleToggleCheck = useCallback(
    async (taskId: string, schoolId: string, isCompleted: boolean) => {
      setTasks((prev) =>
        prev.map((t) => {
          if (t.id !== taskId) return t;
          const existingCheck = t.checks.find((c) => c.school_id === schoolId);
          const updatedChecks = existingCheck
            ? t.checks.map((c) =>
                c.school_id === schoolId
                  ? { ...c, is_completed: isCompleted, completed_at: isCompleted ? new Date().toISOString() : null }
                  : c
              )
            : [
                ...t.checks,
                { id: `temp-${Date.now()}`, task_id: taskId, school_id: schoolId, is_completed: isCompleted,
                  completed_at: isCompleted ? new Date().toISOString() : null, completed_by: null,
                  created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
              ];
          return { ...t, checks: updatedChecks };
        })
      );
      try { await toggleCheck(taskId, schoolId, isCompleted); }
      catch { toastError('チェックの更新に失敗しました'); fetchTasks(); }
    },
    [fetchTasks, toastError]
  );

  const handleCreateTask = useCallback(
    async (taskDate: string, category: MonthlyTaskCategory, taskName: string, sortOrder: number) => {
      try {
        const newTask = await createTask({ year, month, task_date: taskDate, category, task_name: taskName, sort_order: sortOrder });
        setTasks((prev) => {
          const updated = [...prev, { ...newTask, checks: newTask.checks || [] }];
          updated.sort((a, b) => a.task_date.localeCompare(b.task_date) || a.sort_order - b.sort_order);
          return updated;
        });
        success('タスクを追加しました');
      } catch { toastError('タスクの追加に失敗しました'); }
    },
    [year, month, success, toastError]
  );

  const handleUpdateTask = useCallback(
    async (taskId: string, updates: Record<string, unknown>) => {
      try {
        await updateTask(taskId, updates);
        setTasks((prev) => {
          const updated = prev.map((t) => (t.id === taskId ? { ...t, ...updates } : t));
          if (updates.task_date) {
            updated.sort((a, b) => a.task_date.localeCompare(b.task_date) || a.sort_order - b.sort_order);
          }
          return updated;
        });
      } catch { toastError('タスクの更新に失敗しました'); }
    },
    [toastError]
  );

  const handleDeleteTask = useCallback(
    async (taskId: string) => {
      try { await deleteTask(taskId); setTasks((prev) => prev.filter((t) => t.id !== taskId)); success('タスクを削除しました'); }
      catch { toastError('タスクの削除に失敗しました'); }
    },
    [success, toastError]
  );

  const handleUpdateNote = useCallback(
    async (taskId: string, note: string | null) => {
      try { await updateNote(taskId, note); setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, note } : t))); }
      catch { toastError('補足の更新に失敗しました'); }
    },
    [toastError]
  );

  // カレンダーD&D: タスクを別日へ移動
  const handleDropTask = useCallback(
    (taskId: string, newDate: string) => {
      handleUpdateTask(taskId, { task_date: newDate });
    },
    [handleUpdateTask]
  );

  // プールアイテムD&D: カレンダーにドロップ → タスク作成
  const handleDropPoolItem = useCallback(
    (item: { task_name: string; category: string; sort_order: number; poolIndex?: number }, date: string) => {
      handleCreateTask(date, item.category as MonthlyTaskCategory, item.task_name, item.sort_order);
      // プールから削除
      if (item.poolIndex !== undefined) {
        setPoolItems((prev) => prev.filter((_, i) => i !== item.poolIndex));
      }
    },
    [handleCreateTask]
  );

  // 講習タスク取り込み
  const handleSyncCourse = async () => {
    setIsSyncing(true);
    try {
      const result = await syncCourseTasks(year, month);
      if (result.imported > 0) { success(`${result.imported}件の講習タスクを取り込みました`); fetchTasks(); }
      else success('取り込み対象の講習タスクはありませんでした');
    } catch { toastError('講習タスクの取り込みに失敗しました'); }
    finally { setIsSyncing(false); }
  };

  // テンプレート操作
  const handleOpenTemplateDialog = async () => {
    try { const tpls = await getTemplates(); setTemplates(tpls); }
    catch { toastError('テンプレートの取得に失敗しました'); }
    setShowTemplateDialog(true);
  };

  const handleGenerateFromTemplate = async (templateId: string) => {
    try {
      const result = await generateFromTemplate(year, month, templateId);
      success(`${result.created}件のタスクを生成しました`);
      setShowTemplateDialog(false);
      fetchTasks();
    } catch { toastError('テンプレートからの生成に失敗しました'); }
  };

  const handleSaveTemplate = async (name: string) => {
    try { await saveTemplate(year, month, name); success('テンプレートを保存しました'); const tpls = await getTemplates(); setTemplates(tpls); }
    catch { toastError('テンプレートの保存に失敗しました'); }
  };

  const handleDeleteTemplate = async (templateId: string) => {
    try { await deleteTemplateApi(templateId); success('テンプレートを削除しました'); setTemplates((prev) => prev.filter((t) => t.id !== templateId)); }
    catch { toastError('テンプレートの削除に失敗しました'); }
  };

  // テンプレートプール: 一括配置
  const handleLoadTemplateToCalendar = async (templateId: string) => {
    await handleGenerateFromTemplate(templateId);
  };

  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1;

  return (
    <div className="h-[calc(100vh-120px)] flex flex-col">
      {/* ヘッダー */}
      <div className="flex items-center gap-3 pb-3 border-b flex-shrink-0">
        {/* 月選択 */}
        <div className="flex items-center gap-1">
          <button onClick={goToPrevMonth} className="p-1.5 rounded hover:bg-gray-100 transition-colors">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="text-lg font-bold min-w-[130px] text-center">
            {year}年{month}月
          </span>
          <button onClick={goToNextMonth} className="p-1.5 rounded hover:bg-gray-100 transition-colors">
            <ChevronRight className="w-5 h-5" />
          </button>
          {!isCurrentMonth && (
            <button onClick={goToCurrentMonth} className="ml-1 px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded transition-colors">
              今月
            </button>
          )}
        </div>

        {/* 進捗サマリー */}
        <div className="flex items-center gap-3 text-xs text-gray-600">
          <span>業務: {progressSummary.businessCompleted}/{progressSummary.businessTotal}</span>
          <span>講習: {progressSummary.courseCompleted}/{progressSummary.courseTotal}</span>
          <div className="flex items-center gap-1.5">
            <div className="w-20 h-2 bg-gray-200 rounded-full overflow-hidden">
              <div className="h-full bg-[#d32f2f] rounded-full transition-all" style={{ width: `${progressSummary.percent}%` }} />
            </div>
            <span className="font-medium">{progressSummary.percent}%</span>
          </div>
        </div>

        {/* 超過バッジ */}
        {overdueCount > 0 && (
          <div className="flex items-center gap-1 px-2 py-1 bg-red-50 border border-red-200 rounded text-xs text-red-700">
            <AlertTriangle className="w-3.5 h-3.5" />
            {overdueCount}件超過
          </div>
        )}

        {/* レイアウト切替 + アクション */}
        <div className="flex items-center gap-2 ml-auto">
          {/* レイアウト切替 */}
          <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
            <button
              onClick={() => setLayoutMode('list')}
              className={`flex items-center gap-1 px-2.5 py-1 text-xs rounded-md transition-colors ${
                layoutMode === 'list' ? 'bg-white shadow text-gray-900 font-medium' : 'text-gray-500 hover:text-gray-700'
              }`}
              title="タスクリスト + カレンダー"
            >
              <List className="w-3.5 h-3.5" />
              リスト
            </button>
            <button
              onClick={() => setLayoutMode('calendar')}
              className={`flex items-center gap-1 px-2.5 py-1 text-xs rounded-md transition-colors ${
                layoutMode === 'calendar' ? 'bg-white shadow text-gray-900 font-medium' : 'text-gray-500 hover:text-gray-700'
              }`}
              title="カレンダー表示"
            >
              <CalendarIcon className="w-3.5 h-3.5" />
              カレンダー
            </button>
          </div>

          {canEdit && (
            <>
              <button
                onClick={handleSyncCourse}
                disabled={isSyncing}
                className="flex items-center gap-1 px-3 py-1.5 text-xs bg-blue-50 text-blue-700 hover:bg-blue-100 rounded transition-colors disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5" />
                {isSyncing ? '取込中...' : '講習取込'}
              </button>
              <button
                onClick={handleOpenTemplateDialog}
                className="flex items-center gap-1 px-3 py-1.5 text-xs bg-gray-50 text-gray-700 hover:bg-gray-100 rounded transition-colors"
              >
                <Settings className="w-3.5 h-3.5" />
                テンプレート
              </button>
            </>
          )}
        </div>
      </div>

      {/* メインコンテンツ */}
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#d32f2f]" />
        </div>
      ) : layoutMode === 'list' ? (
        /* === リストモード（案C）: タスクリスト + サマリー＆Googleカレンダー === */
        <div className="flex-1 flex gap-3 pt-3 min-h-0">
          {/* 左カラム: タスクリスト */}
          <div className="w-[400px] flex-shrink-0 flex flex-col gap-3 min-h-0">
            <div className="flex-1 min-h-0">
              <TaskListPanel
                tasks={tasks}
                schools={activeSchools}
                year={year}
                month={month}
                selectedDate={selectedDate}
                onSelectDate={setSelectedDate}
                canEdit={canEdit}
              />
            </div>
            {/* タスクプール（リストモードでも利用可能） */}
            {canEdit && (
              <TaskPool
                templates={templates.length > 0 ? templates : []}
                onLoadTemplate={handleLoadTemplateToCalendar}
                onDropPoolItem={() => {}}
                canEdit={canEdit}
                poolItems={poolItems}
                onSetPoolItems={setPoolItems}
              />
            )}
          </div>

          {/* 右カラム: サマリー + Googleカレンダー */}
          <div className="flex-1 min-w-[320px]">
            <TaskSummaryPanel
              tasks={tasks}
              schools={activeSchools}
              year={year}
              month={month}
            />
          </div>
        </div>
      ) : (
        /* === カレンダーモード（従来表示） === */
        <div className="flex-1 flex gap-4 pt-3 min-h-0">
          {/* 左カラム: カレンダー + 教室別進捗 + プール */}
          <div className="w-[420px] flex-shrink-0 flex flex-col gap-3 overflow-y-auto">
            <TaskCalendar
              tasks={tasks}
              schools={activeSchools}
              year={year}
              month={month}
              selectedDate={selectedDate}
              onSelectDate={setSelectedDate}
              onDropTask={handleDropTask}
              onDropPoolItem={handleDropPoolItem}
              canEdit={canEdit}
            />

            {/* 教室別進捗 */}
            {schoolProgress.length > 0 && (
              <div className="border border-gray-200 rounded-lg p-3 bg-white">
                <div className="flex items-center gap-1.5 mb-2">
                  <Building2 className="w-3.5 h-3.5 text-gray-500" />
                  <span className="text-xs font-bold text-gray-600">教室別進捗</span>
                </div>
                <div className="space-y-1.5">
                  {schoolProgress.map(({ school, completed, total, percent }) => (
                    <div key={school.id} className="flex items-center gap-2">
                      <span className="text-[11px] text-gray-600 w-20 truncate">{school.name}</span>
                      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            percent >= 80 ? 'bg-green-500' : percent >= 50 ? 'bg-yellow-500' : 'bg-red-400'
                          }`}
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-gray-400 w-12 text-right">{completed}/{total}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* タスクプール */}
            {canEdit && (
              <TaskPool
                templates={templates.length > 0 ? templates : []}
                onLoadTemplate={handleLoadTemplateToCalendar}
                onDropPoolItem={() => {}}
                canEdit={canEdit}
                poolItems={poolItems}
                onSetPoolItems={setPoolItems}
              />
            )}
          </div>

          {/* 右カラム: 選択日のタスク詳細 */}
          <div className="flex-1 min-w-0 border border-gray-200 rounded-lg bg-white overflow-hidden">
            {selectedDate ? (
              <TaskDayPanel
                date={selectedDate}
                tasks={tasks}
                schools={activeSchools}
                year={year}
                month={month}
                canEdit={canEdit}
                onToggleCheck={handleToggleCheck}
                onCreateTask={handleCreateTask}
                onUpdateTask={handleUpdateTask}
                onDeleteTask={handleDeleteTask}
                onUpdateNote={handleUpdateNote}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                カレンダーの日付をクリックしてください
              </div>
            )}
          </div>
        </div>
      )}

      {/* テンプレートダイアログ */}
      {showTemplateDialog && (
        <TemplateDialog
          templates={templates}
          onGenerate={handleGenerateFromTemplate}
          onSave={handleSaveTemplate}
          onDelete={handleDeleteTemplate}
          onClose={() => setShowTemplateDialog(false)}
          hasExistingTasks={tasks.length > 0}
        />
      )}
    </div>
  );
}
