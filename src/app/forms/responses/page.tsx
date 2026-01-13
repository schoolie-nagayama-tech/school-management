'use client';

import { useState, useEffect, useCallback } from 'react';
import { AppHeader } from '@/components/layout';
import { getFormResponses, type FormResponseWithStudent } from '@/lib/api/form-responses';
import { getFormPeriods } from '@/lib/api/form-periods';
import type { FormType, FormPeriod } from '@/types/database';
import { FORM_TYPE_LABELS, GRADE_LABELS } from '@/types/database';

// TODO: ResponseTable, ResponseDetailModal, LinkStudentModalコンポーネントを作成

export default function FormResponsesPage() {
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
        getFormResponses(undefined, filters),
        filterFormType !== 'all'
          ? getFormPeriods(undefined, filterFormType)
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
  }, [filterFormType, filterPeriod, filterGrade, filterLinkedStatus]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  };

  return (
    <div className="min-h-screen bg-[#eff0f3]">
      <AppHeader title="フォーム回答" />

      {/* メインコンテンツ */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* エラーメッセージ */}
        {errorMessage && (
          <div className="mb-6 p-4 bg-[#d9376e]/10 border border-[#d9376e] rounded-lg">
            <p className="text-sm text-[#d9376e]">{errorMessage}</p>
          </div>
        )}

        {/* フィルター */}
        <div className="mb-6 bg-[#fffffe] rounded-xl border border-[#0d0d0d] p-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-[#0d0d0d] mb-2">
                フォーム種別
              </label>
              <select
                value={filterFormType}
                onChange={(e) => {
                  setFilterFormType(e.target.value as FormType | 'all');
                  setFilterPeriod('all'); // 期間もリセット
                }}
                className="w-full px-3 py-2 border border-[#0d0d0d] rounded-lg text-sm bg-[#fffffe] text-[#2a2a2a]"
              >
                <option value="all">全て</option>
                {Object.entries(FORM_TYPE_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-[#0d0d0d] mb-2">
                期間
              </label>
              <select
                value={filterPeriod}
                onChange={(e) => setFilterPeriod(e.target.value)}
                className="w-full px-3 py-2 border border-[#0d0d0d] rounded-lg text-sm bg-[#fffffe] text-[#2a2a2a]"
                disabled={filterFormType === 'all'}
              >
                <option value="all">全て</option>
                {formPeriods.map((period) => (
                  <option key={period.id} value={period.period_key}>
                    {period.title}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-[#0d0d0d] mb-2">
                学年
              </label>
              <select
                value={filterGrade}
                onChange={(e) =>
                  setFilterGrade(
                    e.target.value === 'all' ? 'all' : Number(e.target.value)
                  )
                }
                className="w-full px-3 py-2 border border-[#0d0d0d] rounded-lg text-sm bg-[#fffffe] text-[#2a2a2a]"
              >
                <option value="all">全て</option>
                {Array.from({ length: 13 }, (_, i) => i + 1).map((grade) => (
                  <option key={grade} value={grade}>
                    {GRADE_LABELS[grade]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-[#0d0d0d] mb-2">
                紐付け状態
              </label>
              <select
                value={filterLinkedStatus}
                onChange={(e) =>
                  setFilterLinkedStatus(
                    e.target.value as 'all' | 'linked' | 'unlinked'
                  )
                }
                className="w-full px-3 py-2 border border-[#0d0d0d] rounded-lg text-sm bg-[#fffffe] text-[#2a2a2a]"
              >
                <option value="all">全て</option>
                <option value="linked">紐付け済み</option>
                <option value="unlinked">未紐付け</option>
              </select>
            </div>
          </div>
        </div>

        {/* 回答一覧 */}
        <div className="bg-[#fffffe] rounded-xl border border-[#0d0d0d] overflow-hidden">
          {isLoading ? (
            <div className="p-8 text-center">
              <p className="text-[#2a2a2a]">読み込み中...</p>
            </div>
          ) : responses.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-[#2a2a2a]">回答がありません</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-[#eff0f3] border-b border-[#0d0d0d]">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[#0d0d0d] uppercase">
                      回答日時
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[#0d0d0d] uppercase">
                      種別
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[#0d0d0d] uppercase">
                      期間
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[#0d0d0d] uppercase">
                      生徒名
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[#0d0d0d] uppercase">
                      学年
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[#0d0d0d] uppercase">
                      紐付け
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[#0d0d0d] uppercase">
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {responses.map((response) => (
                    <tr
                      key={response.id}
                      className="border-b border-[#0d0d0d]/20 hover:bg-[#eff0f3]"
                    >
                      <td className="px-4 py-3 text-sm text-[#2a2a2a]">
                        {formatDate(response.created_at)}
                      </td>
                      <td className="px-4 py-3 text-sm text-[#2a2a2a]">
                        {FORM_TYPE_LABELS[response.form_type]}
                      </td>
                      <td className="px-4 py-3 text-sm text-[#2a2a2a]">
                        {response.form_period}
                      </td>
                      <td className="px-4 py-3 text-sm text-[#0d0d0d] font-medium">
                        {response.linked_student
                          ? `${response.linked_student.last_name} ${response.linked_student.first_name}`
                          : response.student_name}
                      </td>
                      <td className="px-4 py-3 text-sm text-[#2a2a2a]">
                        {GRADE_LABELS[response.grade] || response.grade}
                      </td>
                      <td className="px-4 py-3 text-sm text-[#2a2a2a]">
                        {response.linked_student_id ? (
                          <span className="text-[#0d0d0d] font-medium">済</span>
                        ) : (
                          <span className="text-[#2a2a2a]/60">未</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <button
                            className="px-3 py-1 text-xs bg-[#eff0f3] text-[#2a2a2a] rounded hover:bg-[#0d0d0d]/10"
                            onClick={() => {
                              // TODO: 詳細モーダルを開く
                              alert('詳細機能は実装中です');
                            }}
                          >
                            詳細
                          </button>
                          <button
                            className="px-3 py-1 text-xs bg-[#eff0f3] text-[#2a2a2a] rounded hover:bg-[#0d0d0d]/10"
                            onClick={() => {
                              // TODO: 紐付けモーダルを開く
                              alert('紐付け機能は実装中です');
                            }}
                          >
                            {response.linked_student_id ? '解除' : '紐付け'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
