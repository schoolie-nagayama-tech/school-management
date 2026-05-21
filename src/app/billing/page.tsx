'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { AdminLayout } from '@/components/layouts';
import { Loading, InlineLoading } from '@/components/ui';
import dynamic from 'next/dynamic';
import type { BillingFilters } from '@/components/billing';

const BillingPeriodSelector = dynamic(
  () => import('@/components/billing').then((m) => m.BillingPeriodSelector),
  { ssr: false }
);
const BillingTable = dynamic(
  () => import('@/components/billing').then((m) => m.BillingTable),
  { ssr: false }
);
const BillingItemAccordion = dynamic(
  () => import('@/components/billing').then((m) => m.BillingItemAccordion),
  { ssr: false }
);
const VocabBookStockCard = dynamic(
  () => import('@/components/billing').then((m) => m.VocabBookStockCard),
  { ssr: false }
);
const StudentDetailModal = dynamic(
  () => import('@/components/students/StudentDetailModal').then((m) => m.StudentDetailModal),
  { ssr: false }
);
import { getStudents } from '@/lib/api/students';
import {
  getBillingPeriods,
  getBillingItems,
  getStudentBillings,
} from '@/lib/api/billing';
import type {
  Student,
  BillingPeriod,
  BillingItem,
  StudentBilling,
} from '@/types/database';
import { GRADE_LABELS } from '@/types/database';
import { useRequirePermission, useCanEdit } from '@/hooks/usePermissions';
import AccessDenied from '@/components/AccessDenied';
import { useAuth } from '@/contexts/AuthContext';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';

