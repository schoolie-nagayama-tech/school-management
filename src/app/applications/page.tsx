'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { AdminLayout } from '@/components/layouts';
import { Button } from '@/components/ui';
import { ApplicationTable, ApplicationItemSettings, ApplicationFiltersPanel, ApplicationItemManager } from '@/components/applications';
import { StudentDetailModal } from '@/components/students';
import {
  getStudents,
} from '@/lib/api/students';
import {
  getApplicationItems,
  getStudentApplications,
} from '@/lib/api/applications';
import type {
  Student,
  ApplicationItem,
  StudentApplication,
  ApplicationStatus,
  ApplicationFilters,
} from '@/types/database';
import { useRequirePermission, useCanEdit } from '@/hooks/usePermissions';
import AccessDenied from '@/components/AccessDenied';
import { useAuth } from '@/contexts/AuthContext';

export default function ApplicationsPage() {
  // 権限チェック
  const { hasPermission, isLoading: permissionLoading } = useRequirePermission(
    (p) => p.canAccessApplications
  );

  // 編集権限
  const canEdit = useCanEdit('canEditApplications');
  const { getSelectedSchoolIds, selectedSchoolId, permissions } = useAuth();
  
  // 状態管理
  const [students, setStudents] = useState<Student[]>([]);
  const [items, setItems] = useState<ApplicationItem[]>([]);
  const [applications, setApplications] = useState<StudentApplication[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isItemManagerOpen, setIsItemManagerOpen] = useState(false);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  // フィルター状態
  const [filters, setFilters] = useState<ApplicationFilters>({
    search: '',
    grade: null,
    itemId: null,
    showHidden: false,
  });

  // データを取得
  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage('');
    try {
      const schoolIds = getSelectedSchoolIds();
      // 権限のある教室のみでフィルタリング
      if (schoolIds.length === 0) {
        setErrorMessage('教室が選択されていません');
        setIsLoading(false);
        return;
      }
      const [studentsData, itemsData, applicationsData] = await Promise.all([
        getStudents(undefined, schoolIds),
        getApplicationItems(schoolIds, filters.showHidden),
        getStudentApplications(schoolIds),
      ]);
      setStudents(studentsData);
      setItems(itemsData);
      setApplications(applicationsData);
    } catch (error) {
      console.error('Error fetching data:', error);
      setErrorMessage(
        error instanceof Error ? error.message : 'データの取得に失敗しました'
      );
    } finally {
      setIsLoading(false);
    }
  }, [getSelectedSchoolIds, filters.showHidden]);

  // 初回読み込みと教室選択変更時の再読み込み
  useEffect(() => {
    if (selectedSchoolId !== null) {
      fetchData();
    }
  }, [fetchData, selectedSchoolId]);

  // フィルター適用
  const filteredStudents = useMemo(() => {
    let result = students;

    // 学年フィルター
    if (filters.grade !== null && filters.grade !== undefined) {
      result = result.filter((s) => s.grade === filters.grade);
    }

    // 検索フィルター
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      result = result.filter(
        (s) =>
          s.last_name.toLowerCase().includes(searchLower) ||
          s.first_name.toLowerCase().includes(searchLower) ||
          s.last_name_kana.toLowerCase().includes(searchLower) ||
          s.first_name_kana.toLowerCase().includes(searchLower) ||
          s.student_code?.toLowerCase().includes(searchLower)
      );
    }

    // 申込項目フィルター（特定の項目に申込済みの生徒のみ）
    if (filters.itemId) {
      result = result.filter((s) => {
        const app = applications.find(
          (a) => a.student_id === s.id && a.item_id === filters.itemId && a.status === 'completed'
        );
        return !!app;
      });
    }

    return result;
  }, [students, applications, filters]);

  // フィルター変更
  const handleFilterChange = (newFilters: Partial<ApplicationFilters>) => {
    setFilters((prev) => ({ ...prev, ...newFilters }));
  };

  // フィルターリセット
  const handleResetFilters = () => {
    setFilters({
      search: '',
      grade: null,
      itemId: null,
      showHidden: filters.showHidden, // showHiddenは保持
    });
  };

  // 申込状況が変更されたときの処理
  const handleStatusChange = useCallback(
    (studentId: string, itemId: string, status: ApplicationStatus | null) => {
      if (status === null) {
        // 削除
        setApplications((prev) =>
          prev.filter(
            (app) => !(app.student_id === studentId && app.item_id === itemId)
          )
        );
      } else {
        // 更新または追加
        setApplications((prev) => {
          const existing = prev.find(
            (app) => app.student_id === studentId && app.item_id === itemId
          );
          if (existing) {
            return prev.map((app) =>
              app.id === existing.id ? { ...app, status } : app
            );
          } else {
            // 新規作成（実際のIDはAPIから返されるが、ここでは仮のIDを使用）
            const newApp: StudentApplication = {
              id: `temp-${studentId}-${itemId}`,
              school_id: students.find((s) => s.id === studentId)?.school_id || '',
              student_id: studentId,
              item_id: itemId,
              status: status as any,
              number_value: null as any,
              date_value: null as any,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            } as StudentApplication;
            return [...prev, newApp];
          }
        });
      }
    },
    [students]
  );

  // 数値が変更されたときの処理
  const handleNumberChange = useCallback(
    (studentId: string, itemId: string, numberValue: number | null) => {
      if (numberValue === null) {
        // 削除
        setApplications((prev) =>
          prev.filter(
            (app) => !(app.student_id === studentId && app.item_id === itemId)
          )
        );
      } else {
        // 更新または追加
        setApplications((prev) => {
          const existing = prev.find(
            (app) => app.student_id === studentId && app.item_id === itemId
          );
          if (existing) {
            return prev.map((app) =>
              app.id === existing.id ? { ...app, number_value: numberValue } : app
            );
          } else {
            // 新規作成
            const newApp: StudentApplication = {
              id: `temp-${studentId}-${itemId}`,
              school_id: students.find((s) => s.id === studentId)?.school_id || '',
              student_id: studentId,
              item_id: itemId,
              status: null as any,
              number_value: numberValue as any,
              date_value: null as any,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            } as StudentApplication;
            return [...prev, newApp];
          }
        });
      }
    },
    [students]
  );

  // 日付が変更されたときの処理
  const handleDateChange = useCallback(
    (studentId: string, itemId: string, dateValue: string | null) => {
      if (dateValue === null) {
        // 削除
        setApplications((prev) =>
          prev.filter(
            (app) => !(app.student_id === studentId && app.item_id === itemId)
          )
        );
      } else {
        // 更新または追加
        setApplications((prev) => {
          const existing = prev.find(
            (app) => app.student_id === studentId && app.item_id === itemId
          );
          if (existing) {
            return prev.map((app) =>
              app.id === existing.id ? { ...app, date_value: dateValue } : app
            );
          } else {
            // 新規作成
            const newApp: StudentApplication = {
              id: `temp-${studentId}-${itemId}`,
              school_id: students.find((s) => s.id === studentId)?.school_id || '',
              student_id: studentId,
              item_id: itemId,
              status: null as any,
              number_value: null as any,
              date_value: dateValue as any,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            } as StudentApplication;
            return [...prev, newApp];
          }
        });
      }
    },
    [students]
  );

  // 項目設定が閉じられたときに再取得
  const handleSettingsClose = () => {
    setIsSettingsModalOpen(false);
    fetchData();
  };

  // 生徒詳細を開く
  const handleStudentClick = (student: Student) => {
    setSelectedStudent(student);
    setIsDetailModalOpen(true);
  };

  // 生徒詳細を閉じる
  const handleDetailClose = () => {
    setIsDetailModalOpen(false);
    setSelectedStudent(null);
  };

  // 権限チェック中
  if (permissionLoading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <div className="w-12 h-12 border-4 border-[#ff8e3c] border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-[#2a2a2a]">読み込み中...</p>
          </div>
        </div>
      </AdminLayout>
    );
  }

  // 権限なし
  if (!hasPermission) {
    return (
      <AdminLayout>
        <AccessDenied />
      </AdminLayout>
    );
  }

  return (
    <AdminLayout
      headerTitle="申込状況管理"
      headerOnSettingsClick={canEdit ? () => setIsItemManagerOpen(true) : undefined}
    >

      {/* エラーメッセージ */}
      {errorMessage && (
        <div className="mb-4 bg-[#d9376e]/20 text-[#d9376e] px-4 py-2 rounded border border-[#d9376e]">
          {errorMessage}
        </div>
      )}

      {/* フィルターパネル */}
      <ApplicationFiltersPanel
          filters={filters}
          items={items}
          onChange={handleFilterChange}
        onReset={handleResetFilters}
      />

      {/* 説明 */}
      {canEdit && (
        <div className="mb-4 text-[#2a2a2a] text-sm">
          <p>セルをクリックして申込状況を切り替えます: 空白 → ×（未申込）→ ✓（申込済）→ -（対象外）→ 空白</p>
        </div>
      )}
      {!canEdit && (
        <div className="mb-4 text-[#2a2a2a] text-sm">
          <p>申込状況を閲覧できます。編集するには編集権限が必要です。</p>
        </div>
      )}

      {/* テーブル */}
      {isLoading ? (
          <div className="bg-[#fffffe] rounded-xl border border-[#0d0d0d] p-8">
            <div className="flex items-center justify-center">
              <svg
                className="animate-spin h-8 w-8 text-[#ff8e3c]"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              <span className="ml-3 text-[#2a2a2a]">読み込み中...</span>
            </div>
          </div>
        ) : items.length === 0 ? (
          <div className="bg-[#fffffe] rounded-xl border border-[#0d0d0d] p-8 text-center">
            <p className="text-[#2a2a2a] mb-4">申込項目がありません。</p>
            {canEdit && (
              <Button onClick={() => setIsSettingsModalOpen(true)}>
                項目設定を開く
              </Button>
            )}
        </div>
      ) : (
        <ApplicationTable
          students={filteredStudents}
          items={items.filter((i) => filters.showHidden || !i.is_hidden)}
          applications={applications}
          onStatusChange={canEdit ? handleStatusChange : undefined}
          onNumberChange={canEdit ? handleNumberChange : undefined}
          onDateChange={canEdit ? handleDateChange : undefined}
          onStudentClick={handleStudentClick}
          onItemsChange={fetchData}
        />
      )}

      {/* 項目設定モーダル（既存）- 編集権限がある場合のみ表示 */}
      {canEdit && (
        <ApplicationItemSettings
          isOpen={isSettingsModalOpen}
          onClose={handleSettingsClose}
        />
      )}

      {/* 項目管理モーダル（新規）- 編集権限がある場合のみ表示 */}
      {canEdit && (() => {
        const schoolIds = getSelectedSchoolIds();
        // 複数教室が選択されている場合は最初の教室を使用（管理は単一教室のみ）
        const schoolId = schoolIds.length > 0 ? schoolIds[0] : null;
        if (!schoolId) return null;
        return (
          <ApplicationItemManager
            schoolId={schoolId}
            items={items}
            showHidden={filters.showHidden ?? false}
            isOpen={isItemManagerOpen}
            onClose={() => setIsItemManagerOpen(false)}
            onUpdated={fetchData}
          />
        );
      })()}

      {/* 生徒詳細モーダル */}
      {selectedStudent && (
        <StudentDetailModal
          isOpen={isDetailModalOpen}
          onClose={handleDetailClose}
          student={selectedStudent}
          onEdit={() => {
            // 編集は別ページで行うため、ここでは詳細を閉じるだけ
            handleDetailClose();
          }}
        />
      )}
    </AdminLayout>
  );
}
