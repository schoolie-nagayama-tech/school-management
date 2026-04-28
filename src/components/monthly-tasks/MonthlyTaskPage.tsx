'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useMasterData } from '@/contexts/MasterDataContext';
import { useAuth } from '@/contexts/AuthContext';
import {
  getMonthlyTasks,
  toggleCheck,
  createTask,
  updateTask,
  deleteTask,
  generateFromTemplate,
  syncCourseTasks,
  deleteCourseTasks,
  getTemplates,
  saveTemplate,
  deleteTemplate as deleteTemplateApi,
  updateTemplate as updateTemplateApi,
  setGoogleEventId,
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
  const [googleCalendarEmail, setGoogleCalendarEmail] = useState<string | null>(null);

  // 編集権限
  const canEdit = profile?.role === 'admin' || profile?.role === 'owner' || profile?.role === 'manager';

  // 対象教室
  const activeSchools = useMemo(() => {
    const selectedIds = getSelectedSchoolIds();
    return schools.filter((s) => selectedIds.includes(s.id) && !s.is_demo);
  }, [schools, getSelectedSchoolIds]);

  // データ取得（silent=true: ローディング表示なしでバックグラウンド同期）
  const fetchTasks = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      const data = await getMonthlyTasks(year, month);
      setTasks(data);
    } catch {
      if (!silent) toastError('タスクの取得に失敗しました');
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, [year, month, toastError]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  // テンプレートを初回ロード（タスクプール表示用）
  useEffect(() => {
    (async () => {
      try {
        const tpls = await getTemplates();
        setTemplates(tpls);
      } catch { /* ignore */ }
    })();
  }, []);

  // Googleカレンダー連携状態＋イベントを1回のAPI呼び出しで取得
  const [calendarEvents, setCalendarEvents] = useState<Array<{ id: string; summary: string; start: string; end: string; allDay: boolean }>>([]);
  const [calendarLoading, setCalendarLoading] = useState(false);

  const fetchCalendarData = useCallback(async () => {
    setCalendarLoading(true);
    try {
      const session = (await (await import('@/lib/supabase')).supabase.auth.getSession()).data.session;
      if (!session) return;
      const lastDay = new Date(year, month, 0).getDate();
      const timeMin = `${year}-${String(month).padStart(2, '0')}-01T00:00:00+09:00`;
      const timeMax = `${year}-${String(month).padStart(2, '0')}-${lastDay}T23:59:59+09:00`;
      const params = new URLSearchParams({ timeMin, timeMax, includeStatus: 'true' });
      const res = await fetch(`/api/integrations/google/calendar/events?${params}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.ok) {
        const json = await res.json();
        if (json.status?.connected && json.status?.email) {
          setGoogleCalendarEmail(json.status.email);
        }
        setCalendarEvents(json.data || []);
      }
    } catch { /* ignore */ }
    finally { setCalendarLoading(false); }
  }, [year, month]);

  useEffect(() => {
    fetchCalendarData();
  }, [fetchCalendarData]);

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


  // Unicode取り消し線を適用/除去する関数
  const applyStrikethrough = (text: string) =>
    text.split('').map(c => c + '\u0336').join('');
  const removeStrikethrough = (text: string) =>
    text.replace(/\u0336/g, '');

  // Googleカレンダーイベントのタイトルを更新（完了時に取り消し線）
  const updateCalendarEventTitle = useCallback(
    async (task: MonthlyTaskWithChecks, allCompleted: boolean) => {
      if (!task.google_event_id) return;
      try {
        const session = (await (await import('@/lib/supabase')).supabase.auth.getSession()).data.session;
        if (!session) return;

        const cleanName = removeStrikethrough(task.task_name);
        const newSummary = allCompleted ? applyStrikethrough(cleanName) : cleanName;

        await fetch('/api/integrations/google/calendar/events', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            eventId: task.google_event_id,
            summary: newSummary,
          }),
        });
      } catch {
        // カレンダー更新失敗は無視（メインのチェック処理を妨げない）
      }
    },
    []
  );

  // タスク操作
  const handleToggleCheck = useCallback(
    async (taskId: string, schoolId: string, isCompleted: boolean) => {
      let updatedTask: MonthlyTaskWithChecks | undefined;
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
          updatedTask = { ...t, checks: updatedChecks };
          return updatedTask;
        })
      );
      try {
        await toggleCheck(taskId, schoolId, isCompleted);

        // Googleカレンダーイベントの取り消し線を更新
        if (updatedTask?.google_event_id) {
          const schoolIds = activeSchools.map(s => s.id);
          const allDone = schoolIds.every(sid =>
            updatedTask!.checks.find(c => c.school_id === sid)?.is_completed
          );
          updateCalendarEventTitle(updatedTask, allDone);
        }
      }
      catch { toastError('チェックの更新に失敗しました'); fetchTasks(); }
    },
    [fetchTasks, toastError, activeSchools, updateCalendarEventTitle]
  );

  // タスク追加（楽観的更新）
  const handleCreateTask = useCallback(
    async (taskDate: string, taskName: string, category: 'business' | 'course', note?: string, url?: string) => {
      // 楽観的にローカルに追加
      const tempId = `temp-${Date.now()}`;
      const optimisticTask: MonthlyTaskWithChecks = {
        id: tempId,
        year,
        month,
        task_date: taskDate,
        task_name: taskName,
        category,
        sort_order: 999,
        note: note || null,
        url: url || null,
        google_event_id: null,
        linked_schedule_task_id: null,
        template_id: null,
        created_by: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        checks: [],
        overrides: [],
      };
      setTasks((prev) => [...prev, optimisticTask]);

      try {
        await createTask({ year, month, task_date: taskDate, category, task_name: taskName, note, url });
        success('タスクを追加しました');
        // サーバーから正しいデータをバックグラウンド同期（スピナーなし）
        fetchTasks(true);
      } catch {
        // 失敗時はロールバック
        setTasks((prev) => prev.filter((t) => t.id !== tempId));
        toastError('タスクの追加に失敗しました');
      }
    },
    [year, month, fetchTasks, success, toastError]
  );

  // 教室が1つだけ選択されている場合のみ教室IDを返す（教室別オーバーライド用）
  const singleSchoolId = useMemo(() => {
    return activeSchools.length === 1 ? activeSchools[0].id : undefined;
  }, [activeSchools]);

  // タスク更新（教室別オーバーライド対応）
  const handleUpdateTask = useCallback(
    async (taskId: string, updates: Record<string, unknown>) => {
      // 楽観的にローカル更新
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, ...updates } : t))
      );
      try {
        await updateTask(taskId, updates, singleSchoolId);
        success(singleSchoolId ? 'この教室のタスクを更新しました' : 'タスクを更新しました');
        fetchTasks(true);
      } catch {
        toastError('タスクの更新に失敗しました');
        fetchTasks();
      }
    },
    [fetchTasks, success, toastError, singleSchoolId]
  );

  // タスク日付移動（ドラッグ&ドロップ）
  const handleMoveTask = useCallback(
    async (taskId: string, newDate: string) => {
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, task_date: newDate } : t))
      );
      try {
        await updateTask(taskId, { task_date: newDate }, singleSchoolId);
      } catch {
        toastError('タスクの移動に失敗しました');
        fetchTasks();
      }
    },
    [fetchTasks, toastError, singleSchoolId]
  );

  // タスク削除（教室別非表示対応）
  const handleDeleteTask = useCallback(
    async (taskId: string) => {
      // 楽観的にローカル削除
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
      try {
        await deleteTask(taskId, singleSchoolId);
        if (singleSchoolId) {
          fetchTasks(true);
        }
        success('タスクを削除しました');
      } catch {
        toastError('タスクの削除に失敗しました');
        fetchTasks();
      }
    },
    [success, toastError, singleSchoolId, fetchTasks]
  );

  // Googleカレンダーにタスク登録
  const handleSyncTaskToCalendar = useCallback(
    async (taskId: string) => {
      const task = tasks.find(t => t.id === taskId);
      if (!task) return;

      try {
        const session = (await (await import('@/lib/supabase')).supabase.auth.getSession()).data.session;
        if (!session) { toastError('認証が必要です'); return; }

        // 既に登録済みの場合は何もしない
        if (task.google_event_id) {
          success('既にカレンダーに登録済みです');
          return;
        }

        // 13:00に0分のイベントとして作成（予定なし + リマインダーのみ）
        const res = await fetch('/api/integrations/google/calendar/events', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            summary: task.task_name,
            description: task.note || '',
            date: task.task_date,
            startTime: '13:00',
            durationMinutes: 0,
            allDay: false,
            reminders: [
              { method: 'popup', minutes: 1440 }, // 前日13:00
              { method: 'popup', minutes: 0 },    // 当日13:00
            ],
          }),
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'カレンダー登録に失敗しました');
        }

        const { data } = await res.json();

        // google_event_id をタスクに保存
        await setGoogleEventId(taskId, data.eventId);

        // ローカルステート更新
        setTasks(prev => prev.map(t =>
          t.id === taskId ? { ...t, google_event_id: data.eventId } : t
        ));

        success('Googleカレンダーに登録しました');
        fetchCalendarData();
      } catch (e) {
        toastError(e instanceof Error ? e.message : 'カレンダー登録に失敗しました');
      }
    },
    [tasks, toastError, success, fetchCalendarData]
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

  const handleUpdateTemplate = async (templateId: string, updates: { name?: string; template_data?: Array<{ day_of_month: number; task_name: string; category: string; sort_order: number }> }) => {
    try {
      const updated = await updateTemplateApi(templateId, updates);
      setTemplates((prev) => prev.map((t) => (t.id === templateId ? updated : t)));
      success('テンプレートを更新しました');
    } catch { toastError('テンプレートの更新に失敗しました'); }
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
          <button onClick={goToPrevMonth} className="p-1.5 rounded hover:bg-gray-100 transition-colors duration-150">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="text-lg font-bold min-w-[130px] text-center">
            {year}年{month}月
          </span>
          <button onClick={goToNextMonth} className="p-1.5 rounded hover:bg-gray-100 transition-colors duration-150">
            <ChevronRight className="w-5 h-5" />
          </button>
          {!isCurrentMonth && (
            <button onClick={goToCurrentMonth} className="ml-1 px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded transition-colors duration-150">
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
              <div className="h-full bg-[#d32f2f] rounded-full transition-[width] duration-500 ease-out" style={{ width: `${progressSummary.percent}%` }} />
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
                className="flex items-center gap-1 px-3 py-1.5 text-xs bg-red-50 text-red-600 hover:bg-red-100 rounded transition-colors duration-150"
              >
                <Trash2 className="w-3.5 h-3.5" />
                講習削除({courseTaskCount})
              </button>
            )}
            <button
              onClick={handleOpenTemplateDialog}
              className="flex items-center gap-1 px-3 py-1.5 text-xs bg-gray-50 text-gray-700 hover:bg-gray-100 rounded transition-colors duration-150"
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
                onCreateTask={handleCreateTask}
                onDeleteTask={handleDeleteTask}
                onUpdateTask={handleUpdateTask}
                onMoveTask={handleMoveTask}
                onSyncToCalendar={handleSyncTaskToCalendar}
                singleSchoolId={singleSchoolId}
                canEdit={canEdit}
                googleCalendarConnected={!!googleCalendarEmail}
              />
            </div>
            {/* タスクプール */}
            {canEdit && (
              <TaskPool
                templates={templates.length > 0 ? templates : []}
                onLoadTemplate={handleLoadTemplateToCalendar}
                onDropPoolItem={() => {}}
                onAddPoolItemAsTask={async (item, targetDate) => {
                  await handleCreateTask(targetDate, item.task_name, item.category);
                }}
                canEdit={canEdit}
                poolItems={poolItems}
                onSetPoolItems={setPoolItems}
                year={year}
                month={month}
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
              googleCalendarId={googleCalendarEmail || undefined}
              calendarEvents={calendarEvents}
              calendarLoading={calendarLoading}
              onRefreshCalendar={fetchCalendarData}
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
          onUpdateTemplate={handleUpdateTemplate}
          onClose={() => setShowTemplateDialog(false)}
          hasExistingTasks={tasks.length > 0}
        />
      )}
    </div>
  );
}