export default function BillingPage() {
  // 権限チェック
  const { hasPermission, isLoading: permissionLoading } = useRequirePermission(
    (p) => p.canAccessBilling
  );

  // 編集権限
  const router = useRouter();
  const canEdit = useCanEdit('canEditBilling');
  const { getSelectedSchoolIds, selectedSchoolId, profile } = useAuth();

  // 教室長以上かどうかを判定
  const isManagerOrAbove = profile?.role === 'manager' || profile?.role === 'owner' || profile?.role === 'admin';

  // 状態管理
  const [students, setStudents] = useState<Student[]>([]);
  const [periods, setPeriods] = useState<BillingPeriod[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null);
  const [items, setItems] = useState<BillingItem[]>([]);
  const [billings, setBillings] = useState<StudentBilling[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  // 単語練習帳の在庫リフレッシュキー
  const [stockRefreshKey, setStockRefreshKey] = useState(0);

  // フィルター状態
  const [filters, setFilters] = useState<BillingFilters>({
    search: '',
    grade: null,
  });

  // 期間一覧と生徒一覧を取得
  const fetchBaseData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage('');
    try {
      const schoolIds = getSelectedSchoolIds();
      if (schoolIds.length === 0) {
        setErrorMessage('教室が選択されていません');
        setIsLoading(false);
        return;
      }
      const [studentsData, periodsData] = await Promise.all([
        getStudents(undefined, schoolIds),
        getBillingPeriods(schoolIds),
      ]);
      // 退会（withdrawn）の生徒は請求管理に表示しない
      setStudents(studentsData.filter((s) => s.status !== 'withdrawn'));
      setPeriods(periodsData);
    } catch (error) {
      console.error('Error fetching base data:', error);
      setErrorMessage(getUserErrorMessage(error, 'データの取得に失敗しました'));
    } finally {
      setIsLoading(false);
    }
  }, [getSelectedSchoolIds]);

  // 期間選択時に項目と請求状況を取得
  const fetchPeriodData = useCallback(async () => {
    if (!selectedPeriodId) {
      setItems([]);
      setBillings([]);
      return;
    }

    try {
      const schoolIds = getSelectedSchoolIds();
      if (schoolIds.length === 0) return;

      const [itemsData, billingsData] = await Promise.all([
        getBillingItems(selectedPeriodId, schoolIds),
        getStudentBillings(selectedPeriodId, schoolIds),
      ]);
      setItems(itemsData);
      setBillings(billingsData);
    } catch (error) {
      console.error('Error fetching period data:', error);
      setErrorMessage(getUserErrorMessage(error, '請求データの取得に失敗しました'));
    }
  }, [selectedPeriodId, getSelectedSchoolIds]);

  // 初回読み込みと教室選択変更時の再読み込み
  useEffect(() => {
    if (selectedSchoolId !== null) {
      fetchBaseData();
    }
  }, [fetchBaseData, selectedSchoolId]);

  // 期間一覧の更新時、未選択なら先頭を自動選択（fetchBaseDataのdepsから切り離してループを防ぐ）
  useEffect(() => {
    if (!selectedPeriodId && periods.length > 0) {
      setSelectedPeriodId(periods[0].id);
    }
  }, [periods, selectedPeriodId]);

  // 期間変更時に項目・請求状況を再取得
  useEffect(() => {
    if (selectedPeriodId) {
      fetchPeriodData();
    }
  }, [selectedPeriodId, fetchPeriodData]);

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

    return result;
  }, [students, filters.grade, filters.search]);

  // フィルター変更
  const handleFilterChange = (newFilters: Partial<BillingFilters>) => {
    setFilters((prev) => ({ ...prev, ...newFilters }));
  };

  // 請求状況が変更されたときの処理
  const handleBillingChange = useCallback(
    (studentId: string, billingItemId: string, isBilled: boolean) => {
      setBillings((prev) => {
        const existing = prev.find(
          (b) => b.student_id === studentId && b.billing_item_id === billingItemId
        );
        if (existing) {
          return prev.map((b) =>
            b.id === existing.id ? { ...b, is_billed: isBilled } : b
          );
        } else {
          // 新規作成（仮のID）
          const newBilling: StudentBilling = {
            id: `temp-${studentId}-${billingItemId}`,
            school_id: students.find((s) => s.id === studentId)?.school_id || '',
            student_id: studentId,
            billing_item_id: billingItemId,
            is_billed: isBilled,
            quantity: null,
            value_number: null,
            value_text: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          return [...prev, newBilling];
        }
      });
    },
    [students]
  );

  // 期間が更新されたときの処理
  const handlePeriodsUpdated = () => {
    fetchBaseData();
  };

  // 項目が更新されたときの処理
  const handleItemsUpdated = () => {
    fetchPeriodData();
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
        <Loading className="min-h-[60vh]" />
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

  const schoolIds = getSelectedSchoolIds();
  const currentSchoolIds = schoolIds.length > 0 ? schoolIds : null;

  return (
    <AdminLayout headerTitle="請求管理">
      {/* エラーメッセージ */}
      {errorMessage && (
        <div className="mb-4 bg-danger/20 text-danger px-4 py-2 rounded border border-danger">
          {errorMessage}
        </div>
      )}

      {/* 期間選択 + 検索 + 在庫カウンター（横一列） */}
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <BillingPeriodSelector
          periods={periods}
          selectedPeriodId={selectedPeriodId}
          onSelect={setSelectedPeriodId}
          schoolId={currentSchoolIds}
          onUpdated={handlePeriodsUpdated}
          canEdit={canEdit && isManagerOrAbove}
        />
        {selectedPeriodId && (
          <>
            <input
              type="text"
              placeholder="氏名・フリガナで検索"
              value={filters.search}
              onChange={(e) => handleFilterChange({ search: e.target.value })}
              className="w-48 px-3 py-1.5 border border-border rounded-lg text-sm bg-surface-raised placeholder-gray-400 focus:ring-2 focus:ring-ink/20 focus:border-ink"
            />
            <select
              value={filters.grade ?? ''}
              onChange={(e) => handleFilterChange({ grade: e.target.value ? Number(e.target.value) : null })}
              className="w-24 px-2 py-1.5 border border-border rounded-lg text-sm bg-surface-raised text-text-heading focus:ring-2 focus:ring-ink/20"
            >
              <option value="">全学年</option>
              {Array.from(new Set(students.map((s) => s.grade))).sort((a, b) => a - b).map((g) => (
                <option key={g} value={g}>{GRADE_LABELS[g] || g}</option>
              ))}
            </select>
          </>
        )}
        <div className="ml-auto">
          {selectedPeriodId && schoolIds.length > 0 && (
            <VocabBookStockCard
              schoolIds={schoolIds}
              refreshKey={stockRefreshKey}
            />
          )}
        </div>
      </div>

      {/* 項目管理アコーディオン（教室長以上のみ） */}
      {selectedPeriodId && isManagerOrAbove && currentSchoolIds && (
        <BillingItemAccordion
          schoolId={currentSchoolIds}
          periodId={selectedPeriodId}
          items={items}
          onUpdated={handleItemsUpdated}
        />
      )}

      {/* テーブル */}
      {!selectedPeriodId ? (
        <div className="bg-surface-raised rounded-xl border border-border p-8 text-center">
          <p className="text-text-body mb-4">
            {periods.length === 0
              ? '請求期間がありません。新しい期間を作成してください。'
              : '請求期間を選択してください。'}
          </p>
        </div>
      ) : isLoading ? (
        <div className="bg-surface-raised rounded-xl border border-border p-8">
          <InlineLoading />
        </div>
      ) : items.length === 0 ? (
        <div className="bg-surface-raised rounded-xl border border-border p-8 text-center">
          <p className="text-text-body mb-4">請求項目がありません。</p>
          {canEdit && isManagerOrAbove && (
            <p className="text-text-body text-sm">上の「項目管理」から請求項目を追加してください。</p>
          )}
        </div>
      ) : (
        <>
          <BillingTable
            students={filteredStudents}
            items={items}
            billings={billings}
            onBillingChange={canEdit ? handleBillingChange : undefined}
            onStudentClick={handleStudentClick}
            onItemsChange={handleItemsUpdated}
            periodStartDate={periods.find(p => p.id === selectedPeriodId)?.start_date}
            periodEndDate={periods.find(p => p.id === selectedPeriodId)?.end_date}
            schoolIds={getSelectedSchoolIds()}
            billingPeriodId={selectedPeriodId || undefined}
            billingPeriodName={periods.find(p => p.id === selectedPeriodId)?.name}
            onStockUpdated={() => setStockRefreshKey(prev => prev + 1)}
          />
        </>
      )}

      {/* 生徒詳細モーダル */}
      {selectedStudent && (
        <StudentDetailModal
          isOpen={isDetailModalOpen}
          onClose={handleDetailClose}
          student={selectedStudent}
          onEdit={() => {
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
