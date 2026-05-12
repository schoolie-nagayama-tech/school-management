'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { AdminLayout } from '@/components/layouts';
import { Loading, InlineLoading } from '@/components/ui';
import {
  ScheduleGanttChart,
  ScheduleMarkerInput,
  ScheduleDateRange,
  ScheduleBoard,
} from '@/components/course-schedule';
import { SeasonYearSelector } from '@/components/course-shared/SeasonYearSelector';
import { TemplateApplyDialog } from '@/components/course-shared/TemplateApplyDialog';
import {
  getScheduleTasks,
  createScheduleTask,
  updateScheduleTask,
  deleteScheduleTask,
  upsertScheduleMarker,
  deleteScheduleMarker,
} from '@/lib/api/courseSchedule';
import { batchFetchCoursePrepApi } from '@/lib/api/coursePrepApi';
import { getTemplates, initializeScheduleFromTemplate, saveCurrentAsTemplate, deleteTemplate } from '@/lib/api/courseTemplates';
import type { ScheduleTaskWithMarkers, ScheduleMarker, CourseTemplate, CourseProgressItem, StudentCourseProgress, SeasonType } from '@/types/database';
import { useRequirePermission, useCanEdit } from '@/hooks/usePermissions';
import AccessDenied from '@/components/AccessDenied';
import { useAuth } from '@/contexts/AuthContext';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';
import { exportProgressToPDF } from '@/lib/utils/pdfExport';
import { loadSavedSeasonYear, saveSavedSeasonYear } from '@/lib/utils/coursePrepStorage';

