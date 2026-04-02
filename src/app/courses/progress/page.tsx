'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { AdminLayout } from '@/components/layouts';
import { CourseProgressDashboard, CourseProgressTable } from '@/components/course-progress';
import { SeasonYearSelector } from '@/components/course-shared/SeasonYearSelector';
import { TemplateApplyDialog } from '@/components/course-shared/TemplateApplyDialog';
import { getStudents } from '@/lib/api/students';
import { updateScheduleTask } from '@/lib/api/courseSchedule';
import { supabase } from '@/lib/supabase';
import { batchFetchCoursePrepApi } from '@/lib/api/coursePrepApi';
import {
  getCoursePrepPeriod,
  upsertCoursePrepPeriod,
  updateStudentProgress,
  updateStudentProgressNumber,
  updateStudentProgressDate,
  createCourseProgressItem,
  updateCourseProgressItem,
  deleteCourseProgressItem,
  hideCourseProgressItem,
  unhideCourseProgressItem,
  getAutoValues,
  type AutoValues,
} from '@/lib/api/courseProgress';
import {
  getTemplates,
  initializeProgressFromTemplate,
  saveCurrentAsTemplate,
  deleteTemplate,
} from '@/lib/api/courseTemplates';
import type {
  Student,
  CourseProgressItem,
  StudentCourseProgress,
  CoursePrepPeriod,
  CourseTemplate,
  ScheduleTaskWithMarkers,
  ApplicationStatus,
  SeasonType,
  ApplicationColumnType,
} from '@/types/database';
import { PROGRESS_COLUMN_GROUPS } from '@/types/database';
import { useRequirePermission, useCanEdit } from '@/hooks/usePermissions';
import AccessDenied from '@/components/AccessDenied';
import { useAuth } from '@/contexts/AuthContext';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';

// localStorage共通キー（工程表と共有）
const STORAGE_KEY = 'course_prep_season_year';

function getDefaultSeason(): SeasonType {
  const month = new Date().getMonth() + 1;
  if (month >= 2 && month <= 5) return 'spring';
  if (month >= 6 && month <= 9) return 'summer';
  return 'winter';
}

function loadSavedSeasonYear(): { season: SeasonType; year: number } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.season && parsed.year) return parsed;
    }
  } catch { /* ignore */ }
  return { season: getDefaultSeason(), year: new Date().getFullYear() };
}

function saveSavedSeasonYear(season: SeasonType, year: number) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ season, year })); } catch { /* ignore */ }
}

