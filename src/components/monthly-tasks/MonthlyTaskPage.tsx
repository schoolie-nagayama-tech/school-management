'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useMasterData } from '@/contexts/MasterDataContext';
import { useAuth } from '@/contexts/AuthContext';
import {
  getMonthlyTasks,
  toggleCheck,
  generateFromTemplate,
  syncCourseTasks,
  deleteCourseTasks,
  getTemplates,
  saveTemplate,
  deleteTemplate as deleteTemplateApi,
} from '@/lib/api/monthlyTasks';
import type { MonthlyTaskWithChecks, MonthlyTaskTemplate } from '@/types/database';
import { useToast } from '@/hooks/useToast';
import { TaskListPanel } from './TaskListPanel';
import { TaskSummaryPanel } from './TaskSummaryPanel';
import { TaskPool } from './TaskPool';
import { TemplateDialog } from './TemplateDialog';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Trash2,
  Settings,
  AlertTriangle,
} from 'lucide-react';
import { useConfirm } from '@/hooks/useConfirm';

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
  const { confirm } = useConfirm();

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

  // 講習タスク一括削除
  const courseTaskCount = useMemo(() => tasks.filter(t => t.category === 'course').length, [tasks]);

  const handleDeleteCourseTasks = async () => {
    if (courseTaskCount === 0) { toastError('削除対象の講習タスクがありません'); return; }
    const confirmed = await confirm({
      title: '講習タスク一括削除',
      description: `${year}年${month}月の講習タスク${courseTaskCount}件をすべて削除しますか？\nこの操作は元に戻せません。`,
      confirmLabel: `${courseTaskCount}件を削除`,
      variant: 'danger',
    });
    if (!confirmed) return;
    try {
      const result = await deleteCourseTasks(year, month);
      success(`${result.deleted}件の講習タスクを削除しました`);
      fetchTasks();
    } catch { toastError('講習タスクの削除に失敗しました'); }
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

        {/* アクション */}
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
            {courseTaskCount > 0 && (
              <button
                onClick={handleDeleteCourseTasks}
                className="flex items-center gap-1 px-3 py-1.5 text-xs bg-red-50 text-red-600 hover:bg-red-100 rounded transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                講習削除({courseTaskCount})
              </button>
            )}
            <button
              onClick={handleOpenTemplateDialog}
              className="flex items-center gap-1 px-3 py-1.5 text-xs bg-gray-50 text-gray-700 hover:bg-gray-100 rounded transition-colors"
            >
              <Settings className="w-3.5 h-3.5" />
              テンプレート
            </button>
          </div>
        )}
      </div>

      {/* メインコンテンツ */}
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#d32f2f]" />
        </div>
      ) : (
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
                onToggleCheck={handleToggleCheck}
                canEdit={canEdit}
              />
            </div>
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
