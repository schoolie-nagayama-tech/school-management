'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { AdminLayout } from '@/components/layouts';
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
import { getCourseProgressItems } from '@/lib/api/courseProgress';
import { getTemplates, initializeScheduleFromTemplate } from '@/lib/api/courseTemplates';
import type { ScheduleTaskWithMarkers, ScheduleMarker, CourseTemplate, CourseProgressItem, SeasonType } from '@/types/database';
import { useRequirePermission, useCanEdit } from '@/hooks/usePermissions';
import AccessDenied from '@/components/AccessDenied';
import { useAuth } from '@/contexts/AuthContext';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';

function getCurrentSeason(): SeasonType {
  const month = new Date().getMonth() + 1;
  if (month >= 2 && month <= 5) return 'spring';
  if (month >= 6 && month <= 9) return 'summer';
  return 'winter';
}

type ViewMode = 'list' | 'gantt';

export default function CourseSchedulePage() {
  const { hasPermission, isLoading: permissionLoading } = useRequirePermission(
    (p) => p.canAccessCourses
  );
  const canEdit = useCanEdit('canEditApplications');
  const { getSelectedSchoolIds, selectedSchoolId, profile, schoolIds, demoSchoolIds } = useAuth();
  const isManagerOrAbove =
    profile?.role === 'manager' || profile?.role === 'owner' || profile?.role === 'admin';

  // 期・年
  const [season, setSeason] = useState<SeasonType>(getCurrentSeason());
  const [year, setYear] = useState(new Date().getFullYear());

  // ビューモード
  const [viewMode, setViewMode] = useState<ViewMode>('list');

  // 表示期間（ガントチャート用）
  const [dateRange, setDateRange] = useState<{ start: Date; end: Date }>(() => {
    const now = new Date();
    return {
      start: new Date(now.getFullYear(), now.getMonth(), 1),
      end: new Date(now.getFullYear(), now.getMonth() + 2, 0),
    };
  });

  // データ
  const [tasks, setTasks] = useState<ScheduleTaskWithMarkers[]>([]);
  const [deadlineItems, setDeadlineItems] = useState<CourseProgressItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  // テンプレート
  const [templates, setTemplates] = useState<CourseTemplate[]>([]);
  const [showTemplateDialog, setShowTemplateDialog] = useState(false);
  const [templateLoading, setTemplateLoading] = useState(false);

  // マーカー入力（ガントチャート用）
  const [markerInput, setMarkerInput] = useState<{
    taskId: string;
    date: string;
    existing?: ScheduleMarker;
  } | null>(null);

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
      const [data, progressItems] = await Promise.all([
        getScheduleTasks(ids[0], season, year),
        getCourseProgressItems(ids[0], season, year, false),
      ]);
      setTasks(data);
      setDeadlineItems(progressItems.filter((i) => i.deadline));

      if (data.length === 0 && isManagerOrAbove) {
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
  }, [getSelectedSchoolIds, season, year, isManagerOrAbove]);

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

  // タスク更新（ScheduleBoard用 - 名前/説明/日付/カテゴリ）
  const handleUpdateTask = useCallback(
    async (
      taskId: string,
      updates: Partial<{
        name: string;
        description: string | null;
        start_date: string | null;
        end_date: string | null;
        major_category: string;
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
        `現在の工程表を他の${targetSchoolIds.length}教室に展開します。\n既存のタスクがある教室にはスキップされます。\nよろしいですか？`
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
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <div className="w-12 h-12 border-4 border-[#1e3a5f] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-[#4b5563]">読み込み中...</p>
          </div>
        </div>
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
    <AdminLayout headerTitle="講習 工程表">
      <div className="max-w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* ヘッダー */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
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
                className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                  viewMode === 'list'
                    ? 'bg-white text-[#1e3a5f] font-medium shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                リスト
              </button>
              <button
                onClick={() => setViewMode('gantt')}
                className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                  viewMode === 'gantt'
                    ? 'bg-white text-[#1e3a5f] font-medium shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                ガントチャート
              </button>
            </div>

            {isManagerOrAbove && (
              <>
                <button
                  onClick={handleOpenTemplateDialog}
                  className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600"
                >
                  テンプレート適用
                </button>
                {managedSchoolIds.length > 1 && (
                  <button
                    onClick={handleDeployToAllSchools}
                    disabled={deployLoading || tasks.length === 0}
                    className="px-3 py-1.5 text-xs bg-[#1e3a5f] text-white rounded-lg hover:bg-[#2c5282] disabled:opacity-50 flex items-center gap-1"
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
          <div className="mb-4 bg-[#ef4444]/20 text-[#ef4444] px-4 py-2 rounded border border-[#ef4444]">
            {errorMessage}
          </div>
        )}

        {/* メインコンテンツ */}
        {isLoading ? (
          <div className="bg-white rounded-xl border border-gray-200 p-8">
            <div className="flex items-center justify-center">
              <div className="w-8 h-8 border-4 border-[#1e3a5f] border-t-transparent rounded-full animate-spin" />
              <span className="ml-3 text-[#4b5563]">読み込み中...</span>
            </div>
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
            onDeleteTask={handleDeleteTask}
            onAddTask={handleAddTask}
          />
        ) : (
          /* ガントチャート表示 */
          tasks.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
              <p className="text-[#4b5563] mb-4">工程表タスクがありません。</p>
              {isManagerOrAbove && (
                <button
                  onClick={handleOpenTemplateDialog}
                  className="px-4 py-2 text-sm bg-[#1e3a5f] text-white rounded-lg hover:bg-[#2c5282]"
                >
                  テンプレートから作成
                </button>
              )}
            </div>
          ) : (
            <ScheduleGanttChart
              tasks={tasks}
              deadlineItems={deadlineItems}
              startDate={dateRange.start}
              endDate={dateRange.end}
              canEdit={canEdit}
              onToggleComplete={handleToggleComplete}
              onMarkerClick={handleMarkerClick}
              onUpdateTask={handleUpdateTask}
              onDeleteTask={handleDeleteTask}
            />
          )
        )}
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
          onClose={() => setShowTemplateDialog(false)}
          isLoading={templateLoading}
        />
      )}
    </AdminLayout>
  );
}
