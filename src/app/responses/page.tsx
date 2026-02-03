'use client';

import { useState, useEffect, useCallback } from 'react';
import { AdminLayout } from '@/components/layouts';
import { getFormResponses, type FormResponseWithStudent } from '@/lib/api/form-responses';
import { getFormPeriods } from '@/lib/api/form-periods';
import { getDefaultSchoolId } from '@/lib/api/schools';
import type { FormType, FormPeriod } from '@/types/database';
import { FORM_TYPE_LABELS, GRADE_LABELS } from '@/types/database';
import { useRequirePermission } from '@/hooks/usePermissions';
import AccessDenied from '@/components/AccessDenied';
import { useAuth } from '@/contexts/AuthContext';
import Link from 'next/link';

// TODO: ResponseSummary, ResponseDetailModal, LinkStudentModalコンポーネントを作成

export default function ResponsesPage() {
  // 権限チェック
  const { hasPermission, isLoading: permissionLoading } = useRequirePermission(
    (p) => p.canAccessApplications
  );
  const { getSelectedSchoolIds, selectedSchoolId } = useAuth();
  const [responses, setResponses] = useState<FormResponseWithStudent[]>([]);
  const [formPeriods, setFormPeriods] = useState<FormPeriod[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  // フィルター
  const [filterFormType, setFilterFormType] = useState<FormType | 'all'>('all');
  const [filterPeriod, setFilterPeriod] = useState<string>('all');
  const [filterGrade, setFilterGrade] = useState<number | 'all'>('all');
  const [filterLinkedStatus, setFilterLinkedStatus] = useState<
    'all' | 'linked' | 'unlinked'
  >('all');

  // データ取得
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
      
      // 複数教室が選択されている場合は最初の教室を使用（フォーム回答は単一教室のみ対応）
      const schoolId = schoolIds[0];
      
      const filters: Parameters<typeof getFormResponses>[1] = {};
      if (filterFormType !== 'all') {
        filters.formType = filterFormType;
      }
      if (filterPeriod !== 'all') {
        filters.formPeriod = filterPeriod;
      }
      if (filterGrade !== 'all') {
        filters.grade = filterGrade;
      }
      if (filterLinkedStatus !== 'all') {
        filters.linkedStatus = filterLinkedStatus;
      }

      const [responsesData, periodsData] = await Promise.all([
        getFormResponses(schoolId, filters),
        filterFormType !== 'all'
          ? getFormPeriods(schoolId, filterFormType)
          : Promise.resolve([]),
      ]);

      setResponses(responsesData);
      setFormPeriods(periodsData);
    } catch (error) {
      console.error('Error fetching data:', error);
      setErrorMessage(
        error instanceof Error ? error.message : 'データの取得に失敗しました'
      );
    } finally {
      setIsLoading(false);
    }
  }, [getSelectedSchoolIds, filterFormType, filterPeriod, filterGrade, filterLinkedStatus]);

  useEffect(() => {
    if (selectedSchoolId !== null) {
      fetchData();
    }
  }, [fetchData, selectedSchoolId]);

  const formatDateTime = (date: string) => {
    const d = new Date(date);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  // サマリー計算
  const summary = (() => {
    const byFormType: Record<string, { total: number; unprocessed: number }> = {};
    responses.forEach((response) => {
      const key = `${response.form_type}_${response.form_period}`;
      if (!byFormType[key]) {
        byFormType[key] = { total: 0, unprocessed: 0 };
      }
      byFormType[key].total++;
      if (!response.linked_student_id) {
        byFormType[key].unprocessed++;
      }
    });
    return byFormType;
  })();

  // 権限チェック中
  if (permissionLoading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <div className="w-12 h-12 border-4 border-[#3b82f6] border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
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
    <AdminLayout headerTitle="回答管理">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {errorMessage && (
          <div className="mb-4 p-4 bg-[#ef4444]/20 border border-[#ef4444] rounded-lg">
            <p className="text-sm text-[#ef4444]">{errorMessage}</p>
          </div>
        )}

        {/* フィルター */}
        <div className="mb-6 bg-white rounded-xl border border-[#e5e7eb] p-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-[#1f2937] mb-2">
                フォーム種別
              </label>
              <select
                value={filterFormType}
                onChange={(e) => {
                  setFilterFormType(e.target.value as FormType | 'all');
                  setFilterPeriod('all');
                }}
                className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm bg-white text-[#4b5563] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]"
              >
                <option value="all">すべて</option>
                {Object.entries(FORM_TYPE_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-[#1f2937] mb-2">
                期間
              </label>
              <select
                value={filterPeriod}
                onChange={(e) => setFilterPeriod(e.target.value)}
                disabled={filterFormType === 'all' || formPeriods.length === 0}
                className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm bg-white text-[#4b5563] focus:outline-none focus:ring-2 focus:ring-[#3b82f6] disabled:bg-[#f3f4f6] disabled:cursor-not-allowed"
              >
                <option value="all">すべて</option>
                {formPeriods.map((period) => (
                  <option key={period.period_key} value={period.period_key}>
                    {period.period_key} {period.title}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-[#1f2937] mb-2">
                学年
              </label>
              <select
                value={filterGrade}
                onChange={(e) =>
                  setFilterGrade(
                    e.target.value === 'all' ? 'all' : parseInt(e.target.value, 10)
                  )
                }
                className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm bg-white text-[#4b5563] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]"
              >
                <option value="all">すべて</option>
                {Object.entries(GRADE_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-[#1f2937] mb-2">
                処理状態
              </label>
              <select
                value={filterLinkedStatus}
                onChange={(e) =>
                  setFilterLinkedStatus(e.target.value as 'all' | 'linked' | 'unlinked')
                }
                className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm bg-white text-[#4b5563] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]"
              >
                <option value="all">すべて</option>
                <option value="linked">紐付け済み</option>
                <option value="unlinked">未紐付け</option>
              </select>
            </div>
          </div>
        </div>

        {/* サマリー */}
        {Object.keys(summary).length > 0 && (
          <div className="mb-6 bg-white rounded-xl border border-[#e5e7eb] p-4">
            <h2 className="text-lg font-bold text-[#1f2937] mb-3">サマリー</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {Object.entries(summary).map(([key, stats]) => {
                const [formType, periodKey] = key.split('_');
                const period = formPeriods.find((p) => p.period_key === periodKey);
                return (
                  <div
                    key={key}
                    className="p-3 bg-[#f3f4f6] rounded-lg border border-[#e5e7eb]"
                  >
                    <div className="text-sm font-medium text-[#1f2937]">
                      {FORM_TYPE_LABELS[formType as FormType]} ({periodKey}
                      {period ? ` ${period.title}` : ''})
                    </div>
                    <div className="text-xs text-[#4b5563] mt-1">
                      {stats.total}件（未処理: {stats.unprocessed}件）
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 回答一覧 */}
        <div className="bg-white rounded-xl border border-[#e5e7eb] p-6">
          <h2 className="text-lg font-bold text-[#1f2937] mb-4">回答一覧</h2>
          {isLoading ? (
            <div className="text-center py-8 text-[#4b5563]">読み込み中...</div>
          ) : responses.length === 0 ? (
            <div className="text-center py-8 text-[#4b5563]">回答がありません</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse border border-[#e5e7eb] text-sm">
                <thead>
                  <tr className="bg-[#f3f4f6]">
                    <th className="border border-[#e5e7eb] px-4 py-3 text-left">
                      日時
                    </th>
                    <th className="border border-[#e5e7eb] px-4 py-3 text-left">
                      種別
                    </th>
                    <th className="border border-[#e5e7eb] px-4 py-3 text-left">
                      期間
                    </th>
                    <th className="border border-[#e5e7eb] px-4 py-3 text-left">
                      生徒名
                    </th>
                    <th className="border border-[#e5e7eb] px-4 py-3 text-left">
                      学年
                    </th>
                    <th className="border border-[#e5e7eb] px-4 py-3 text-center">
                      処理状態
                    </th>
                    <th className="border border-[#e5e7eb] px-4 py-3 text-left">
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {responses.map((response) => (
                    <tr key={response.id} className="table-row-hover">
                      <td className="border border-[#e5e7eb] px-4 py-3">
                        {formatDateTime(response.created_at)}
                      </td>
                      <td className="border border-[#e5e7eb] px-4 py-3">
                        {FORM_TYPE_LABELS[response.form_type]}
                      </td>
                      <td className="border border-[#e5e7eb] px-4 py-3">
                        {response.form_period}
                      </td>
                      <td className="border border-[#e5e7eb] px-4 py-3">
                        {response.linked_student
                          ? `${response.linked_student.last_name} ${response.linked_student.first_name}`
                          : response.student_name}
                      </td>
                      <td className="border border-[#e5e7eb] px-4 py-3">
                        {GRADE_LABELS[response.grade] || response.grade}
                      </td>
                      <td className="border border-[#e5e7eb] px-4 py-3 text-center">
                        {response.linked_student_id ? (
                          <span className="px-2 py-1 bg-green-100 text-green-800 rounded text-xs font-medium">
                            紐付け済み
                          </span>
                        ) : (
                          <span className="px-2 py-1 bg-yellow-100 text-yellow-800 rounded text-xs font-medium">
                            未処理
                          </span>
                        )}
                      </td>
                      <td className="border border-[#e5e7eb] px-4 py-3">
                        <div className="flex gap-2">
                          <Link
                            href={`/forms/responses/${response.form_type}/${response.form_period}`}
                            className="text-sm text-[#4b5563] hover:text-[#1f2937]"
                          >
                            詳細
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
