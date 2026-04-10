'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { AdminLayout } from '@/components/layouts';
import { ApplicationTable, ApplicationFiltersPanel, ApplicationItemAccordion } from '@/components/applications';
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
import { getUserErrorMessage } from '@/lib/utils/errorMessages';

export default function ApplicationsPage() {
  // 権限チェック
  const { hasPermission, isLoading: permissionLoading } = useRequirePermission(
    (p) => p.canAccessApplications
  );

  // 編集権限
  const router = useRouter();
  const canEdit = useCanEdit('canEditApplications');
  const { getSelectedSchoolIds, selectedSchoolId, profile } = useAuth();
  
  // 教室長以上かどうかを判定（manager, owner, admin）
  const isManagerOrAbove = profile?.role === 'manager' || profile?.role === 'owner' || profile?.role === 'admin';
  
  // 状態管理
  const [students, setStudents] = useState<Student[]>([]);
  const [items, setItems] = useState<ApplicationItem[]>([]);
  const [applications, setApplications] = useState<StudentApplication[]>([]);
  const [isLoading, setIsLoading] = useState(true);
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
      // 退会（withdrawn）の生徒は申込状況に表示しない
      setStudents(studentsData.filter((s) => s.status !== 'withdrawn'));
      setItems(itemsData);
      setApplications(applicationsData);
    } catch (error) {
      console.error('Error fetching data:', error);
      setErrorMessage(
        getUserErrorMessage(error, 'データの取得に失敗しました')
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

  // 講師の場合は室長以上のみ表示の列を除外
  const displayItems = useMemo(() => {
    if (profile?.role === 'teacher') {
      return items.filter((i) => !i.manager_only);
    }
    return items;
  }, [items, profile?.role]);

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
  }, [students, applications, filters.grade, filters.search, filters.itemId]);

  // 表示用項目（非表示除外はテーブル側で適用）
  const tableItems = useMemo(
    () => displayItems.filter((i) => filters.showHidden || !i.is_hidden),
    [displayItems, filters.showHidden]
  );

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
              status,
              number_value: null,
              date_value: null,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };
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
              status: null,
              number_value: numberValue,
              date_value: null,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };
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
              status: null,
              number_value: null,
              date_value: dateValue,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };
            return [...prev, newApp];
          }
        });
      }
    },
    [students]
  );

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
            <div className="w-12 h-12 border-4 border-[#1e3a5f] border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-[#4b5563]">読み込み中...</p>
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
    >

      {/* エラーメッセージ */}
      {errorMessage && (
        <div className="mb-4 bg-[#ef4444]/20 text-[#ef4444] px-4 py-2 rounded border border-[#ef4444]">
          {errorMessage}
        </div>
      )}

      {/* フィルターパネル */}
      <ApplicationFiltersPanel
          filters={filters}
          items={displayItems}
          onChange={handleFilterChange}
        onReset={handleResetFilters}
      />

      {/* 項目管理アコーディオン（教室長以上のみ） */}
      {isManagerOrAbove && (() => {
        const schoolIds = getSelectedSchoolIds();
        const schoolId = schoolIds.length > 0 ? schoolIds[0] : null;
        if (!schoolId) return null;
        return (
          <ApplicationItemAccordion
            schoolId={schoolId}
            items={items}
            onUpdated={fetchData}
          />
        );
      })()}

      {/* 説明 */}
      {canEdit && (
        <div className="mb-4 text-[#4b5563] text-sm">
          <p>セルをクリックして申込状況を切り替えます: 空白 → ×（未申込）→ ✓（申込済）→ -（対象外）→ 空白</p>
        </div>
      )}
      {!canEdit && (
        <div className="mb-4 text-[#4b5563] text-sm">
          <p>申込状況を閲覧できます。編集するには編集権限が必要です。</p>
        </div>
      )}

      {/* テーブル */}
      {isLoading ? (
          <div className="bg-white rounded-xl border border-[#e5e7eb] p-8">
            <div className="flex items-center justify-center">
              <svg
                className="animate-spin h-8 w-8 text-[#1e3a5f]"
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
              <span className="ml-3 text-[#4b5563]">読み込み中...</span>
            </div>
          </div>
        ) : tableItems.length === 0 ? (
          <div className="bg-white rounded-xl border border-[#e5e7eb] p-8 text-center">
            <p className="text-[#4b5563]">申込項目がありません。</p>
            {canEdit && isManagerOrAbove && (
              <p className="text-[#4b5563]/80 text-sm mt-2">
                上部の「項目管理」から新しい項目を追加してください。
              </p>
            )}
        </div>
      ) : (
        <ApplicationTable
          students={filteredStudents}
          items={tableItems}
          applications={applications}
          onStatusChange={canEdit ? handleStatusChange : undefined}
          onNumberChange={canEdit ? handleNumberChange : undefined}
          onDateChange={canEdit ? handleDateChange : undefined}
          onStudentClick={handleStudentClick}
          onItemsChange={fetchData}
        />
      )}

      {/* 生徒詳細モーダル */}
      {selectedStudent && (
        <StudentDetailModal
          isOpen={isDetailModalOpen}
          onClose={handleDetailClose}
          student={selectedStudent}
          onEdit={() => {
            // 生徒管理ページで編集
            const studentId = selectedStudent?.id;
            handleDetailClose();
            if (studentId) {
              router.push(`/students?edit=${studentId}`);
            }
          }}
        />
      )}
    </AdminLayout>
  );
}
