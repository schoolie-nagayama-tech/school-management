'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { AdminLayout } from '@/components/layouts';
import { Loading, InlineLoading } from '@/components/ui';
import { ContextHelp } from '@/components/help/ContextHelp';

// 重いテーブル本体・ダッシュボードは初期バンドルに含めず、データ取得と並行して遅延ロード
const CourseProgressDashboard = dynamic(
  () => import('@/components/course-progress').then((m) => m.CourseProgressDashboard),
  { ssr: false, loading: () => <div className="h-32 rounded-xl bg-gray-50 animate-pulse" /> }
);
const CourseProgressTable = dynamic(
  () => import('@/components/course-progress').then((m) => m.CourseProgressTable),
  { ssr: false, loading: () => <div className="h-96 rounded-xl bg-gray-50 animate-pulse" /> }
);
import { SeasonYearSelector } from '@/components/course-shared/SeasonYearSelector';
import { TemplateApplyDialog } from '@/components/course-shared/TemplateApplyDialog';
import { supabase } from '@/lib/supabase';
import { batchFetchCoursePrepApi, callCoursePrepApi } from '@/lib/api/coursePrepApi';
import {
  upsertCoursePrepPeriod,
  updateStudentProgress,
  updateStudentProgressNumber,
  updateStudentProgressDate,
  createCourseProgressItem,
  updateCourseProgressItem,
  deleteCourseProgressItem,
  hideCourseProgressItem,
  unhideCourseProgressItem,
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
import { HelpTooltip } from '@/components/ui/Tooltip';
import { loadSavedSeasonYear, saveSavedSeasonYear } from '@/lib/utils/coursePrepStorage';
import { useLocalSchoolId } from '@/hooks/useLocalSchoolId';
import { SchoolSwitcher } from '@/components/SchoolSwitcher';

export default function CourseProgressPage() {
  const { hasPermission, isLoading: permissionLoading } = useRequirePermission(
    (p) => p.canAccessCourses
  );
  const canEdit = useCanEdit('canEditApplications');
  const { selectedSchoolId, profile } = useAuth();
  const { localSchoolId, setLocalSchoolId, isAllSelected, availableSchools } = useLocalSchoolId();
  const isOwnerOrAbove =
    profile?.role === 'owner' ||
    profile?.role === 'admin';
  const isManagerOrAbove =
    isOwnerOrAbove ||
    profile?.role === 'manager';

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
  // フィルタ計算は重い memo を多数連動させるので 250ms デバウンスして打鍵中の再計算を抑える
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [gradeFilter, setGradeFilter] = useState<number | null>(null);
  const [showHidden, setShowHidden] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearchQuery(searchQuery), 250);
    return () => clearTimeout(id);
  }, [searchQuery]);

  // 設定パネル（フィルター + 項目管理 をアコーディオン統合）
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'filter' | 'items'>('filter');
  const [newItemName, setNewItemName] = useState('');
  const [newItemType, setNewItemType] = useState<ApplicationColumnType>('check');
  const [newItemGroup, setNewItemGroup] = useState<string>('');
  const [newItemAutoSource, setNewItemAutoSource] = useState<string>('');
  const [dragItemId, setDragItemId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage('');
    try {
      if (!localSchoolId) {
        setErrorMessage('教室が選択されていません');
        setIsLoading(false);
        return;
      }
      const schoolId = localSchoolId;

      // バッチAPI: 生徒を含む全データを1リクエストで取得
      const batchData = await batchFetchCoursePrepApi(
        { schoolId, season, year: String(year), includeHidden: String(showHidden) },
        ['students', 'progress_items', 'student_progress', 'period', 'auto_values', 'schedule_tasks']
      );

      const studentsData = ((batchData.students as Record<string, unknown>[]) || []) as Student[];

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

      setStudents(studentsData);
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
  }, [localSchoolId, season, year, showHidden, isOwnerOrAbove]);

  useEffect(() => {
    if (selectedSchoolId !== null) {
      fetchData();
    }
  }, [fetchData, localSchoolId]);

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

  // フィルター適用（デバウンス後の検索クエリを使用）
  const filteredStudents = useMemo(() => {
    let result = students;
    if (gradeFilter !== null) {
      result = result.filter((s) => s.grade === gradeFilter);
    }
    if (debouncedSearchQuery) {
      const q = debouncedSearchQuery.toLowerCase();
      result = result.filter(
        (s) =>
          s.last_name.toLowerCase().includes(q) ||
          s.first_name.toLowerCase().includes(q) ||
          s.last_name_kana.toLowerCase().includes(q) ||
          s.first_name_kana.toLowerCase().includes(q)
      );
    }
    return result;
  }, [students, gradeFilter, debouncedSearchQuery]);

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
      if (!localSchoolId) return;
      setPeriod((prev) => prev ? { ...prev, budget_koma: value } : prev);
      try {
        await upsertCoursePrepPeriod(localSchoolId, season, year, { budget_koma: value });
      } catch (err) {
        console.error('Error updating budget:', err);
        fetchData();
      }
    },
    [localSchoolId, season, year, fetchData]
  );

  // 目標コマ変更
  const handleTargetKomaChange = useCallback(
    async (value: number) => {
      if (!localSchoolId) return;
      setPeriod((prev) => prev ? { ...prev, target_koma: value } : prev);
      try {
        await upsertCoursePrepPeriod(localSchoolId, season, year, { target_koma: value });
      } catch (err) {
        console.error('Error updating target:', err);
        fetchData();
      }
    },
    [localSchoolId, season, year, fetchData]
  );

  // 予想取得率変更
  const handleExpectedRateChange = useCallback(
    async (value: number) => {
      if (!localSchoolId) return;
      setPeriod((prev) => prev ? { ...prev, expected_rate: value } : prev);
      try {
        await upsertCoursePrepPeriod(localSchoolId, season, year, { expected_rate: value });
      } catch (err) {
        console.error('Error updating expected rate:', err);
        fetchData();
      }
    },
    [localSchoolId, season, year, fetchData]
  );

  // 講習期間日付変更 → upsert後にperiod+auto_valuesだけバッチ再取得（1リクエスト）
  const handlePeriodDateChange = useCallback(
    async (updates: Partial<Pick<CoursePrepPeriod, 'schedule_start_date' | 'schedule_end_date'>>) => {
      if (!localSchoolId) return;
      try {
        await upsertCoursePrepPeriod(localSchoolId, season, year, updates);
        const batchResult = await batchFetchCoursePrepApi(
          { schoolId: localSchoolId, season, year: String(year) },
          ['period', 'auto_values']
        );
        setPeriod((batchResult.period as CoursePrepPeriod) || null);
        setAutoValuesData((batchResult.auto_values || {}) as AutoValues);
      } catch (err) {
        console.error('Error updating period dates:', err);
      }
    },
    [localSchoolId, season, year]
  );

  // テンプレート適用
  const handleApplyTemplate = useCallback(
    async (templateId: string) => {
      if (!localSchoolId) return;
      setTemplateLoading(true);
      try {
        await initializeProgressFromTemplate(localSchoolId, season, year, templateId);
        setShowTemplateDialog(false);
        await fetchData();
      } catch (err) {
        console.error('Error applying template:', err);
        setErrorMessage(getUserErrorMessage(err, 'テンプレートの適用に失敗しました'));
      } finally {
        setTemplateLoading(false);
      }
    },
    [localSchoolId, season, year, fetchData]
  );

  // テンプレート保存
  const handleSaveAsTemplate = useCallback(async () => {
    if (!localSchoolId || !saveTemplateName.trim()) return;
    setSaving(true);
    try {
      await saveCurrentAsTemplate(localSchoolId, season, year, 'progress', saveTemplateName.trim());
      alert('テンプレートを保存しました');
      setShowSaveDialog(false);
      setSaveTemplateName('');
    } catch (err) {
      console.error('Error saving template:', err);
      setErrorMessage(getUserErrorMessage(err, 'テンプレートの保存に失敗しました'));
    } finally {
      setSaving(false);
    }
  }, [localSchoolId, season, year, saveTemplateName]);

  // テンプレート削除
  const handleDeleteTemplate = useCallback(async (templateId: string) => {
    if (!localSchoolId) return;
    if (!confirm('このテンプレートを削除しますか？')) return;
    try {
      await deleteTemplate(templateId, localSchoolId);
      const tpls = await getTemplates('progress', season, localSchoolId);
      setTemplates(tpls);
    } catch (err) {
      console.error('Error deleting template:', err);
    }
  }, [localSchoolId, season]);

  // スケジュールタスクとのリンク設定 → バッチ1リクエスト + 再取得1リクエスト
  const handleLinkScheduleTask = useCallback(
    async (itemId: string, taskId: string | null) => {
      if (!localSchoolId) return;
      try {
        const unlinkTaskIds = scheduleTasks
          .filter((t) => t.linked_progress_item_id === itemId)
          .map((t) => t.id);
        await callCoursePrepApi('batch_link_schedule_tasks', localSchoolId, {
          unlinkTaskIds,
          linkTaskId: taskId,
          linkItemId: itemId,
        });
        // 再取得
        const batchResult = await batchFetchCoursePrepApi(
          { schoolId: localSchoolId, season, year: String(year) },
          ['schedule_tasks']
        );
        setScheduleTasks((batchResult.schedule_tasks || []) as ScheduleTaskWithMarkers[]);
      } catch (err) {
        console.error('Error linking schedule task:', err);
      }
    },
    [localSchoolId, scheduleTasks, season, year]
  );

  // カレンダー同期
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');
  const handleSyncCalendar = useCallback(async () => {
    if (!localSchoolId) return;
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
        body: JSON.stringify({ schoolId: localSchoolId }),
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
  }, [localSchoolId, fetchData]);

  // テンプレートダイアログを手動で開く
  const handleOpenTemplateDialog = useCallback(async () => {
    if (!localSchoolId) return;
    const tpls = await getTemplates('progress', season, localSchoolId);
    setTemplates(tpls);
    setShowTemplateDialog(true);
  }, [season, localSchoolId]);

  // 項目関連の部分再取得（項目+進捗だけ。生徒やauto_valuesは不変）
  const refetchItems = useCallback(async () => {
    if (!localSchoolId) return;
    try {
      const batchResult = await batchFetchCoursePrepApi(
        { schoolId: localSchoolId, season, year: String(year), includeHidden: String(showHidden) },
        ['progress_items', 'student_progress']
      );
      const itemsData = ((batchResult.progress_items as Record<string, unknown>[]) || []).map((item) => ({
        ...item,
        column_type: (item.column_type as string) || 'check',
        manager_only: item.manager_only === true,
        is_hidden: item.is_hidden === true,
        deadline: (item.deadline as string) || null,
        auto_source: (item.auto_source as string) || null,
      })) as CourseProgressItem[];
      const progressResult = ((batchResult.student_progress as Record<string, unknown>[]) || []).map((d) => ({
        ...d,
        number_value: d.number_value ?? null,
        date_value: d.date_value ?? null,
      })) as StudentCourseProgress[];
      setItems(itemsData);
      setProgressData(progressResult);
    } catch (err) {
      console.error('Error refetching items:', err);
    }
  }, [localSchoolId, season, year, showHidden]);

  // 項目追加
  const handleAddItem = useCallback(async () => {
    if (!newItemName.trim()) return;
    if (!localSchoolId) return;
    try {
      await createCourseProgressItem(
        {
          name: newItemName.trim(),
          column_type: newItemAutoSource ? 'number' : newItemType,
          column_group: newItemGroup || null,
          auto_source: newItemAutoSource || null,
        },
        localSchoolId,
        season,
        year
      );
      setNewItemName('');
      setNewItemType('check');
      setNewItemGroup('');
      setNewItemAutoSource('');
      await refetchItems();
    } catch (err) {
      console.error('Error creating item:', err);
      setErrorMessage(getUserErrorMessage(err, '項目の作成に失敗しました'));
    }
  }, [newItemName, newItemType, newItemGroup, newItemAutoSource, localSchoolId, season, year, refetchItems]);

  // 項目削除
  const handleDeleteItem = useCallback(
    async (itemId: string) => {
      if (!confirm('この項目を削除しますか？関連するデータも削除されます。')) return;
      if (!localSchoolId) return;
      try {
        await deleteCourseProgressItem(itemId, localSchoolId);
        await refetchItems();
      } catch (err) {
        console.error('Error deleting item:', err);
        setErrorMessage(getUserErrorMessage(err, '項目の削除に失敗しました'));
      }
    },
    [refetchItems, localSchoolId]
  );

  // 項目非表示トグル
  const handleToggleHideItem = useCallback(
    async (itemId: string, isHidden: boolean) => {
      if (!localSchoolId) return;
      try {
        if (isHidden) {
          await unhideCourseProgressItem(itemId, localSchoolId);
        } else {
          await hideCourseProgressItem(itemId, localSchoolId);
        }
        await refetchItems();
      } catch (err) {
        console.error('Error toggling item visibility:', err);
      }
    },
    [refetchItems, localSchoolId]
  );

  // 項目並び替え（D&D） → バッチ1リクエストで更新
  const handleDropItem = useCallback(
    async (dragId: string, dropId: string) => {
      if (dragId === dropId) return;
      if (!localSchoolId) return;
      const dragIdx = items.findIndex((i) => i.id === dragId);
      const dropIdx = items.findIndex((i) => i.id === dropId);
      if (dragIdx < 0 || dropIdx < 0) return;

      // 新しい並び順を作成
      const reordered = [...items];
      const [moved] = reordered.splice(dragIdx, 1);
      reordered.splice(dropIdx, 0, moved);

      // sort_orderを振り直し
      const updates = reordered.map((item, i) => ({ ...item, sort_order: i }));
      setItems(updates);

      // 変更のあった項目をバッチ1リクエストで送信
      try {
        const changed = updates
          .filter((u) => {
            const orig = items.find((o) => o.id === u.id);
            return orig && orig.sort_order !== u.sort_order;
          })
          .map((c) => ({ id: c.id, sort_order: c.sort_order }));
        if (changed.length > 0) {
          await callCoursePrepApi('batch_reorder_items', localSchoolId, { items: changed });
        }
      } catch (err) {
        console.error('Error reordering items:', err);
        fetchData();
      }
    },
    [items, localSchoolId, fetchData]
  );

  // 項目名変更
  const handleItemNameChange = useCallback(
    async (itemId: string, name: string) => {
      if (!localSchoolId) return;
      // ローカル即時反映
      setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, name } : i)));
      try {
        await updateCourseProgressItem(itemId, localSchoolId, { name });
      } catch (err) {
        console.error('Error updating item name:', err);
        fetchData();
      }
    },
    [localSchoolId, fetchData]
  );

  // 期日変更（ガントチャート連動はschedule側で実装）
  const handleItemDeadlineChange = useCallback(
    async (itemId: string, deadline: string | null) => {
      if (!localSchoolId) return;
      setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, deadline } : i)));
      try {
        await updateCourseProgressItem(itemId, localSchoolId, { deadline });
      } catch (err) {
        console.error('Error updating item deadline:', err);
        fetchData();
      }
    },
    [localSchoolId, fetchData]
  );

  // 権限チェック中
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
    <AdminLayout headerTitle="講習 進捗管理">
      <div>
        {/* コンテキストヘルプ */}
        <div className="flex justify-end mb-2">
          <ContextHelp
            searchQuery="進捗管理"
            topics={[
              {
                title: '進捗を入力する',
                description: '生徒ごとの講習進捗を記録します。',
                steps: [
                  '期・年を選択して対象データを表示',
                  'テーブル内のセルをクリックして編集',
                  '進捗ステータスやコマ数を入力',
                ],
              },
              {
                title: 'テンプレートを適用する',
                description: '保存済みテンプレートから一括設定します。',
                steps: [
                  '「テンプレート適用」ボタンをクリック',
                  '適用するテンプレートを選択',
                  '上書き範囲を確認して適用',
                ],
              },
              {
                title: 'ダッシュボードで全体把握する',
                description: '教室全体の進捗状況をグラフで確認します。',
                steps: [
                  'ページ上部のダッシュボードで完了率を確認',
                  '遅れている生徒を素早く特定',
                ],
              },
            ]}
          />
        </div>

        {isAllSelected && (
          <SchoolSwitcher
            schools={availableSchools}
            selectedSchoolId={localSchoolId}
            onChange={setLocalSchoolId}
          />
        )}
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
                  className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600 transition-colors duration-150"
                >
                  テンプレート適用
                </button>
                <button
                  onClick={() => {
                    const seasonLabel = season === 'spring' ? '春期' : season === 'summer' ? '夏期' : '冬期';
                    setSaveTemplateName(`${seasonLabel}${year} 進捗管理テンプレート`);
                    setShowSaveDialog(true);
                  }}
                  className="px-3 py-1.5 text-xs border border-green-200 rounded-lg hover:bg-green-50 text-green-600 transition-colors duration-150"
                >
                  テンプレート保存
                </button>
                <button
                  onClick={handleSyncCalendar}
                  disabled={syncing}
                  className="px-3 py-1.5 text-xs border border-blue-200 rounded-lg hover:bg-blue-50 text-blue-600 disabled:opacity-50 transition-colors duration-150"
                  title="Googleカレンダーの面談予約を取得して進捗を同期"
                >
                  {syncing ? '同期中...' : '面談同期'}
                </button>
              </>
            )}
            <button
              onClick={() => setShowSettings(!showSettings)}
              className={`px-3 py-1.5 text-xs border rounded-lg ${showSettings ? 'border-ink bg-ink text-white' : 'border-gray-200 hover:bg-gray-50 text-gray-600'}`}
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
          <div className="mb-4 bg-danger/20 text-danger px-4 py-2 rounded border border-danger">
            {errorMessage}
          </div>
        )}

        {/* ダッシュボード（教室長以上のみ表示） */}
        {!isLoading && displayItems.length > 0 && isManagerOrAbove && (
          <CourseProgressDashboard
            students={filteredStudents}
            items={displayItems}
            progressData={progressData}
            period={period}
            autoValues={autoValuesData}
            onBudgetKomaChange={isManagerOrAbove ? handleBudgetKomaChange : undefined}
            onTargetKomaChange={isManagerOrAbove ? handleTargetKomaChange : undefined}
            onExpectedRateChange={isManagerOrAbove ? handleExpectedRateChange : undefined}
            onPeriodDateChange={isManagerOrAbove ? handlePeriodDateChange : undefined}
          />
        )}

        {/* 設定パネル（アコーディオン: フィルター + 項目管理） */}
        {showSettings && (
          <div className="mb-4 bg-white rounded-xl border border-gray-200 overflow-hidden">
            {/* タブ切り替え */}
            <div className="flex border-b border-gray-200">
              <button
                onClick={() => setSettingsTab('filter')}
                className={`px-4 py-2 text-xs font-medium transition-colors duration-150 ${
                  settingsTab === 'filter'
                    ? 'text-ink border-b-2 border-ink bg-blue-50/30'
                    : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                フィルター
              </button>
              {isOwnerOrAbove && (
                <button
                  onClick={() => setSettingsTab('items')}
                  className={`px-4 py-2 text-xs font-medium transition-colors duration-150 ${
                    settingsTab === 'items'
                      ? 'text-ink border-b-2 border-ink bg-blue-50/30'
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
                        className="w-3.5 h-3.5 text-info rounded"
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
                      className="text-xs text-gray-400 hover:text-gray-600 transition-colors duration-150"
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
                      <label className="text-[10px] text-gray-500 mb-0.5 flex items-center gap-1">
                        自動計算
                        <HelpTooltip
                          text={
                            "自動計算を設定すると値が自動で入ります（編集不可）\n\n" +
                            "■ 通塾回数/週: 通塾パターンから週の回数\n" +
                            "■ 講習期間通常回数: 講習期間中の通塾回数合計\n" +
                            "■ 提示増コマ: 教科別コマ合計 - 講習期間通常回数\n" +
                            "■ 進行表コマ数: 進行表の提案コマを科目名で自動集計\n" +
                            "  ※ 項目名に科目名を含めてください（例: 英語, 数学）"
                          }
                          size={10}
                          position="bottom"
                        />
                      </label>
                      <select
                        value={newItemAutoSource}
                        onChange={(e) => setNewItemAutoSource(e.target.value)}
                        className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg"
                      >
                        <option value="">手動入力</option>
                        <option value="regular_weekly">通塾回数/週</option>
                        <option value="course_sessions">講習期間通常回数</option>
                        <option value="proposed_extra">提示増コマ (教科別計-通常回数)</option>
                        <option value="subject_proposal">進行表コマ数 (科目別)</option>
                      </select>
                    </div>
                    <button
                      onClick={handleAddItem}
                      disabled={!newItemName.trim()}
                      className="px-3 py-1.5 text-xs bg-ink text-white rounded-lg hover:bg-ink/80 disabled:opacity-50 transition-colors duration-150"
                    >
                      追加
                    </button>
                  </div>

                  {/* 既存項目一覧 */}
                  <div className="space-y-0.5 max-h-80 overflow-y-auto">
                    {items.map((item) => {
                      const linkedTask = scheduleTasks.find((t) => t.linked_progress_item_id === item.id);
                      return (
                        <div
                          key={item.id}
                          draggable
                          onDragStart={() => setDragItemId(item.id)}
                          onDragEnd={() => setDragItemId(null)}
                          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                          onDrop={(e) => { e.preventDefault(); if (dragItemId) handleDropItem(dragItemId, item.id); }}
                          className={`flex items-center justify-between gap-2 px-2 py-1.5 rounded text-xs transition-[opacity,transform,border-color,background-color] duration-150 ease-out ${
                            item.is_hidden ? 'bg-gray-50 text-gray-400' : ''
                          } ${dragItemId === item.id ? 'opacity-40 scale-95' : ''} ${dragItemId && dragItemId !== item.id ? 'border border-dashed border-blue-300' : 'border border-transparent'}`}
                        >
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <span className="cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 shrink-0 select-none" title="ドラッグで並び替え">⠿</span>
                            <span className="font-medium shrink-0">{item.name}</span>
                            <select
                              value={item.column_type}
                              onChange={async (e) => {
                                if (!localSchoolId) return;
                                const newType = e.target.value as ApplicationColumnType;
                                setItems((prev) => prev.map((i) => i.id === item.id ? { ...i, column_type: newType } : i));
                                try {
                                  await updateCourseProgressItem(item.id, localSchoolId, { column_type: newType });
                                } catch (err) {
                                  console.error('Error updating type:', err);
                                  fetchData();
                                }
                              }}
                              className="text-[10px] px-1 py-0.5 border border-gray-200 rounded bg-white text-gray-500"
                            >
                              <option value="check">チェック</option>
                              <option value="number">数値</option>
                              <option value="date">日付</option>
                            </select>
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
                                 item.auto_source === 'proposed_extra' ? '提示増コマ' :
                                 item.auto_source === 'subject_proposal' ? '進行表コマ' : '自動'}
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
                              className="text-[10px] text-gray-400 hover:text-gray-600 px-1 transition-colors duration-150"
                            >
                              {item.is_hidden ? '表示' : '非表示'}
                            </button>
                            <button
                              onClick={() => handleDeleteItem(item.id)}
                              className="text-[10px] text-danger hover:text-danger/80 px-1 transition-colors duration-150"
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
            <InlineLoading />
          </div>
        ) : displayItems.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
            <p className="text-text-body mb-4">進捗管理項目がありません。</p>
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
            <h3 className="text-sm font-bold text-ink mb-4">テンプレートとして保存</h3>
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
                className="px-4 py-2 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600 transition-colors duration-150"
              >
                キャンセル
              </button>
              <button
                onClick={handleSaveAsTemplate}
                disabled={!saveTemplateName.trim() || saving}
                className="px-4 py-2 text-xs bg-ink text-white rounded-lg hover:bg-ink/80 disabled:opacity-50 transition-colors duration-150"
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