/** シーズンごとの全体期間 */
function getSeasonFullRangeForInit(season: SeasonType, year: number): { start: Date; end: Date } {
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

type ViewMode = 'list' | 'gantt';

export default function CourseSchedulePage() {
  const { hasPermission, isLoading: permissionLoading } = useRequirePermission(
    (p) => p.canAccessCourses
  );
  const canEdit = useCanEdit('canEditApplications');
  const { getSelectedSchoolIds, selectedSchoolId, profile, schoolIds, demoSchoolIds } = useAuth();
  const isOwnerOrAbove =
    profile?.role === 'owner' || profile?.role === 'admin';

  // 期・年（localStorageから復元）
  const [season, setSeasonRaw] = useState<SeasonType>(() => loadSavedSeasonYear().season);
  const [year, setYearRaw] = useState(() => loadSavedSeasonYear().year);

  const setSeason = useCallback((s: SeasonType) => {
    setSeasonRaw(s);
    saveSavedSeasonYear(s, year);
    setDateRange(getSeasonFullRangeForInit(s, year));
  }, [year]);

  const setYear = useCallback((y: number) => {
    setYearRaw(y);
    saveSavedSeasonYear(season, y);
    setDateRange(getSeasonFullRangeForInit(season, y));
  }, [season]);

  // ビューモード（デフォルト: ガントチャート）
  const [viewMode, setViewMode] = useState<ViewMode>('gantt');

  // 表示期間（デフォルト: シーズン全体表示）
  const [dateRange, setDateRange] = useState<{ start: Date; end: Date }>(() => {
    const saved = loadSavedSeasonYear();
    return getSeasonFullRangeForInit(saved.season, saved.year);
  });

  // データ
  const [tasks, setTasks] = useState<ScheduleTaskWithMarkers[]>([]);
  const [deadlineItems, setDeadlineItems] = useState<CourseProgressItem[]>([]);
  const [allProgressItems, setAllProgressItems] = useState<CourseProgressItem[]>([]);
  const [progressSummary, setProgressSummary] = useState<{ total: number; completed: number; itemSummaries?: { name: string; total: number; done: number }[] } | undefined>();
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  // テンプレート
  const [templates, setTemplates] = useState<CourseTemplate[]>([]);
  const [showTemplateDialog, setShowTemplateDialog] = useState(false);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [showSaveTemplateDialog, setShowSaveTemplateDialog] = useState(false);
  const [saveTemplateName, setSaveTemplateName] = useState('');
  const [saveTemplateLoading, setSaveTemplateLoading] = useState(false);

  // マーカー入力（ガントチャート用）
  const [markerInput, setMarkerInput] = useState<{
    taskId: string;
    date: string;
    existing?: ScheduleMarker;
  } | null>(null);

  // PDF出力
  const [isExporting, setIsExporting] = useState(false);

  // 全教室展開
  const [deployLoading, setDeployLoading] = useState(false);

  // デモ除外した管理教室一覧
  const managedSchoolIds = useMemo(() => {
    const demoSet = new Set(demoSchoolIds);
    return schoolIds.filter((id) => !demoSet.has(id));
  }, [schoolIds, demoSchoolIds]);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage('');
    try {
      const ids = getSelectedSchoolIds();
      if (ids.length === 0) {
        setErrorMessage('教室が選択されていません');
        setIsLoading(false);
        return;
      }
      const batchData = await batchFetchCoursePrepApi(
        { schoolId: ids[0], season, year: String(year) },
        ['schedule_tasks', 'progress_items', 'student_progress']
      );
      const data = (batchData.schedule_tasks || []) as ScheduleTaskWithMarkers[];
      const progressItems = (batchData.progress_items || []) as CourseProgressItem[];
      const studentProgress = (batchData.student_progress || []) as StudentCourseProgress[];
      setTasks(data);
      setAllProgressItems(progressItems);
      setDeadlineItems(progressItems.filter((i) => i.deadline));

      // 進捗管理サマリーを計算
      if (progressItems.length > 0 && studentProgress.length > 0) {
        // check型の項目について完了率を計算
        const checkItems = progressItems.filter((pi) => pi.column_type === 'check');
        const totalStudentChecks = checkItems.length > 0
          ? studentProgress.filter((sp) => checkItems.some((ci) => ci.id === sp.item_id)).length
          : 0;
        const doneStudentChecks = checkItems.length > 0
          ? studentProgress.filter((sp) => checkItems.some((ci) => ci.id === sp.item_id) && sp.status === 'completed').length
          : 0;

        // 項目ごとのサマリー（主要なものだけ）
        const itemSummaries = checkItems.slice(0, 6).map((ci) => {
          const related = studentProgress.filter((sp) => sp.item_id === ci.id);
          const done = related.filter((sp) => sp.status === 'completed').length;
          return { name: ci.name, total: related.length, done };
        }).filter((s) => s.total > 0);

        setProgressSummary({
          total: totalStudentChecks,
          completed: doneStudentChecks,
          itemSummaries,
        });
      } else {
        setProgressSummary(undefined);
      }

      if (data.length === 0 && isOwnerOrAbove) {
        const tpls = await getTemplates('schedule', season, ids[0]);
        setTemplates(tpls);
        if (tpls.length > 0) {
          setShowTemplateDialog(true);
        }
      }
    } catch (error) {
      console.error('Error fetching schedule:', error);
      setErrorMessage(getUserErrorMessage(error, 'データの取得に失敗しました'));
    } finally {
      setIsLoading(false);
    }
  }, [getSelectedSchoolIds, season, year, isOwnerOrAbove]);

  useEffect(() => {
    if (selectedSchoolId !== null) {
      fetchData();
    }
  }, [fetchData, selectedSchoolId]);

  // 完了トグル
  const handleToggleComplete = useCallback(
    async (taskId: string, completed: boolean) => {
      const ids = getSelectedSchoolIds();
      if (ids.length === 0) return;
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, is_completed: completed } : t))
      );
      try {
        await updateScheduleTask(taskId, { is_completed: completed }, ids[0]);
      } catch (err) {
        console.error('Error:', err);
        fetchData();
      }
    },
    [fetchData, getSelectedSchoolIds]
  );

  // タスク更新（ScheduleBoard用 - 名前/説明/日付/カテゴリ/リンク）
  const handleUpdateTask = useCallback(
    async (
      taskId: string,
      updates: Partial<{
        name: string;
        description: string | null;
        start_date: string | null;
        end_date: string | null;
        major_category: string;
        sort_order: number;
        linked_progress_item_id: string | null;
      }>
    ) => {
      const ids = getSelectedSchoolIds();
      if (ids.length === 0) return;
      // Optimistic update
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, ...updates } : t))
      );
      try {
        await updateScheduleTask(taskId, updates, ids[0]);
        // リンク変更時はサーバーから再取得（進捗率データが変わるため）
        if ('linked_progress_item_id' in updates) {
          fetchData();
        }
      } catch (err) {
        console.error('Error updating task:', err);
        fetchData();
      }
    },
    [fetchData, getSelectedSchoolIds]
  );

  // マーカークリック（ガントチャート用）
  const handleMarkerClick = useCallback(
    (taskId: string, date: string, existing?: ScheduleMarker) => {
      if (!canEdit) return;
      setMarkerInput({ taskId, date, existing });
    },
    [canEdit]
  );

  // マーカー保存
  const handleMarkerSave = useCallback(
    async (taskId: string, date: string, label: string, color?: string) => {
      const ids = getSelectedSchoolIds();
      if (ids.length === 0) return;
      try {
        await upsertScheduleMarker(taskId, date, label, color, ids[0]);
        setTasks((prev) =>
          prev.map((t) => {
            if (t.id !== taskId) return t;
            const existingIdx = t.markers.findIndex((m) => m.marker_date === date);
            const markers = [...t.markers];
            const newMarker = {
              id: `temp-${taskId}-${date}`,
              task_id: taskId,
              marker_date: date,
              label,
              color: color || null,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };
            if (existingIdx >= 0) {
              markers[existingIdx] = newMarker;
            } else {
              markers.push(newMarker);
              markers.sort((a, b) => a.marker_date.localeCompare(b.marker_date));
            }
            return { ...t, markers };
          })
        );
      } catch (err) {
        console.error('Error saving marker:', err);
        fetchData();
      }
    },
    [fetchData, getSelectedSchoolIds]
  );

  // マーカー削除
  const handleMarkerDelete = useCallback(
    async (taskId: string, date: string) => {
      const ids = getSelectedSchoolIds();
      if (ids.length === 0) return;
      try {
        await deleteScheduleMarker(taskId, date, ids[0]);
        setTasks((prev) =>
          prev.map((t) => {
            if (t.id !== taskId) return t;
            return { ...t, markers: t.markers.filter((m) => m.marker_date !== date) };
          })
        );
      } catch (err) {
        console.error('Error deleting marker:', err);
        fetchData();
      }
    },
    [fetchData, getSelectedSchoolIds]
  );

  // タスク並べ替え
  const handleReorderTasks = useCallback(
    async (reorderedIds: { id: string; sort_order: number }[]) => {
      const ids = getSelectedSchoolIds();
      if (ids.length === 0) return;

      // Optimistic update
      setTasks((prev) => {
        const updated = prev.map((t) => {
          const match = reorderedIds.find((r) => r.id === t.id);
          return match ? { ...t, sort_order: match.sort_order } : t;
        });
        return updated.sort((a, b) => a.sort_order - b.sort_order);
      });

      try {
        await Promise.all(
          reorderedIds.map((r) =>
            updateScheduleTask(r.id, { sort_order: r.sort_order }, ids[0])
          )
        );
      } catch (err) {
        console.error('Error reordering tasks:', err);
        fetchData();
      }
    },
    [fetchData, getSelectedSchoolIds]
  );

  // タスク追加
  const handleAddTask = useCallback(
    async (majorCategory: string, name: string, description?: string) => {
      const ids = getSelectedSchoolIds();
      if (ids.length === 0) return;
      try {
        await createScheduleTask(ids[0], season, year, {
          major_category: majorCategory,
          name,
          description,
        });
        await fetchData();
      } catch (err) {
        console.error('Error adding task:', err);
        setErrorMessage(getUserErrorMessage(err, 'タスクの追加に失敗しました'));
      }
    },
    [getSelectedSchoolIds, season, year, fetchData]
  );

  // タスク削除
  const handleDeleteTask = useCallback(
    async (taskId: string) => {
      const ids = getSelectedSchoolIds();
      if (ids.length === 0) return;
      try {
        await deleteScheduleTask(taskId, ids[0]);
        await fetchData();
      } catch (err) {
        console.error('Error deleting task:', err);
        setErrorMessage(getUserErrorMessage(err, 'タスクの削除に失敗しました'));
      }
    },
    [fetchData, getSelectedSchoolIds]
  );

  // テンプレート適用
  const handleApplyTemplate = useCallback(
    async (templateId: string) => {
      const ids = getSelectedSchoolIds();
      if (ids.length === 0) return;
      setTemplateLoading(true);
      try {
        await initializeScheduleFromTemplate(ids[0], season, year, templateId);
        setShowTemplateDialog(false);
        await fetchData();
      } catch (err) {
        console.error('Error applying template:', err);
        setErrorMessage(getUserErrorMessage(err, 'テンプレートの適用に失敗しました'));
      } finally {
        setTemplateLoading(false);
      }
    },
    [getSelectedSchoolIds, season, year, fetchData]
  );

  const handleOpenTemplateDialog = useCallback(async () => {
    const ids = getSelectedSchoolIds();
    if (ids.length === 0) return;
    const tpls = await getTemplates('schedule', season, ids[0]);
    setTemplates(tpls);
    setShowTemplateDialog(true);
  }, [season, getSelectedSchoolIds]);

  // テンプレートとして保存
  const handleSaveAsTemplate = useCallback(async () => {
    if (!saveTemplateName.trim()) return;
    const ids = getSelectedSchoolIds();
    if (ids.length === 0) return;
    setSaveTemplateLoading(true);
    try {
      await saveCurrentAsTemplate(ids[0], season, year, 'schedule', saveTemplateName.trim());
      setShowSaveTemplateDialog(false);
      setSaveTemplateName('');
      alert('テンプレートとして保存しました');
    } catch (err) {
      console.error('Error saving template:', err);
      setErrorMessage(getUserErrorMessage(err, 'テンプレートの保存に失敗しました'));
    } finally {
      setSaveTemplateLoading(false);
    }
  }, [saveTemplateName, getSelectedSchoolIds, season, year]);

  // テンプレート削除
  const handleDeleteTemplate = useCallback(async (templateId: string) => {
    const ids = getSelectedSchoolIds();
    if (ids.length === 0) return;
    try {
      await deleteTemplate(templateId, ids[0]);
      // テンプレート一覧を再取得
      const tpls = await getTemplates('schedule', season, ids[0]);
      setTemplates(tpls);
    } catch (err) {
      console.error('Error deleting template:', err);
      setErrorMessage(getUserErrorMessage(err, 'テンプレートの削除に失敗しました'));
    }
  }, [getSelectedSchoolIds, season]);

  // PDF出力
  const handleExportPDF = useCallback(async () => {
    setIsExporting(true);
    try {
      const seasonLabel = season === 'spring' ? '春期' : season === 'summer' ? '夏期' : '冬期';
      const filename = `${seasonLabel}${year}_準備スケジュール.pdf`;
      await exportProgressToPDF('schedule-content', filename, {
        orientation: 'landscape',
        expandScrollable: true,
        pageSize: 'a3',
      });
    } catch (err) {
      console.error('PDF export error:', err);
      setErrorMessage('PDF出力に失敗しました');
    } finally {
      setIsExporting(false);
    }
  }, [season, year]);

  // 全教室に展開
  const handleDeployToAllSchools = useCallback(async () => {
    if (tasks.length === 0) {
      setErrorMessage('展開するタスクがありません');
      return;
    }
    const currentIds = getSelectedSchoolIds();
    if (currentIds.length === 0) return;
    const currentSchoolId = currentIds[0];

    // 現在の教室以外の管理教室を取得
    const targetSchoolIds = managedSchoolIds.filter((id) => id !== currentSchoolId);
    if (targetSchoolIds.length === 0) {
      setErrorMessage('展開先の教室がありません');
      return;
    }

    if (
      !confirm(
        `現在のスケジュールを他の${targetSchoolIds.length}教室に展開します。\n既存のタスクがある教室にはスキップされます。\nよろしいですか？`
      )
    ) {
      return;
    }

    setDeployLoading(true);
    setErrorMessage('');
    let successCount = 0;
    let skipCount = 0;

    try {
      for (const targetId of targetSchoolIds) {
        // まずその教室に既存タスクがあるか確認
        const existing = await getScheduleTasks(targetId, season, year);
        if (existing.length > 0) {
          skipCount++;
          continue;
        }

        // タスクを1つずつ作成
        for (const task of tasks) {
          await createScheduleTask(targetId, season, year, {
            major_category: task.major_category,
            name: task.name,
            description: task.description || undefined,
            start_date: task.start_date,
            end_date: task.end_date,
          });
        }
        successCount++;
      }

      const msg = `${successCount}教室に展開しました。` + (skipCount > 0 ? ` ${skipCount}教室はスキップ（既存タスクあり）` : '');
      alert(msg);
    } catch (err) {
      console.error('Error deploying to all schools:', err);
      setErrorMessage(getUserErrorMessage(err, '展開中にエラーが発生しました'));
    } finally {
      setDeployLoading(false);
    }
  }, [tasks, getSelectedSchoolIds, managedSchoolIds, season, year]);

  if (permissionLoading) {
    return (
      <AdminLayout>
        <Loading className="min-h-[60vh]" />
      </AdminLayout>
    );
  }

  if (!hasPermission) {
    return (
      <AdminLayout>
        <AccessDenied />
      </AdminLayout>
    );
  }

  return (
    <AdminLayout headerTitle="講習 準備スケジュール" fullWidth>
      <div>
        {/* ヘッダー */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div className="flex flex-wrap items-center gap-4">
            <SeasonYearSelector
              season={season}
              year={year}
              onSeasonChange={setSeason}
              onYearChange={setYear}
            />
            {viewMode === 'gantt' && (
              <ScheduleDateRange
                startDate={dateRange.start}
                endDate={dateRange.end}
                onChangeRange={(start, end) => setDateRange({ start, end })}
                season={season}
                year={year}
              />
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* ビュートグル */}
            <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
              <button
                onClick={() => setViewMode('list')}
                className={`px-3 py-1.5 text-xs rounded-md transition-colors duration-150 ${
                  viewMode === 'list'
                    ? 'bg-white text-ink font-medium shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                リスト
              </button>
              <button
                onClick={() => setViewMode('gantt')}
                className={`px-3 py-1.5 text-xs rounded-md transition-colors duration-150 ${
                  viewMode === 'gantt'
                    ? 'bg-white text-ink font-medium shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                ガントチャート
              </button>
            </div>

            {tasks.length > 0 && (
              <button
                onClick={handleExportPDF}
                disabled={isExporting}
                className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600 disabled:opacity-50 flex items-center gap-1 transition-colors duration-150"
              >
                {isExporting ? (
                  <>
                    <span className="w-3 h-3 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                    出力中...
                  </>
                ) : (
                  'PDF出力'
                )}
              </button>
            )}

            {isOwnerOrAbove && (
              <>
                <button
                  onClick={handleOpenTemplateDialog}
                  className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600 transition-colors duration-150"
                >
                  テンプレート適用
                </button>
                {tasks.length > 0 && (
                  <button
                    onClick={() => {
                      const seasonLabel = season === 'spring' ? '春期' : season === 'summer' ? '夏期' : '冬期';
                      setSaveTemplateName(`${seasonLabel}${year} 準備スケジュールテンプレート`);
                      setShowSaveTemplateDialog(true);
                    }}
                    className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600 transition-colors duration-150"
                  >
                    テンプレート保存
                  </button>
                )}
                {managedSchoolIds.length > 1 && (
                  <button
                    onClick={handleDeployToAllSchools}
                    disabled={deployLoading || tasks.length === 0}
                    className="px-3 py-1.5 text-xs bg-ink text-white rounded-lg hover:bg-ink/80 disabled:opacity-50 flex items-center gap-1 transition-colors duration-150"
                  >
                    {deployLoading ? (
                      <>
                        <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        展開中...
                      </>
                    ) : (
                      '全教室に展開'
                    )}
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {errorMessage && (
          <div className="mb-4 bg-danger/20 text-danger px-4 py-2 rounded border border-danger">
            {errorMessage}
          </div>
        )}

        {/* メインコンテンツ */}
        <div id="schedule-content">
        {isLoading ? (
          <div className="bg-white rounded-xl border border-gray-200 p-8">
            <InlineLoading />
          </div>
        ) : viewMode === 'list' ? (
          /* リスト表示 */
          <ScheduleBoard
            tasks={tasks}
            canEdit={canEdit}
            season={season}
            year={year}
            onToggleComplete={handleToggleComplete}
            onUpdateTask={handleUpdateTask}
            onReorderTasks={handleReorderTasks}
            onDeleteTask={handleDeleteTask}
            onAddTask={handleAddTask}
          />
        ) : (
          /* ガントチャート表示 */
          tasks.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
              <p className="text-text-body mb-4">スケジュールがありません。</p>
              {isOwnerOrAbove && (
                <button
                  onClick={handleOpenTemplateDialog}
                  className="px-4 py-2 text-sm bg-ink text-white rounded-lg hover:bg-ink/80 transition-colors duration-150"
                >
                  テンプレートから作成
                </button>
              )}
            </div>
          ) : (
            <ScheduleGanttChart
              tasks={tasks}
              deadlineItems={deadlineItems}
              progressItems={allProgressItems}
              progressSummary={progressSummary}
              startDate={dateRange.start}
              endDate={dateRange.end}
              season={season}
              year={year}
              canEdit={canEdit}
              onToggleComplete={handleToggleComplete}
              onMarkerClick={handleMarkerClick}
              onUpdateTask={handleUpdateTask}
              onDeleteTask={handleDeleteTask}
            />
          )
        )}
        </div>
      </div>

      {/* マーカー入力ポップオーバー（ガントチャート用） */}
      {markerInput && (
        <ScheduleMarkerInput
          taskId={markerInput.taskId}
          date={markerInput.date}
          existing={markerInput.existing}
          onSave={handleMarkerSave}
          onDelete={handleMarkerDelete}
          onClose={() => setMarkerInput(null)}
        />
      )}

      {/* テンプレート適用ダイアログ */}
      {showTemplateDialog && (
        <TemplateApplyDialog
          templates={templates}
          onApply={handleApplyTemplate}
          onDelete={handleDeleteTemplate}
          onClose={() => setShowTemplateDialog(false)}
          isLoading={templateLoading}
        />
      )}

      {/* テンプレート保存ダイアログ */}
      {showSaveTemplateDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl border border-gray-200 shadow-2xl max-w-md w-full mx-4">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-bold text-ink">テンプレートとして保存</h3>
              <p className="text-sm text-gray-500 mt-1">
                現在のスケジュール（{tasks.length}タスク、日付含む）をテンプレートとして保存します
              </p>
            </div>
            <div className="px-6 py-4">
              <label className="block text-sm text-gray-600 mb-1">テンプレート名</label>
              <input
                type="text"
                value={saveTemplateName}
                onChange={(e) => setSaveTemplateName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSaveAsTemplate(); }}
                placeholder="テンプレート名を入力"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                autoFocus
              />
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-2">
              <button
                onClick={() => { setShowSaveTemplateDialog(false); setSaveTemplateName(''); }}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 rounded-lg transition-colors duration-150"
                disabled={saveTemplateLoading}
              >
                キャンセル
              </button>
              <button
                onClick={handleSaveAsTemplate}
                disabled={!saveTemplateName.trim() || saveTemplateLoading}
                className="px-4 py-2 text-sm bg-ink text-white rounded-lg hover:bg-ink/80 disabled:opacity-50 transition-colors duration-150"
              >
                {saveTemplateLoading ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
