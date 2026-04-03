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
import { AlertSidebar } from './AlertSidebar';
import { TaskTimeline } from './TaskTimeline';
import { TemplateDialog } from './TemplateDialog';
import {
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  Download,
} from 'lucide-react';

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

  // テンプレート
  const [showTemplateDialog, setShowTemplateDialog] = useState(false);
  const [templates, setTemplates] = useState<MonthlyTaskTemplate[]>([]);

  // 編集権限
  const canEdit = profile?.role === 'admin' || profile?.role === 'owner' || profile?.role === 'manager';

  // 対象教室
  const activeSchools = useMemo(() => {
    const selectedIds = getSelectedSchoolIds();
    return schools.filter(
      (s) => selectedIds.includes(s.id) && !s.is_demo
    );
  }, [schools, getSelectedSchoolIds]);

  // データ取得
  const fetchTasks = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await getMonthlyTasks(year, month);
      setTasks(data);
    } catch (err) {
      console.error('Error fetching tasks:', err);
      toastError('タスクの取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [year, month, toastError]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  // 月切替
  const goToPrevMonth = () => {
    if (month === 1) {
      setYear(year - 1);
      setMonth(12);
    } else {
      setMonth(month - 1);
    }
  };
  const goToNextMonth = () => {
    if (month === 12) {
      setYear(year + 1);
      setMonth(1);
    } else {
      setMonth(month + 1);
    }
  };
  const goToCurrentMonth = () => {
    setYear(now.getFullYear());
    setMonth(now.getMonth() + 1);
  };

  // 進捗サマリー
  const progressSummary = useMemo(() => {
    const schoolIds = activeSchools.map((s) => s.id);
    const totalChecks = tasks.length * schoolIds.length;
    let completedChecks = 0;
    let businessTotal = 0;
    let businessCompleted = 0;
    let courseTotal = 0;
    let courseCompleted = 0;

    for (const task of tasks) {
      for (const sid of schoolIds) {
        const check = task.checks.find((c) => c.school_id === sid);
        const isBusiness = task.category === 'business';
        if (isBusiness) {
          businessTotal++;
        } else {
          courseTotal++;
        }
        if (check?.is_completed) {
          completedChecks++;
          if (isBusiness) businessCompleted++;
          else courseCompleted++;
        }
      }
    }

    return {
      totalChecks,
      completedChecks,
      percent: totalChecks > 0 ? Math.round((completedChecks / totalChecks) * 100) : 0,
      businessTotal,
      businessCompleted,
      courseTotal,
      courseCompleted,
    };
  }, [tasks, activeSchools]);

  // タスク操作
  const handleToggleCheck = useCallback(
    async (taskId: string, schoolId: string, isCompleted: boolean) => {
      // 楽観的更新
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
                {
                  id: `temp-${Date.now()}`,
                  task_id: taskId,
                  school_id: schoolId,
                  is_completed: isCompleted,
                  completed_at: isCompleted ? new Date().toISOString() : null,
                  completed_by: null,
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                },
              ];
          return { ...t, checks: updatedChecks };
        })
      );

      try {
        await toggleCheck(taskId, schoolId, isCompleted);
      } catch {
        toastError('チェックの更新に失敗しました');
        fetchTasks(); // ロールバック
      }
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
      } catch {
        toastError('タスクの追加に失敗しました');
      }
    },
    [year, month, success, toastError]
  );

  const handleUpdateTask = useCallback(
    async (taskId: string, updates: Record<string, unknown>) => {
      try {
        await updateTask(taskId, updates);
        setTasks((prev) =>
          prev.map((t) => (t.id === taskId ? { ...t, ...updates } : t))
        );
      } catch {
        toastError('タスクの更新に失敗しました');
      }
    },
    [toastError]
  );

  const handleDeleteTask = useCallback(
    async (taskId: string) => {
      try {
        await deleteTask(taskId);
        setTasks((prev) => prev.filter((t) => t.id !== taskId));
        success('タスクを削除しました');
      } catch {
        toastError('タスクの削除に失敗しました');
      }
    },
    [success, toastError]
  );

  const handleUpdateNote = useCallback(
    async (taskId: string, note: string | null) => {
      try {
        await updateNote(taskId, note);
        setTasks((prev) =>
          prev.map((t) => (t.id === taskId ? { ...t, note } : t))
        );
      } catch {
        toastError('補足の更新に失敗しました');
      }
    },
    [toastError]
  );

  // 講習タスク取り込み
  const handleSyncCourse = async () => {
    setIsSyncing(true);
    try {
      const result = await syncCourseTasks(year, month);
      if (result.imported > 0) {
        success(`${result.imported}件の講習タスクを取り込みました`);
        fetchTasks();
      } else {
        success('取り込み対象の講習タスクはありませんでした');
      }
    } catch {
      toastError('講習タスクの取り込みに失敗しました');
    } finally {
      setIsSyncing(false);
    }
  };

  // テンプレート操作
  const handleOpenTemplateDialog = async () => {
    try {
      const tpls = await getTemplates();
      setTemplates(tpls);
    } catch {
      toastError('テンプレートの取得に失敗しました');
    }
    setShowTemplateDialog(true);
  };

  const handleGenerateFromTemplate = async (templateId: string) => {
    try {
      const result = await generateFromTemplate(year, month, templateId);
      success(`${result.created}件のタスクを生成しました`);
      setShowTemplateDialog(false);
      fetchTasks();
    } catch {
      toastError('テンプレートからの生成に失敗しました');
    }
  };

  const handleSaveTemplate = async (name: string) => {
    try {
      await saveTemplate(year, month, name);
      success('テンプレートを保存しました');
      const tpls = await getTemplates();
      setTemplates(tpls);
    } catch {
      toastError('テンプレートの保存に失敗しました');
    }
  };

  const handleDeleteTemplate = async (templateId: string) => {
    try {
      await deleteTemplateApi(templateId);
      success('テンプレートを削除しました');
      setTemplates((prev) => prev.filter((t) => t.id !== templateId));
    } catch {
      toastError('テンプレートの削除に失敗しました');
    }
  };

  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1;

  return (
    <div className="space-y-4">
      {/* ヘッダー: 月選択 + 進捗バー + アクション */}
      <div className="flex flex-wrap items-center gap-3">
        {/* 月選択 */}
        <div className="flex items-center gap-1">
          <button
            onClick={goToPrevMonth}
            className="p-1.5 rounded hover:bg-gray-100 transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="text-lg font-bold min-w-[140px] text-center">
            {year}年{month}月
          </span>
          <button
            onClick={goToNextMonth}
            className="p-1.5 rounded hover:bg-gray-100 transition-colors"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
          {!isCurrentMonth && (
            <button
              onClick={goToCurrentMonth}
              className="ml-1 px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded transition-colors"
            >
              今月
            </button>
          )}
        </div>

        {/* 進捗サマリー */}
        <div className="flex items-center gap-3 text-xs text-gray-600">
          <span>
            業務: {progressSummary.businessCompleted}/{progressSummary.businessTotal}
          </span>
          <span>
            講習: {progressSummary.courseCompleted}/{progressSummary.courseTotal}
          </span>
          <div className="flex items-center gap-1.5">
            <div className="w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-[#d32f2f] rounded-full transition-all"
                style={{ width: `${progressSummary.percent}%` }}
              />
            </div>
            <span className="font-medium">{progressSummary.percent}%</span>
          </div>
        </div>

        {/* アクションボタン */}
        {canEdit && (
          <div className="flex items-center gap-2 ml-auto">
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
              <CalendarDays className="w-3.5 h-3.5" />
              テンプレート
            </button>
          </div>
        )}
      </div>

      {/* メインコンテンツ: 2カラム */}
      <div className="flex gap-4" style={{ minHeight: 'calc(100vh - 200px)' }}>
        {/* 左: アラートサイドバー */}
        <div className="w-64 flex-shrink-0">
          <AlertSidebar
            tasks={tasks}
            schools={activeSchools}
            year={year}
            month={month}
          />
        </div>

        {/* 右: タスクタイムライン */}
        <div className="flex-1 min-w-0">
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#d32f2f]" />
            </div>
          ) : tasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-gray-500">
              <CalendarDays className="w-12 h-12 mb-3 text-gray-300" />
              <p className="text-sm">この月のタスクはありません</p>
              {canEdit && (
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={handleOpenTemplateDialog}
                    className="text-xs px-3 py-1.5 bg-[#d32f2f] text-white rounded hover:bg-[#b71c1c] transition-colors"
                  >
                    テンプレートから生成
                  </button>
                </div>
              )}
            </div>
          ) : (
            <TaskTimeline
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
          )}
        </div>
      </div>

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
