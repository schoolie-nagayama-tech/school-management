'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { AdminLayout } from '@/components/layouts';
import { ScheduleGanttChart, ScheduleTaskEditor, ScheduleMarkerInput, ScheduleDateRange } from '@/components/course-schedule';
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
import { getTemplates, initializeScheduleFromTemplate } from '@/lib/api/courseTemplates';
import type { ScheduleTaskWithMarkers, ScheduleMarker, CourseTemplate, SeasonType } from '@/types/database';
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

export default function CourseSchedulePage() {
  const { hasPermission, isLoading: permissionLoading } = useRequirePermission(
    (p) => p.canAccessCourses
  );
  const canEdit = useCanEdit('canEditApplications');
  const { getSelectedSchoolIds, selectedSchoolId, profile } = useAuth();
  const isManagerOrAbove =
    profile?.role === 'manager' || profile?.role === 'owner' || profile?.role === 'admin';

  // 期・年
  const [season, setSeason] = useState<SeasonType>(getCurrentSeason());
  const [year, setYear] = useState(new Date().getFullYear());

  // 表示期間
  const [dateRange, setDateRange] = useState<{ start: Date; end: Date }>(() => {
    const now = new Date();
    return {
      start: new Date(now.getFullYear(), now.getMonth(), 1),
      end: new Date(now.getFullYear(), now.getMonth() + 2, 0),
    };
  });

  // データ
  const [tasks, setTasks] = useState<ScheduleTaskWithMarkers[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  // テンプレート
  const [templates, setTemplates] = useState<CourseTemplate[]>([]);
  const [showTemplateDialog, setShowTemplateDialog] = useState(false);
  const [templateLoading, setTemplateLoading] = useState(false);

  // マーカー入力
  const [markerInput, setMarkerInput] = useState<{
    taskId: string;
    date: string;
    existing?: ScheduleMarker;
  } | null>(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage('');
    try {
      const schoolIds = getSelectedSchoolIds();
      if (schoolIds.length === 0) {
        setErrorMessage('教室が選択されていません');
        setIsLoading(false);
        return;
      }
      const data = await getScheduleTasks(schoolIds[0], season, year);
      setTasks(data);

      if (data.length === 0 && isManagerOrAbove) {
        const tpls = await getTemplates('schedule', season);
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
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, is_completed: completed } : t))
      );
      try {
        await updateScheduleTask(taskId, { is_completed: completed });
      } catch (err) {
        console.error('Error:', err);
        fetchData();
      }
    },
    [fetchData]
  );

  // マーカークリック
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
      try {
        const marker = await upsertScheduleMarker(taskId, date, label, color);
        setTasks((prev) =>
          prev.map((t) => {
            if (t.id !== taskId) return t;
            const existing = t.markers.findIndex((m) => m.marker_date === date);
            const markers = [...t.markers];
            if (existing >= 0) {
              markers[existing] = marker;
            } else {
              markers.push(marker);
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
    [fetchData]
  );

  // マーカー削除
  const handleMarkerDelete = useCallback(
    async (taskId: string, date: string) => {
      try {
        await deleteScheduleMarker(taskId, date);
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
    [fetchData]
  );

  // タスク追加
  const handleAddTask = useCallback(
    async (majorCategory: string, name: string, description?: string) => {
      const schoolIds = getSelectedSchoolIds();
      if (schoolIds.length === 0) return;
      try {
        await createScheduleTask(schoolIds[0], season, year, {
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
      try {
        await deleteScheduleTask(taskId);
        await fetchData();
      } catch (err) {
        console.error('Error deleting task:', err);
        setErrorMessage(getUserErrorMessage(err, 'タスクの削除に失敗しました'));
      }
    },
    [fetchData]
  );

  // タスク日付更新
  const handleUpdateDates = useCallback(
    async (taskId: string, startDate: string | null, endDate: string | null) => {
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, start_date: startDate, end_date: endDate } : t))
      );
      try {
        await updateScheduleTask(taskId, { start_date: startDate, end_date: endDate });
      } catch (err) {
        console.error('Error updating dates:', err);
        fetchData();
      }
    },
    [fetchData]
  );

  // テンプレート適用
  const handleApplyTemplate = useCallback(
    async (templateId: string) => {
      const schoolIds = getSelectedSchoolIds();
      if (schoolIds.length === 0) return;
      setTemplateLoading(true);
      try {
        await initializeScheduleFromTemplate(schoolIds[0], season, year, templateId);
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
    const tpls = await getTemplates('schedule', season);
    setTemplates(tpls);
    setShowTemplateDialog(true);
  }, [season]);

  // 完了率
  const completionRate = useMemo(() => {
    if (tasks.length === 0) return 0;
    return tasks.filter((t) => t.is_completed).length / tasks.length;
  }, [tasks]);

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
            <ScheduleDateRange
              startDate={dateRange.start}
              endDate={dateRange.end}
              onChangeRange={(start, end) => setDateRange({ start, end })}
            />
          </div>
          <div className="flex items-center gap-2">
            {isManagerOrAbove && (
              <button
                onClick={handleOpenTemplateDialog}
                className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600"
              >
                テンプレート適用
              </button>
            )}
          </div>
        </div>

        {errorMessage && (
          <div className="mb-4 bg-[#ef4444]/20 text-[#ef4444] px-4 py-2 rounded border border-[#ef4444]">
            {errorMessage}
          </div>
        )}

        {/* 進捗サマリ */}
        {!isLoading && tasks.length > 0 && (
          <div className="mb-4 bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center gap-4">
              <div className="text-xs text-gray-500">
                全体進捗: {tasks.filter((t) => t.is_completed).length}/{tasks.length}
              </div>
              <div className="flex-1 bg-gray-100 rounded-full h-2 max-w-xs">
                <div
                  className="h-2 rounded-full transition-all"
                  style={{
                    width: `${Math.round(completionRate * 100)}%`,
                    backgroundColor:
                      completionRate >= 0.8 ? '#10b981' : completionRate >= 0.5 ? '#f59e0b' : '#ef4444',
                  }}
                />
              </div>
              <span className="text-xs font-bold text-[#1e3a5f]">
                {Math.round(completionRate * 100)}%
              </span>
            </div>
          </div>
        )}

        {/* タスク管理（教室長以上） */}
        {isManagerOrAbove && canEdit && !isLoading && (
          <ScheduleTaskEditor
            tasks={tasks}
            onAdd={handleAddTask}
            onDelete={handleDeleteTask}
            onToggleComplete={handleToggleComplete}
            onUpdateDates={handleUpdateDates}
          />
        )}

        {/* ガントチャート */}
        {isLoading ? (
          <div className="bg-white rounded-xl border border-gray-200 p-8">
            <div className="flex items-center justify-center">
              <div className="w-8 h-8 border-4 border-[#1e3a5f] border-t-transparent rounded-full animate-spin" />
              <span className="ml-3 text-[#4b5563]">読み込み中...</span>
            </div>
          </div>
        ) : tasks.length === 0 ? (
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
            startDate={dateRange.start}
            endDate={dateRange.end}
            canEdit={canEdit}
            onToggleComplete={handleToggleComplete}
            onMarkerClick={handleMarkerClick}
          />
        )}
      </div>

      {/* マーカー入力ポップオーバー */}
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
