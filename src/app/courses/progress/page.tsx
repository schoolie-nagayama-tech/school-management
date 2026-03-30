'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { AdminLayout } from '@/components/layouts';
import { CourseProgressDashboard, CourseProgressTable } from '@/components/course-progress';
import { SeasonYearSelector } from '@/components/course-shared/SeasonYearSelector';
import { TemplateApplyDialog } from '@/components/course-shared/TemplateApplyDialog';
import { getStudents } from '@/lib/api/students';
import { supabase } from '@/lib/supabase';
import {
  getCourseProgressItems,
  getStudentCourseProgress,
  getCoursePrepPeriod,
  upsertCoursePrepPeriod,
  updateStudentProgress,
  updateStudentProgressNumber,
  updateStudentProgressDate,
  createCourseProgressItem,
  deleteCourseProgressItem,
  hideCourseProgressItem,
  unhideCourseProgressItem,
} from '@/lib/api/courseProgress';
import {
  getTemplates,
  initializeProgressFromTemplate,
} from '@/lib/api/courseTemplates';
import type {
  Student,
  CourseProgressItem,
  StudentCourseProgress,
  CoursePrepPeriod,
  CourseTemplate,
  ApplicationStatus,
  SeasonType,
  ApplicationColumnType,
} from '@/types/database';
import { PROGRESS_COLUMN_GROUPS } from '@/types/database';
import { useRequirePermission, useCanEdit } from '@/hooks/usePermissions';
import AccessDenied from '@/components/AccessDenied';
import { useAuth } from '@/contexts/AuthContext';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';

// 現在の期を推定
function getCurrentSeason(): SeasonType {
  const month = new Date().getMonth() + 1;
  if (month >= 2 && month <= 5) return 'spring';
  if (month >= 6 && month <= 9) return 'summer';
  return 'winter';
}