export default function CourseProgressPage() {
  const { hasPermission, isLoading: permissionLoading } = useRequirePermission(
    (p) => p.canAccessCourses
  );
  const canEdit = useCanEdit('canEditApplications');
  const { getSelectedSchoolIds, selectedSchoolId, profile } = useAuth();
  const isOwnerOrAbove =
    profile?.role === 'owner' ||
    profile?.role === 'admin';

  // 期・年選択（localStorageから復元、工程表と共有）
  const [season, setSeasonRaw] = useState<SeasonType>(() => loadSavedSeasonYear().season);
  const [year, setYearRaw] = useState(() => loadSavedSeasonYear().year);

  const setSeason = useCallback((s: SeasonType) => {
    setSeasonRaw(s);
    saveSavedSeasonYear(s, year);
  }, [year]);

  const setYear = useCallback((y: number) => {
    setYearRaw(y);
    saveSavedSeasonYear(season, y);
  }, [season]);

  // データ
  const [students, setStudents] = useState<Student[]>([]);
  const [items, setItems] = useState<CourseProgressItem[]>([]);
  const [progressData, setProgressData] = useState<StudentCourseProgress[]>([]);
  const [period, setPeriod] = useState<CoursePrepPeriod | null>(null);
  const [autoValuesData, setAutoValuesData] = useState<AutoValues>({});
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  // テンプレート
  const [templates, setTemplates] = useState<CourseTemplate[]>([]);
  const [showTemplateDialog, setShowTemplateDialog] = useState(false);
  const [templateLoading, setTemplateLoading] = useState(false);

  // スケジュールタスク（リンク設定用）
  const [scheduleTasks, setScheduleTasks] = useState<ScheduleTaskWithMarkers[]>([]);

  // テンプレート保存
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveTemplateName, setSaveTemplateName] = useState('');
  const [saving, setSaving] = useState(false);

  // フィルター
  const [searchQuery, setSearchQuery] = useState('');
  const [gradeFilter, setGradeFilter] = useState<number | null>(null);
  const [showHidden, setShowHidden] = useState(false);

  // 設定パネル（フィルター + 項目管理 をアコーディオン統合）
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'filter' | 'items'>('filter');
  const [newItemName, setNewItemName] = useState('');
  const [newItemType, setNewItemType] = useState<ApplicationColumnType>('check');
  const [newItemGroup, setNewItemGroup] = useState<string>('');
  const [newItemAutoSource, setNewItemAutoSource] = useState<string>('');

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
      const schoolId = schoolIds[0];

      // バッチAPI: 5つのデータを1リクエストで取得 + 生徒データ
      const [studentsData, batchData] = await Promise.all([
        getStudents(undefined, schoolIds),
        batchFetchCoursePrepApi(
          { schoolId, season, year: String(year), includeHidden: String(showHidden) },
          ['progress_items', 'student_progress', 'period', 'auto_values', 'schedule_tasks']
        ),
      ]);

      const itemsData = ((batchData.progress_items as Record<string, unknown>[]) || []).map((item) => ({
        ...item,
        column_type: (item.column_type as string) || 'check',
        manager_only: item.manager_only === true,
        is_hidden: item.is_hidden === true,
        deadline: (item.deadline as string) || null,
        auto_source: (item.auto_source as string) || null,
      })) as CourseProgressItem[];

      const progressResult = ((batchData.student_progress as Record<string, unknown>[]) || []).map((d) => ({
        ...d,
        number_value: d.number_value ?? null,
        date_value: d.date_value ?? null,
      })) as StudentCourseProgress[];

      setStudents(studentsData.filter((s) => s.status !== 'withdrawn'));
      setItems(itemsData);
      setProgressData(progressResult);
      setPeriod((batchData.period as CoursePrepPeriod) || null);
      setAutoValuesData((batchData.auto_values || {}) as AutoValues);
      setScheduleTasks((batchData.schedule_tasks || []) as ScheduleTaskWithMarkers[]);

      // 項目が0件なら初回テンプレート適用を提案
      if (itemsData.length === 0 && isOwnerOrAbove) {
        const tpls = await getTemplates('progress', season, schoolId);
        setTemplates(tpls);
        if (tpls.length > 0) {
          setShowTemplateDialog(true);
        }
      }
    } catch (error) {
      console.error('Error fetching data:', error);
      setErrorMessage(getUserErrorMessage(error, 'データの取得に失敗しました'));
    } finally {
      setIsLoading(false);
    }
  }, [getSelectedSchoolIds, season, year, showHidden, isOwnerOrAbove]);

  useEffect(() => {
    if (selectedSchoolId !== null) {
      fetchData();
    }
  }, [fetchData, selectedSchoolId]);

  // 表示用項目（講師はmanager_only除外 / 非表示除外）
  const displayItems = useMemo(() => {
    let result = items;
    if (profile?.role === 'teacher') {
      result = result.filter((i) => !i.manager_only);
    }
    if (!showHidden) {
      result = result.filter((i) => !i.is_hidden);
    }
    return result;
  }, [items, profile?.role, showHidden]);

  // フィルター適用
  const filteredStudents = useMemo(() => {
    let result = students;
    if (gradeFilter !== null) {
      result = result.filter((s) => s.grade === gradeFilter);
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (s) =>
          s.last_name.toLowerCase().includes(q) ||
          s.first_name.toLowerCase().includes(q) ||
          s.last_name_kana.toLowerCase().includes(q) ||
          s.first_name_kana.toLowerCase().includes(q)
      );
    }
    return result;
  }, [students, gradeFilter, searchQuery]);

  // ステータス変更
  const handleStatusChange = useCallback(
    async (studentId: string, itemId: string, status: ApplicationStatus | null) => {
      // ローカル更新
      setProgressData((prev) => {
        if (status === null) {
          return prev.filter((d) => !(d.student_id === studentId && d.item_id === itemId));
        }
        const existing = prev.find((d) => d.student_id === studentId && d.item_id === itemId);
        if (existing) {
          return prev.map((d) => (d.id === existing.id ? { ...d, status } : d));
        }
        const schoolId = students.find((s) => s.id === studentId)?.school_id || '';
        return [
          ...prev,
          {
            id: `temp-${studentId}-${itemId}`,
            school_id: schoolId,
            student_id: studentId,
            item_id: itemId,
            status,
            number_value: null,
            date_value: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ];
      });
      try {
        const schoolId = students.find((s) => s.id === studentId)?.school_id;
        await updateStudentProgress(studentId, itemId, status, schoolId);
      } catch (err) {
        console.error('Error updating status:', err);
        fetchData();
      }
    },
    [students, fetchData]
  );

  // 数値変更
  const handleNumberChange = useCallback(
    async (studentId: string, itemId: string, value: number | null) => {
      setProgressData((prev) => {
        if (value === null) {
          return prev.filter((d) => !(d.student_id === studentId && d.item_id === itemId));
        }
        const existing = prev.find((d) => d.student_id === studentId && d.item_id === itemId);
        if (existing) {
          return prev.map((d) => (d.id === existing.id ? { ...d, number_value: value } : d));
        }
        const schoolId = students.find((s) => s.id === studentId)?.school_id || '';
        return [
          ...prev,
          {
            id: `temp-${studentId}-${itemId}`,
            school_id: schoolId,
            student_id: studentId,
            item_id: itemId,
            status: null,
            number_value: value,
            date_value: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ];
      });
      try {
        const schoolId = students.find((s) => s.id === studentId)?.school_id;
        await updateStudentProgressNumber(studentId, itemId, value, schoolId);
      } catch (err) {
        console.error('Error updating number:', err);
        fetchData();
      }
    },
    [students, fetchData]
  );

  // 日付変更
  const handleDateChange = useCallback(
    async (studentId: string, itemId: string, value: string | null) => {
      setProgressData((prev) => {
        if (value === null) {
          return prev.filter((d) => !(d.student_id === studentId && d.item_id === itemId));
        }
        const existing = prev.find((d) => d.student_id === studentId && d.item_id === itemId);
        if (existing) {
          return prev.map((d) => (d.id === existing.id ? { ...d, date_value: value } : d));
        }
        const schoolId = students.find((s) => s.id === studentId)?.school_id || '';
        return [
          ...prev,
          {
            id: `temp-${studentId}-${itemId}`,
            school_id: schoolId,
            student_id: studentId,
            item_id: itemId,
            status: null,
            number_value: null,
            date_value: value,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ];
      });
      try {
        const schoolId = students.find((s) => s.id === studentId)?.school_id;
        await updateStudentProgressDate(studentId, itemId, value, schoolId);
      } catch (err) {
        console.error('Error updating date:', err);
        fetchData();
      }
    },
    [students, fetchData]
  );

  // 予算コマ変更
  const handleBudgetKomaChange = useCallback(
    async (value: number) => {
      const schoolIds = getSelectedSchoolIds();
      if (schoolIds.length === 0) return;
      try {
        await upsertCoursePrepPeriod(schoolIds[0], season, year, {
          budget_koma: value,
        });
        const [updatedPeriod, autoVals] = await Promise.all([
          getCoursePrepPeriod(schoolIds[0], season, year),
          getAutoValues(schoolIds[0], season, year),
        ]);
        setPeriod(updatedPeriod);
        setAutoValuesData(autoVals);
      } catch (err) {
        console.error('Error updating budget:', err);
      }
    },
    [getSelectedSchoolIds, season, year]
  );

  // 講習期間日付変更
  const handlePeriodDateChange = useCallback(
    async (updates: Partial<Pick<CoursePrepPeriod, 'schedule_start_date' | 'schedule_end_date'>>) => {
      const schoolIds = getSelectedSchoolIds();
      if (schoolIds.length === 0) return;
      try {
        await upsertCoursePrepPeriod(schoolIds[0], season, year, updates);
        const [updatedPeriod, autoVals] = await Promise.all([
          getCoursePrepPeriod(schoolIds[0], season, year),
          getAutoValues(schoolIds[0], season, year),
        ]);
        setPeriod(updatedPeriod);
        setAutoValuesData(autoVals);
      } catch (err) {
        console.error('Error updating period dates:', err);
      }
    },
    [getSelectedSchoolIds, season, year]
  );

  // テンプレート適用
  const handleApplyTemplate = useCallback(
    async (templateId: string) => {
      const schoolIds = getSelectedSchoolIds();
      if (schoolIds.length === 0) return;
      setTemplateLoading(true);
      try {
        await initializeProgressFromTemplate(schoolIds[0], season, year, templateId);
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

  // テンプレート保存
  const handleSaveAsTemplate = useCallback(async () => {
    const schoolIds = getSelectedSchoolIds();
    if (schoolIds.length === 0 || !saveTemplateName.trim()) return;
    setSaving(true);
    try {
      await saveCurrentAsTemplate(schoolIds[0], season, year, 'progress', saveTemplateName.trim());
      alert('テンプレートを保存しました');
      setShowSaveDialog(false);
      setSaveTemplateName('');
    } catch (err) {
      console.error('Error saving template:', err);
      setErrorMessage(getUserErrorMessage(err, 'テンプレートの保存に失敗しました'));
    } finally {
      setSaving(false);
    }
  }, [getSelectedSchoolIds, season, year, saveTemplateName]);

  // テンプレート削除
  const handleDeleteTemplate = useCallback(async (templateId: string) => {
    const schoolIds = getSelectedSchoolIds();
    if (schoolIds.length === 0) return;
    if (!confirm('このテンプレートを削除しますか？')) return;
    try {
      await deleteTemplate(templateId, schoolIds[0]);
      const tpls = await getTemplates('progress', season, schoolIds[0]);
      setTemplates(tpls);
    } catch (err) {
      console.error('Error deleting template:', err);
    }
  }, [getSelectedSchoolIds, season]);

  // スケジュールタスクとのリンク設定（進捗管理側から）
  const handleLinkScheduleTask = useCallback(
    async (itemId: string, taskId: string | null) => {
      const schoolIds = getSelectedSchoolIds();
      if (schoolIds.length === 0) return;
      try {
        // 既にこのitemIdにリンクされている別タスクがあれば解除
        const linkedTasks = scheduleTasks.filter((t) => t.linked_progress_item_id === itemId);
        for (const t of linkedTasks) {
          await updateScheduleTask(t.id, { linked_progress_item_id: null }, schoolIds[0]);
        }
        // 新しいリンクを設定
        if (taskId) {
          await updateScheduleTask(taskId, { linked_progress_item_id: itemId }, schoolIds[0]);
        }
        // 再取得
        const batchResult = await batchFetchCoursePrepApi(
          { schoolId: schoolIds[0], season, year: String(year) },
          ['schedule_tasks']
        );
        setScheduleTasks((batchResult.schedule_tasks || []) as ScheduleTaskWithMarkers[]);
      } catch (err) {
        console.error('Error linking schedule task:', err);
      }
    },
    [getSelectedSchoolIds, scheduleTasks, season, year]
  );

  // カレンダー同期
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');
  const handleSyncCalendar = useCallback(async () => {
    const schoolIds = getSelectedSchoolIds();
    if (schoolIds.length === 0) return;
    setSyncing(true);
    setSyncMessage('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setSyncMessage('認証エラー: ログインし直してください');
        return;
      }
      const res = await fetch('/api/courses/progress/sync-calendar', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ schoolId: schoolIds[0] }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSyncMessage(data.error || '同期に失敗しました');
        return;
      }
      setSyncMessage(data.message);
      if (data.synced > 0) {
        await fetchData();
      }
    } catch (err) {
      console.error('Error syncing calendar:', err);
      setSyncMessage('カレンダー同期に失敗しました');
    } finally {
      setSyncing(false);
    }
  }, [getSelectedSchoolIds, fetchData]);

  // テンプレートダイアログを手動で開く
  const handleOpenTemplateDialog = useCallback(async () => {
    const schoolIds = getSelectedSchoolIds();
    if (schoolIds.length === 0) return;
    const tpls = await getTemplates('progress', season, schoolIds[0]);
    setTemplates(tpls);
    setShowTemplateDialog(true);
  }, [season, getSelectedSchoolIds]);

  // 項目追加
  const handleAddItem = useCallback(async () => {
    if (!newItemName.trim()) return;
    const schoolIds = getSelectedSchoolIds();
    if (schoolIds.length === 0) return;
    try {
      await createCourseProgressItem(
        {
          name: newItemName.trim(),
          column_type: newItemAutoSource ? 'number' : newItemType,
          column_group: newItemGroup || null,
          auto_source: newItemAutoSource || null,
        },
        schoolIds[0],
        season,
        year
      );
      setNewItemName('');
      setNewItemType('check');
      setNewItemGroup('');
      setNewItemAutoSource('');
      await fetchData();
    } catch (err) {
      console.error('Error creating item:', err);
      setErrorMessage(getUserErrorMessage(err, '項目の作成に失敗しました'));
    }
  }, [newItemName, newItemType, newItemGroup, newItemAutoSource, getSelectedSchoolIds, season, year, fetchData]);

  // 項目削除
  const handleDeleteItem = useCallback(
    async (itemId: string) => {
      if (!confirm('この項目を削除しますか？関連するデータも削除されます。')) return;
      const schoolIds = getSelectedSchoolIds();
      if (schoolIds.length === 0) return;
      try {
        await deleteCourseProgressItem(itemId, schoolIds[0]);
        await fetchData();
      } catch (err) {
        console.error('Error deleting item:', err);
        setErrorMessage(getUserErrorMessage(err, '項目の削除に失敗しました'));
      }
    },
    [fetchData, getSelectedSchoolIds]
  );

  // 項目非表示トグル
  const handleToggleHideItem = useCallback(
    async (itemId: string, isHidden: boolean) => {
      const schoolIds = getSelectedSchoolIds();
      if (schoolIds.length === 0) return;
      try {
        if (isHidden) {
          await unhideCourseProgressItem(itemId, schoolIds[0]);
        } else {
          await hideCourseProgressItem(itemId, schoolIds[0]);
        }
        await fetchData();
      } catch (err) {
        console.error('Error toggling item visibility:', err);
      }
    },
    [fetchData, getSelectedSchoolIds]
  );

  // 項目並び替え
  const handleReorderItem = useCallback(
    async (itemId: string, direction: 'up' | 'down') => {
      const schoolIds = getSelectedSchoolIds();
      if (schoolIds.length === 0) return;
      const idx = items.findIndex((i) => i.id === itemId);
      if (idx < 0) return;
      const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= items.length) return;
      const a = items[idx];
      const b = items[swapIdx];
      // ローカル即時反映
      setItems((prev) => {
        const next = [...prev];
        next[idx] = { ...b, sort_order: a.sort_order };
        next[swapIdx] = { ...a, sort_order: b.sort_order };
        return next.sort((x, y) => x.sort_order - y.sort_order);
      });
      try {
        await Promise.all([
          updateCourseProgressItem(a.id, schoolIds[0], { sort_order: b.sort_order }),
          updateCourseProgressItem(b.id, schoolIds[0], { sort_order: a.sort_order }),
        ]);
      } catch (err) {
        console.error('Error reordering items:', err);
        fetchData();
      }
    },
    [items, getSelectedSchoolIds, fetchData]
  );

  // 項目名変更
  const handleItemNameChange = useCallback(
    async (itemId: string, name: string) => {
      const schoolIds = getSelectedSchoolIds();
      if (schoolIds.length === 0) return;
      // ローカル即時反映
      setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, name } : i)));
      try {
        await updateCourseProgressItem(itemId, schoolIds[0], { name });
      } catch (err) {
        console.error('Error updating item name:', err);
        fetchData();
      }
    },
    [getSelectedSchoolIds, fetchData]
  );

  // 期日変更（ガントチャート連動はschedule側で実装）
  const handleItemDeadlineChange = useCallback(
    async (itemId: string, deadline: string | null) => {
      const schoolIds = getSelectedSchoolIds();
      if (schoolIds.length === 0) return;
      setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, deadline } : i)));
      try {
        await updateCourseProgressItem(itemId, schoolIds[0], { deadline });
      } catch (err) {
        console.error('Error updating item deadline:', err);
        fetchData();
      }
    },
    [getSelectedSchoolIds, fetchData]
  );

  // 権限チェック中
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
    <AdminLayout headerTitle="講習 進捗管理">
      <div className="max-w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* ヘッダー: 期・年選択 + アクション */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <SeasonYearSelector
            season={season}
            year={year}
            onSeasonChange={setSeason}
            onYearChange={setYear}
          />
          <div className="flex items-center gap-2">
            {isOwnerOrAbove && (
              <>
                <button
                  onClick={handleOpenTemplateDialog}
                  className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600"
                >
                  テンプレート適用
                </button>
                <button
                  onClick={() => {
                    const seasonLabel = season === 'spring' ? '春期' : season === 'summer' ? '夏期' : '冬期';
                    setSaveTemplateName(`${seasonLabel}${year} 進捗管理テンプレート`);
                    setShowSaveDialog(true);
                  }}
                  className="px-3 py-1.5 text-xs border border-green-200 rounded-lg hover:bg-green-50 text-green-600"
                >
                  テンプレート保存
                </button>
                <button
                  onClick={handleSyncCalendar}
                  disabled={syncing}
                  className="px-3 py-1.5 text-xs border border-blue-200 rounded-lg hover:bg-blue-50 text-blue-600 disabled:opacity-50"
                  title="Googleカレンダーの面談予約を取得して進捗を同期"
                >
                  {syncing ? '同期中...' : '面談同期'}
                </button>
              </>
            )}
            <button
              onClick={() => setShowSettings(!showSettings)}
              className={`px-3 py-1.5 text-xs border rounded-lg ${showSettings ? 'border-[#1e3a5f] bg-[#1e3a5f] text-white' : 'border-gray-200 hover:bg-gray-50 text-gray-600'}`}
            >
              設定
            </button>
          </div>
        </div>

        {/* カレンダー同期結果 */}
        {syncMessage && (
          <div className="mb-4 px-4 py-2 rounded border border-blue-200 bg-blue-50 text-sm text-blue-700 flex items-center justify-between">
            <span>{syncMessage}</span>
            <button onClick={() => setSyncMessage('')} className="text-blue-400 hover:text-blue-600 ml-2">&times;</button>
          </div>
        )}

        {/* エラーメッセージ */}
        {errorMessage && (
          <div className="mb-4 bg-[#ef4444]/20 text-[#ef4444] px-4 py-2 rounded border border-[#ef4444]">
            {errorMessage}
          </div>
        )}

        {/* ダッシュボード */}
        {!isLoading && displayItems.length > 0 && (
          <CourseProgressDashboard
            students={filteredStudents}
            items={displayItems}
            progressData={progressData}
            period={period}
            onBudgetKomaChange={isOwnerOrAbove ? handleBudgetKomaChange : undefined}
            onPeriodDateChange={isOwnerOrAbove ? handlePeriodDateChange : undefined}
          />
        )}

        {/* 設定パネル（アコーディオン: フィルター + 項目管理） */}
        {showSettings && (
          <div className="mb-4 bg-white rounded-xl border border-gray-200 overflow-hidden">
            {/* タブ切り替え */}
            <div className="flex border-b border-gray-200">
              <button
                onClick={() => setSettingsTab('filter')}
                className={`px-4 py-2 text-xs font-medium transition-colors ${
                  settingsTab === 'filter'
                    ? 'text-[#1e3a5f] border-b-2 border-[#1e3a5f] bg-blue-50/30'
                    : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                フィルター
              </button>
              {isOwnerOrAbove && (
                <button
                  onClick={() => setSettingsTab('items')}
                  className={`px-4 py-2 text-xs font-medium transition-colors ${
                    settingsTab === 'items'
                      ? 'text-[#1e3a5f] border-b-2 border-[#1e3a5f] bg-blue-50/30'
                      : 'text-gray-400 hover:text-gray-600'
                  }`}
                >
                  列の追加・削除
                </button>
              )}
            </div>

            <div className="p-4">
              {/* フィルタータブ */}
              {settingsTab === 'filter' && (
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="生徒名で検索..."
                    className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg w-48"
                  />
                  <select
                    value={gradeFilter ?? 'all'}
                    onChange={(e) =>
                      setGradeFilter(e.target.value === 'all' ? null : Number(e.target.value))
                    }
                    className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg"
                  >
                    <option value="all">全学年</option>
                    {[4, 5, 6, 7, 8, 9, 10, 11, 12].map((g) => (
                      <option key={g} value={g}>
                        {g <= 6 ? `小${g}` : g <= 9 ? `中${g - 6}` : `高${g - 9}`}
                      </option>
                    ))}
                  </select>
                  {isOwnerOrAbove && (
                    <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={showHidden}
                        onChange={(e) => setShowHidden(e.target.checked)}
                        className="w-3.5 h-3.5 text-[#3b82f6] rounded"
                      />
                      非表示項目も表示
                    </label>
                  )}
                  {(searchQuery || gradeFilter !== null) && (
                    <button
                      onClick={() => {
                        setSearchQuery('');
                        setGradeFilter(null);
                      }}
                      className="text-xs text-gray-400 hover:text-gray-600"
                    >
                      リセット
                    </button>
                  )}
                </div>
              )}

              {/* 列の追加・削除タブ */}
              {settingsTab === 'items' && isOwnerOrAbove && (
                <div>
                  {/* 新規追加 */}
                  <div className="flex flex-wrap items-end gap-2 mb-4 pb-4 border-b border-gray-100">
                    <div>
                      <label className="text-[10px] text-gray-500 block mb-0.5">項目名</label>
                      <input
                        type="text"
                        value={newItemName}
                        onChange={(e) => setNewItemName(e.target.value)}
                        placeholder="項目名"
                        className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg w-40"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500 block mb-0.5">タイプ</label>
                      <select
                        value={newItemType}
                        onChange={(e) => setNewItemType(e.target.value as ApplicationColumnType)}
                        className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg"
                      >
                        <option value="check">チェック</option>
                        <option value="number">数値</option>
                        <option value="date">日付</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500 block mb-0.5">グループ</label>
                      <select
                        value={newItemGroup}
                        onChange={(e) => setNewItemGroup(e.target.value)}
                        className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg"
                      >
                        <option value="">なし</option>
                        {Object.entries(PROGRESS_COLUMN_GROUPS).map(([key, val]) => (
                          <option key={key} value={key}>
                            {val.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500 block mb-0.5">自動計算</label>
                      <select
                        value={newItemAutoSource}
                        onChange={(e) => setNewItemAutoSource(e.target.value)}
                        className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg"
                      >
                        <option value="">手動入力</option>
                        <option value="regular_weekly">通塾回数/週</option>
                        <option value="course_sessions">講習期間通常回数</option>
                        <option value="proposed_extra">提示増コマ (教科別計-通常回数)</option>
                      </select>
                    </div>
                    <button
                      onClick={handleAddItem}
                      disabled={!newItemName.trim()}
                      className="px-3 py-1.5 text-xs bg-[#1e3a5f] text-white rounded-lg hover:bg-[#2c5282] disabled:opacity-50"
                    >
                      追加
                    </button>
                  </div>

                  {/* 既存項目一覧 */}
                  <div className="space-y-1 max-h-80 overflow-y-auto">
                    {items.map((item) => {
                      const linkedTask = scheduleTasks.find((t) => t.linked_progress_item_id === item.id);
                      return (
                        <div
                          key={item.id}
                          className={`flex items-center justify-between gap-2 px-2 py-1.5 rounded text-xs ${
                            item.is_hidden ? 'bg-gray-50 text-gray-400' : ''
                          }`}
                        >
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <div className="flex flex-col shrink-0">
                              <button
                                onClick={() => handleReorderItem(item.id, 'up')}
                                disabled={items.indexOf(item) === 0}
                                className="text-[9px] text-gray-400 hover:text-gray-700 disabled:opacity-20 leading-none"
                                title="上へ"
                              >▲</button>
                              <button
                                onClick={() => handleReorderItem(item.id, 'down')}
                                disabled={items.indexOf(item) === items.length - 1}
                                className="text-[9px] text-gray-400 hover:text-gray-700 disabled:opacity-20 leading-none"
                                title="下へ"
                              >▼</button>
                            </div>
                            <span className="font-medium shrink-0">{item.name}</span>
                            <span className="text-[10px] text-gray-400 shrink-0">
                              {item.column_type === 'check'
                                ? 'チェック'
                                : item.column_type === 'number'
                                ? '数値'
                                : '日付'}
                            </span>
                            {item.column_group && (
                              <span
                                className="text-[9px] px-1 py-0.5 rounded shrink-0"
                                style={{
                                  backgroundColor:
                                    (PROGRESS_COLUMN_GROUPS[item.column_group]?.color || '#6b7280') + '20',
                                  color: PROGRESS_COLUMN_GROUPS[item.column_group]?.color || '#6b7280',
                                }}
                              >
                                {PROGRESS_COLUMN_GROUPS[item.column_group]?.label || item.column_group}
                              </span>
                            )}
                            {item.auto_source && (
                              <span className="text-[9px] px-1 py-0.5 bg-blue-100 text-blue-600 rounded shrink-0">
                                {item.auto_source === 'regular_weekly' ? '通塾回数' :
                                 item.auto_source === 'course_sessions' ? '通常回数' :
                                 item.auto_source === 'proposed_extra' ? '提示増コマ' : '自動'}
                              </span>
                            )}
                            {item.is_hidden && (
                              <span className="text-[9px] px-1 py-0.5 bg-gray-200 text-gray-500 rounded shrink-0">
                                非表示
                              </span>
                            )}
                            {/* スケジュールリンク */}
                            {item.column_type === 'check' && scheduleTasks.length > 0 && (
                              <select
                                value={linkedTask?.id || ''}
                                onChange={(e) => handleLinkScheduleTask(item.id, e.target.value || null)}
                                className="text-[10px] px-1 py-0.5 border border-gray-200 rounded bg-white text-gray-600 max-w-[140px] truncate"
                                title={linkedTask ? `リンク: ${linkedTask.name}` : 'スケジュールタスクをリンク'}
                              >
                                <option value="">リンクなし</option>
                                {scheduleTasks.map((t) => (
                                  <option key={t.id} value={t.id}>
                                    {t.major_category}: {t.name}
                                  </option>
                                ))}
                              </select>
                            )}
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={() => handleToggleHideItem(item.id, item.is_hidden)}
                              className="text-[10px] text-gray-400 hover:text-gray-600 px-1"
                            >
                              {item.is_hidden ? '表示' : '非表示'}
                            </button>
                            <button
                              onClick={() => handleDeleteItem(item.id)}
                              className="text-[10px] text-[#ef4444] hover:text-[#dc2626] px-1"
                            >
                              削除
                            </button>
                          </div>
                        </div>
                      );
                    })}
                    {items.length === 0 && (
                      <p className="text-xs text-gray-400 text-center py-4">
                        項目がありません。テンプレートから作成するか、手動で追加してください。
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* テーブル */}
        {isLoading ? (
          <div className="bg-white rounded-xl border border-gray-200 p-8">
            <div className="flex items-center justify-center">
              <div className="w-8 h-8 border-4 border-[#1e3a5f] border-t-transparent rounded-full animate-spin" />
              <span className="ml-3 text-[#4b5563]">読み込み中...</span>
            </div>
          </div>
        ) : displayItems.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
            <p className="text-[#4b5563] mb-4">進捗管理項目がありません。</p>
            {isOwnerOrAbove && (
              <button
                onClick={handleOpenTemplateDialog}
                className="px-4 py-2 text-sm bg-[#1e3a5f] text-white rounded-lg hover:bg-[#2c5282]"
              >
                テンプレートから作成
              </button>
            )}
          </div>
        ) : (
          <CourseProgressTable
            students={filteredStudents}
            items={displayItems}
            progressData={progressData}
            autoValues={autoValuesData}
            canEdit={canEdit}
            onStatusChange={handleStatusChange}
            onNumberChange={handleNumberChange}
            onDateChange={handleDateChange}
            onItemNameChange={isOwnerOrAbove ? handleItemNameChange : undefined}
            onItemDeadlineChange={isOwnerOrAbove ? handleItemDeadlineChange : undefined}
          />
        )}
      </div>

      {/* テンプレート適用ダイアログ */}
      {showTemplateDialog && (
        <TemplateApplyDialog
          templates={templates}
          onApply={handleApplyTemplate}
          onClose={() => setShowTemplateDialog(false)}
          isLoading={templateLoading}
          onDelete={handleDeleteTemplate}
        />
      )}

      {/* テンプレート保存ダイアログ */}
      {showSaveDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-96 max-w-[90vw]">
            <h3 className="text-sm font-bold text-[#1e3a5f] mb-4">テンプレートとして保存</h3>
            <p className="text-xs text-gray-500 mb-3">
              現在の進捗管理項目をテンプレートとして保存します。
            </p>
            <input
              type="text"
              value={saveTemplateName}
              onChange={(e) => setSaveTemplateName(e.target.value)}
              placeholder="テンプレート名"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg mb-4"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && saveTemplateName.trim()) handleSaveAsTemplate();
              }}
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowSaveDialog(false)}
                className="px-4 py-2 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600"
              >
                キャンセル
              </button>
              <button
                onClick={handleSaveAsTemplate}
                disabled={!saveTemplateName.trim() || saving}
                className="px-4 py-2 text-xs bg-[#1e3a5f] text-white rounded-lg hover:bg-[#2c5282] disabled:opacity-50"
              >
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
