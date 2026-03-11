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

  // テーブル並べ替え（列クリックでソート）
  type SortKey = 'created_at' | 'form_type' | 'form_period' | 'student_name' | 'grade' | 'linked';
  const [sortKey, setSortKey] = useState<SortKey>('created_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortOrder('asc');
    }
  };

  const sortedResponses = [...responses].sort((a, b) => {
    let cmp = 0;
    switch (sortKey) {
      case 'created_at':
        cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        break;
      case 'form_type':
        cmp = (FORM_TYPE_LABELS[a.form_type] || '').localeCompare(FORM_TYPE_LABELS[b.form_type] || '', 'ja');
        break;
      case 'form_period':
        cmp = (a.form_period || '').localeCompare(b.form_period || '', 'ja');
        break;
      case 'student_name': {
        const nameA = a.linked_student
          ? `${a.linked_student.last_name} ${a.linked_student.first_name}`
          : a.student_name;
        const nameB = b.linked_student
          ? `${b.linked_student.last_name} ${b.linked_student.first_name}`
          : b.student_name;
        cmp = nameA.localeCompare(nameB, 'ja');
        break;
      }
      case 'grade':
        cmp = a.grade - b.grade;
        break;
      case 'linked':
        cmp = (a.linked_student_id ? 1 : 0) - (b.linked_student_id ? 1 : 0);
        break;
      default:
        break;
    }
    return sortOrder === 'asc' ? cmp : -cmp;
  });

  const SortableTh = ({
    label,
    sortKey: key,
  }: {
    label: string;
    sortKey: SortKey;
  }) => (
    <th
      className="px-4 py-3 text-left text-xs font-semibold text-[#1f2937] uppercase cursor-pointer select-none hover:bg-[#e5e7eb] transition-colors"
      onClick={() => handleSort(key)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {sortKey === key ? (
          sortOrder === 'asc' ? (
            <span className="text-[#3b82f6]">↑</span>
          ) : (
            <span className="text-[#3b82f6]">↓</span>
          )
        ) : (
          <span className="text-[#9ca3af]">↕</span>
        )}
      </span>
    </th>
  );

  return (
    <div className="min-h-screen bg-[#f3f4f6]">
      <AppHeader title="フォーム回答" />

      {/* メインコンテンツ */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* エラーメッセージ */}
        {errorMessage && (
          <div className="mb-6 p-4 bg-[#ef4444]/10 border border-[#ef4444] rounded-lg">
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
                  setFilterPeriod('all'); // 期間もリセット
                }}
                className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm bg-white text-[#4b5563]"
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
              <label className="block text-sm font-medium text-[#1f2937] mb-2">
                期間
              </label>
              <select
                value={filterPeriod}
                onChange={(e) => setFilterPeriod(e.target.value)}
                className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm bg-white text-[#4b5563]"
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
              <label className="block text-sm font-medium text-[#1f2937] mb-2">
                学年
              </label>
              <select
                value={filterGrade}
                onChange={(e) =>
                  setFilterGrade(
                    e.target.value === 'all' ? 'all' : Number(e.target.value)
                  )
                }
                className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm bg-white text-[#4b5563]"
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
              <label className="block text-sm font-medium text-[#1f2937] mb-2">
                紐付け状態
              </label>
              <select
                value={filterLinkedStatus}
                onChange={(e) =>
                  setFilterLinkedStatus(
                    e.target.value as 'all' | 'linked' | 'unlinked'
                  )
                }
                className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm bg-white text-[#4b5563]"
              >
                <option value="all">全て</option>
                <option value="linked">紐付け済み</option>
                <option value="unlinked">未紐付け</option>
              </select>
            </div>
          </div>
        </div>

        {/* 回答一覧 */}
        <div className="bg-white rounded-xl border border-[#e5e7eb] overflow-hidden">
          {isLoading ? (
            <div className="p-8 text-center">
              <p className="text-[#4b5563]">読み込み中...</p>
            </div>
          ) : responses.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-[#4b5563]">回答がありません</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-[#f3f4f6] border-b border-[#e5e7eb]">
                    <SortableTh label="回答日時" sortKey="created_at" />
                    <SortableTh label="種別" sortKey="form_type" />
                    <SortableTh label="期間" sortKey="form_period" />
                    <SortableTh label="生徒名" sortKey="student_name" />
                    <SortableTh label="学年" sortKey="grade" />
                    <SortableTh label="紐付け" sortKey="linked" />
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[#1f2937] uppercase">
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedResponses.map((response) => (
                    <tr
                      key={response.id}
                      className="border-b border-[#e5e7eb]/20 hover:bg-[#f3f4f6]"
                    >
                      <td className="px-4 py-3 text-sm text-[#4b5563]">
                        {formatDate(response.created_at)}
                      </td>
                      <td className="px-4 py-3 text-sm text-[#4b5563]">
                        {FORM_TYPE_LABELS[response.form_type]}
                      </td>
                      <td className="px-4 py-3 text-sm text-[#4b5563]">
                        {response.form_period}
                      </td>
                      <td className="px-4 py-3 text-sm text-[#1f2937] font-medium">
                        {response.linked_student
                          ? `${response.linked_student.last_name} ${response.linked_student.first_name}`
                          : response.student_name}
                      </td>
                      <td className="px-4 py-3 text-sm text-[#4b5563]">
                        {GRADE_LABELS[response.grade] || response.grade}
                      </td>
                      <td className="px-4 py-3 text-sm text-[#4b5563]">
                        {response.linked_student_id ? (
                          <span className="text-[#1f2937] font-medium">済</span>
                        ) : (
                          <span className="text-[#4b5563]/60">未</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <button
                            className="px-3 py-1 text-xs bg-[#f3f4f6] text-[#4b5563] rounded hover:bg-[#e5e7eb]"
                            onClick={() => {
                              // TODO: 詳細モーダルを開く
                              alert('詳細機能は実装中です');
                            }}
                          >
                            詳細
                          </button>
                          <button
                            className="px-3 py-1 text-xs bg-[#f3f4f6] text-[#4b5563] rounded hover:bg-[#e5e7eb]"
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