export default function CourseProgressPage() {
  const { hasPermission, isLoading: permissionLoading } = useRequirePermission(
    (p) => p.canAccessCourses
  );
  const canEdit = useCanEdit('canEditApplications');
  const { getSelectedSchoolIds, selectedSchoolId, profile } = useAuth();
  const isManagerOrAbove =
    profile?.role === 'manager' ||
    profile?.role === 'owner' ||
    profile?.role === 'admin';

  // 期・年選択
  const [season, setSeason] = useState<SeasonType>(getCurrentSeason());
  const [year, setYear] = useState(new Date().getFullYear());

  // データ
  const [students, setStudents] = useState<Student[]>([]);
  const [items, setItems] = useState<CourseProgressItem[]>([]);
  const [progressData, setProgressData] = useState<StudentCourseProgress[]>([]);
  const [period, setPeriod] = useState<CoursePrepPeriod | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  // テンプレート
  const [templates, setTemplates] = useState<CourseTemplate[]>([]);
  const [showTemplateDialog, setShowTemplateDialog] = useState(false);
  const [templateLoading, setTemplateLoading] = useState(false);

  // フィルター
  const [searchQuery, setSearchQuery] = useState('');
  const [gradeFilter, setGradeFilter] = useState<number | null>(null);
  const [showHidden, setShowHidden] = useState(false);

  // 項目管理
  const [showItemManager, setShowItemManager] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [newItemType, setNewItemType] = useState<ApplicationColumnType>('check');
  const [newItemGroup, setNewItemGroup] = useState<string>('');

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

      const [studentsData, itemsData, progressResult, periodData] = await Promise.all([
        getStudents(undefined, schoolIds),
        getCourseProgressItems(schoolId, season, year, showHidden),
        getStudentCourseProgress(schoolId, season, year),
        getCoursePrepPeriod(schoolId, season, year),
      ]);

      setStudents(studentsData.filter((s) => s.status !== 'withdrawn'));
      setItems(itemsData);
      setProgressData(progressResult);
      setPeriod(periodData);

      // 項目が0件なら初回テンプレート適用を提案
      if (itemsData.length === 0 && isManagerOrAbove) {
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
  }, [getSelectedSchoolIds, season, year, showHidden, isManagerOrAbove]);

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
        // 再取得
        const updatedPeriod = await getCoursePrepPeriod(schoolIds[0], season, year);
        setPeriod(updatedPeriod);
      } catch (err) {
        console.error('Error updating budget:', err);
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
          column_type: newItemType,
          column_group: newItemGroup || null,
        },
        schoolIds[0],
        season,
        year
      );
      setNewItemName('');
      setNewItemType('check');
      setNewItemGroup('');
      await fetchData();
    } catch (err) {
      console.error('Error creating item:', err);
      setErrorMessage(getUserErrorMessage(err, '項目の作成に失敗しました'));
    }
  }, [newItemName, newItemType, newItemGroup, getSelectedSchoolIds, season, year, fetchData]);

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
            {isManagerOrAbove && (
              <>
                <button
                  onClick={handleOpenTemplateDialog}
                  className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600"
                >
                  テンプレート適用
                </button>
                <button
                  onClick={() => setShowItemManager(!showItemManager)}
                  className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600"
                >
                  {showItemManager ? '項目管理を閉じる' : '項目管理'}
                </button>
                <button
                  onClick={handleSyncCalendar}
                  disabled={syncing}
                  className="px-3 py-1.5 text-xs border border-blue-200 rounded-lg hover:bg-blue-50 text-blue-600 disabled:opacity-50"
                  title="Googleカレンダーの面談予約を取得して進捗を同期"
                >
                  {syncing ? '同期中...' : '📅 面談同期'}
                </button>
              </>
            )}
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
            onBudgetKomaChange={isManagerOrAbove ? handleBudgetKomaChange : undefined}
          />
        )}

        {/* フィルター */}
        <div className="mb-4 bg-white rounded-xl border border-gray-200 p-4">
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
            {isManagerOrAbove && (
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
        </div>

        {/* 項目管理パネル（教室長以上のみ） */}
        {showItemManager && isManagerOrAbove && (
          <div className="mb-4 bg-white rounded-xl border border-gray-200 p-4">
            <h4 className="text-sm font-bold text-[#1e3a5f] mb-3">項目管理</h4>

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
              <button
                onClick={handleAddItem}
                disabled={!newItemName.trim()}
                className="px-3 py-1.5 text-xs bg-[#1e3a5f] text-white rounded-lg hover:bg-[#2c5282] disabled:opacity-50"
              >
                追加
              </button>
            </div>

            {/* 既存項目一覧 */}
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {items.map((item) => (
                <div
                  key={item.id}
                  className={`flex items-center justify-between gap-2 px-2 py-1.5 rounded text-xs ${
                    item.is_hidden ? 'bg-gray-50 text-gray-400' : ''
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{item.name}</span>
                    <span className="text-[10px] text-gray-400">
                      {item.column_type === 'check'
                        ? 'チェック'
                        : item.column_type === 'number'
                        ? '数値'
                        : '日付'}
                    </span>
                    {item.column_group && (
                      <span
                        className="text-[9px] px-1 py-0.5 rounded"
                        style={{
                          backgroundColor:
                            (PROGRESS_COLUMN_GROUPS[item.column_group]?.color || '#6b7280') + '20',
                          color: PROGRESS_COLUMN_GROUPS[item.column_group]?.color || '#6b7280',
                        }}
                      >
                        {PROGRESS_COLUMN_GROUPS[item.column_group]?.label || item.column_group}
                      </span>
                    )}
                    {item.is_hidden && (
                      <span className="text-[9px] px-1 py-0.5 bg-gray-200 text-gray-500 rounded">
                        非表示
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
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
              ))}
              {items.length === 0 && (
                <p className="text-xs text-gray-400 text-center py-4">
                  項目がありません。テンプレートから作成するか、手動で追加してください。
                </p>
              )}
            </div>
          </div>
        )}

        {/* 説明 */}
        {canEdit && displayItems.length > 0 && (
          <div className="mb-4 text-[#4b5563] text-xs">
            <p>セルをクリックして進捗を切り替えます: 空白 → ×(未完了) → ✓(完了) → -(対象外) → 空白</p>
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
          <CourseProgressTable
            students={filteredStudents}
            items={displayItems}
            progressData={progressData}
            canEdit={canEdit}
            onStatusChange={handleStatusChange}
            onNumberChange={handleNumberChange}
            onDateChange={handleDateChange}
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
        />
      )}
    </AdminLayout>
  );
}
