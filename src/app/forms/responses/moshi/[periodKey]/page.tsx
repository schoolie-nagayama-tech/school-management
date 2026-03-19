'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { AdminLayout } from '@/components/layouts';
import {
  getMoshiResponses,
  getMoshiStats,
  updateMoshiChargedStatus,
  updateMoshiOrderStatus,
} from '@/lib/api/moshi';
import {
  unlinkResponseFromStudent,
  getArchivedCount,
  archiveResponse,
  unarchiveResponse,
  archiveResponses,
} from '@/lib/api/form-responses';
import { getStudents } from '@/lib/api/students';
import { LinkStudentModal } from '@/components/forms/LinkStudentModal';
import { useToast } from '@/hooks/useToast';
import { useConfirm } from '@/hooks/useConfirm';
import { ToastContainer } from '@/components/ui';
import type { MoshiResponse, MoshiResponseFilters } from '@/types/forms/moshi';
import type { Student } from '@/types/database';
import { getDefaultSchoolId } from '@/lib/api/schools';
import { useAuth } from '@/contexts/AuthContext';
import { MOSHI_GRADE_NUMBER_TO_NAME } from '@/types/forms/moshi';
import { MoshiStats } from '@/components/forms/moshi/MoshiStats';
import { MoshiResponseDetailModal } from '@/components/forms/moshi/MoshiResponseDetailModal';

export default function MoshiResponsePage() {
  const params = useParams();
  const periodKey = (params?.periodKey as string) || '';
  const { getSelectedSchoolIds } = useAuth();
  const [responses, setResponses] = useState<MoshiResponse[]>([]);
  const [stats, setStats] = useState({
    total_responses: 0,
    regular_count: 0,
    furikae_count: 0,
    charged_count: 0,
    linked_count: 0,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [linkingResponse, setLinkingResponse] = useState<MoshiResponse | null>(null);
  const [detailResponse, setDetailResponse] = useState<MoshiResponse | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [isLoadingStudents, setIsLoadingStudents] = useState(false);
  const { toasts, removeToast, success, error } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();

  // フィルター
  const [filterGrade, setFilterGrade] = useState<number | 'all'>('all');
  const [filterExamType, setFilterExamType] = useState<'all' | 'regular' | 'furikae'>('all');
  const [filterChargedStatus, setFilterChargedStatus] = useState<
    'all' | 'charged' | 'not_charged'
  >('all');
  const [filterLinkedStatus, setFilterLinkedStatus] = useState<
    'all' | 'linked' | 'unlinked'
  >('all');
  const [showArchived, setShowArchived] = useState(false);
  const [archivedCount, setArchivedCount] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isProcessing, setIsProcessing] = useState(false);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage('');
    try {
      const schoolIds = getSelectedSchoolIds();
      const schoolId = schoolIds.length > 0 ? schoolIds[0] : getDefaultSchoolId();
      const filters: MoshiResponseFilters = {
        grade: filterGrade === 'all' ? undefined : filterGrade,
        examType: filterExamType === 'all' ? undefined : filterExamType,
        chargedStatus: filterChargedStatus === 'all' ? undefined : filterChargedStatus,
        linkedStatus: filterLinkedStatus === 'all' ? undefined : filterLinkedStatus,
        showArchived,
      };

      const [responsesData, statsData, archivedCountData] = await Promise.all([
        getMoshiResponses(schoolId, periodKey, filters),
        getMoshiStats(schoolId, periodKey),
        getArchivedCount(schoolId, 'moshi', periodKey),
      ]);

      setResponses(responsesData);
      setStats(statsData);
      setArchivedCount(archivedCountData);
    } catch (error) {
      console.error('Error fetching moshi responses:', error);
      setErrorMessage(
        error instanceof Error ? error.message : '回答一覧の取得に失敗しました'
      );
    } finally {
      setIsLoading(false);
    }
  }, [getSelectedSchoolIds, periodKey, filterGrade, filterExamType, filterChargedStatus, filterLinkedStatus, showArchived]);

  useEffect(() => {
    if (periodKey) {
      fetchData();
    }
  }, [fetchData, periodKey]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  };

  const formatExamType = (response: MoshiResponse): string => {
    if (response.response_data.exam_type === 'regular') {
      return '通常受験';
    } else {
      const date = response.response_data.furikae_date_label || response.response_data.furikae_date || '';
      const time = response.response_data.furikae_time || '';
      return `振替 ${date} ${time}`;
    }
  };

  // 計上状態の更新（APIで既存 status_checks をマージして保存し、成功時にサマリーも即時反映）
  const handleChargedToggle = async (responseId: string, charged: boolean) => {
    const prevResponses = responses;
    const prevStats = stats;
    setResponses((prev) =>
      prev.map((r) =>
        r.id === responseId
          ? { ...r, status_checks: { ...r.status_checks, charged } }
          : r
      )
    );
    setStats((s) => ({
      ...s,
      charged_count: s.charged_count + (charged ? 1 : -1),
    }));
    try {
      await updateMoshiChargedStatus(responseId, charged);
      await fetchData();
      success(`${charged ? '計上' : '計上解除'}しました`);
    } catch (err) {
      console.error('Error updating charged status:', err);
      setResponses(prevResponses);
      setStats(prevStats);
      error(
        err instanceof Error
          ? err.message
          : '計上状態の更新に失敗しました'
      );
    }
  };

  // 発注状態の更新（既存 status_checks をマージ）
  const handleOrderToggle = async (responseId: string, order: boolean) => {
    const prevResponses = responses;
    setResponses((prev) =>
      prev.map((r) =>
        r.id === responseId
          ? { ...r, status_checks: { ...r.status_checks, order } }
          : r
      )
    );
    try {
      await updateMoshiOrderStatus(responseId, order);
      await fetchData();
      success(`${order ? '発注' : '発注解除'}しました`);
    } catch (err) {
      console.error('Error updating order status:', err);
      setResponses(prevResponses);
      error(
        err instanceof Error
          ? err.message
          : '発注状態の更新に失敗しました'
      );
    }
  };

  // 紐付けモーダルを開く
  const handleOpenLinkModal = async (response: MoshiResponse) => {
    setLinkingResponse(response);
    setIsLoadingStudents(true);
    try {
      // 同じ教室・同じ学年の生徒を取得（教室間で混ざらないようにする）
      const allStudents = await getStudents(undefined, [response.school_id]);
      const sameGradeStudents = allStudents.filter(
        (s) => s.grade === response.grade && s.status === 'active'
      );
      setStudents(sameGradeStudents);
    } catch (err) {
      console.error('Error fetching students:', err);
      error('生徒一覧の取得に失敗しました');
    } finally {
      setIsLoadingStudents(false);
    }
  };

  // 紐付けモーダルの成功コールバック
  const handleLinkSuccess = async () => {
    await fetchData();
    setLinkingResponse(null);
    success('生徒に紐付けました');
  };

  // 紐付けを解除
  const handleUnlinkStudent = async (responseId: string) => {
    try {
      await unlinkResponseFromStudent(responseId);
      await fetchData();
      success('紐付けを解除しました');
    } catch (err) {
      console.error('Error unlinking student:', err);
      error(
        err instanceof Error ? err.message : '紐付け解除に失敗しました'
      );
    }
  };

  // アーカイブ操作
  const handleArchive = async (id: string) => {
    setIsProcessing(true);
    try {
      await archiveResponse(id);
      await fetchData();
      success('アーカイブしました');
    } catch (err) {
      console.error('Error archiving response:', err);
      error(err instanceof Error ? err.message : 'アーカイブに失敗しました');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleUnarchive = async (id: string) => {
    setIsProcessing(true);
    try {
      await unarchiveResponse(id);
      await fetchData();
      success('アーカイブを解除しました');
    } catch (err) {
      console.error('Error unarchiving response:', err);
      error(err instanceof Error ? err.message : 'アーカイブ解除に失敗しました');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleBulkArchive = async () => {
    if (selectedIds.size === 0) {
      error('アーカイブする回答を選択してください');
      return;
    }

    if (!(await confirm({ title: 'アーカイブ確認', description: `${selectedIds.size}件の回答をアーカイブしますか？`, confirmLabel: 'アーカイブ', variant: 'warning' }))) {
      return;
    }

    setIsProcessing(true);
    try {
      const count = selectedIds.size;
      await archiveResponses(Array.from(selectedIds));
      setSelectedIds(new Set());
      await fetchData();
      success(`${count}件をアーカイブしました`);
    } catch (err) {
      console.error('Error bulk archiving:', err);
      error(err instanceof Error ? err.message : 'アーカイブに失敗しました');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      const activeResponses = responses.filter(r => !r.is_archived);
      setSelectedIds(new Set(activeResponses.map(r => r.id)));
    } else {
      setSelectedIds(new Set());
    }
  };

  const handleSelect = (id: string, checked: boolean) => {
    const newSet = new Set(selectedIds);
    if (checked) {
      newSet.add(id);
    } else {
      newSet.delete(id);
    }
    setSelectedIds(newSet);
  };

  const activeResponses = responses.filter(r => !r.is_archived);
  const allSelected = activeResponses.length > 0 && activeResponses.every(r => selectedIds.has(r.id));

  // テーブル並べ替え（列クリックでソート）
  type SortKey = 'created_at' | 'student_name' | 'grade' | 'exam_type' | 'charged' | 'linked';
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
      case 'student_name': {
        const nameA = a.linked_student ? `${a.linked_student.last_name} ${a.linked_student.first_name}` : a.student_name;
        const nameB = b.linked_student ? `${b.linked_student.last_name} ${b.linked_student.first_name}` : b.student_name;
        cmp = nameA.localeCompare(nameB, 'ja');
        break;
      }
      case 'grade':
        cmp = a.grade - b.grade;
        break;
      case 'exam_type': {
        const typeA = a.response_data.exam_type === 'regular' ? '0' : `1${a.response_data.furikae_date_label || ''}`;
        const typeB = b.response_data.exam_type === 'regular' ? '0' : `1${b.response_data.furikae_date_label || ''}`;
        cmp = typeA.localeCompare(typeB);
        break;
      }
      case 'charged':
        cmp = (a.status_checks?.charged ? 1 : 0) - (b.status_checks?.charged ? 1 : 0);
        break;
      case 'linked':
        cmp = (a.linked_student_id ? 1 : 0) - (b.linked_student_id ? 1 : 0);
        break;
      default:
        break;
    }
    return sortOrder === 'asc' ? cmp : -cmp;
  });

  const SortableTh = ({ label, sortKey: key, className = '' }: { label: string; sortKey: SortKey; className?: string }) => (
    <th
      className={`px-4 py-3 text-left text-xs font-semibold text-[#1f2937] uppercase cursor-pointer select-none hover:bg-[#e5e7eb] transition-colors ${className}`}
      onClick={() => handleSort(key)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {sortKey === key ? (sortOrder === 'asc' ? <span className="text-[#3b82f6]">↑</span> : <span className="text-[#3b82f6]">↓</span>) : <span className="text-[#9ca3af]">↕</span>}
      </span>
    </th>
  );

  return (
    <>
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      <AdminLayout headerTitle={`${periodKey} 模試申込 回答一覧`}>
        {errorMessage && (
          <div className="mb-6 p-4 bg-[#ef4444]/10 border border-[#ef4444] rounded-lg">
            <p className="text-sm text-[#ef4444]">{errorMessage}</p>
          </div>
        )}

        {/* 集計表示 */}
        <MoshiStats stats={stats} />

        {/* フィルター */}
        <div className="mb-6 bg-white rounded-xl border border-[#e5e7eb] p-4">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-4">
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
                {[4, 5, 6, 7, 8, 9].map((grade) => (
                  <option key={grade} value={grade}>
                    {MOSHI_GRADE_NUMBER_TO_NAME[grade]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-[#1f2937] mb-2">
                受験方法
              </label>
              <select
                value={filterExamType}
                onChange={(e) =>
                  setFilterExamType(e.target.value as 'all' | 'regular' | 'furikae')
                }
                className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm bg-white text-[#4b5563]"
              >
                <option value="all">全て</option>
                <option value="regular">通常受験</option>
                <option value="furikae">振替受験</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-[#1f2937] mb-2">
                計上状態
              </label>
              <select
                value={filterChargedStatus}
                onChange={(e) =>
                  setFilterChargedStatus(
                    e.target.value as 'all' | 'charged' | 'not_charged'
                  )
                }
                className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm bg-white text-[#4b5563]"
              >
                <option value="all">全て</option>
                <option value="charged">計上済み</option>
                <option value="not_charged">未計上</option>
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
          <div className="flex items-center justify-between pt-4 border-t border-[#e5e7eb]/20">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
                className="w-4 h-4 text-[#3b82f6] border-[#e5e7eb] rounded focus:ring-[#3b82f6] cursor-pointer"
              />
              <span className="text-sm text-[#1f2937] flex items-center gap-2">
                アーカイブ済みを表示
                {archivedCount > 0 && (
                  <span className="ml-1 text-[#4b5563]/60">({archivedCount}件)</span>
                )}
                {isLoading && <span className="inline-block w-3 h-3 border-2 border-[#3b82f6] border-t-transparent rounded-full animate-spin" />}
              </span>
            </label>
          </div>
        </div>

        {/* 一括操作バー */}
        {selectedIds.size > 0 && (
          <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-center justify-between">
            <span className="text-sm text-blue-800">
              {selectedIds.size}件を選択中
            </span>
            <div className="flex gap-2">
              <button
                onClick={handleBulkArchive}
                disabled={isProcessing}
                className="px-3 py-1 bg-gray-600 text-white text-sm rounded hover:bg-gray-700 disabled:opacity-50"
              >
                一括アーカイブ
              </button>
              <button
                onClick={() => setSelectedIds(new Set())}
                className="px-3 py-1 text-gray-600 text-sm hover:underline"
              >
                選択解除
              </button>
            </div>
          </div>
        )}

        {/* 回答一覧 */}
        <div className="bg-white rounded-xl border border-[#e5e7eb] overflow-hidden">
          {isLoading ? (
            <div className="p-8 text-center">
              <p className="text-[#4b5563]">読み込み中...</p>
            </div>
          ) : responses.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-[#4b5563]">回答がありません。保護者ポータルから申込が届くとここに表示されます。</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-[#f3f4f6] border-b border-[#e5e7eb]">
                    <th className="px-2 py-3 text-center w-10">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={(e) => handleSelectAll(e.target.checked)}
                        className="w-4 h-4 text-[#3b82f6] border-[#e5e7eb] rounded focus:ring-[#3b82f6] cursor-pointer"
                      />
                    </th>
                    <SortableTh label="回答日時" sortKey="created_at" />
                    <SortableTh label="生徒名" sortKey="student_name" />
                    <SortableTh label="学年" sortKey="grade" />
                    <SortableTh label="受験方法" sortKey="exam_type" />
                    <SortableTh label="計上" sortKey="charged" />
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[#1f2937] uppercase">
                      発注
                    </th>
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
                      className={`border-b border-[#e5e7eb]/20 hover:bg-[#f3f4f6] ${
                        response.is_archived ? 'bg-gray-100 opacity-60' : ''
                      }`}
                    >
                      <td className="px-2 py-3 text-center">
                        {!response.is_archived && (
                          <input
                            type="checkbox"
                            checked={selectedIds.has(response.id)}
                            onChange={(e) => handleSelect(response.id, e.target.checked)}
                            className="w-4 h-4 text-[#3b82f6] border-[#e5e7eb] rounded focus:ring-[#3b82f6] cursor-pointer"
                          />
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-[#4b5563]">
                        {formatDate(response.created_at)}
                      </td>
                      <td className="px-4 py-3 text-sm text-[#1f2937] font-medium">
                        {response.linked_student
                          ? `${response.linked_student.last_name} ${response.linked_student.first_name}`
                          : response.student_name}
                      </td>
                      <td className="px-4 py-3 text-sm text-[#4b5563]">
                        {MOSHI_GRADE_NUMBER_TO_NAME[response.grade] || response.grade}
                      </td>
                      <td className="px-4 py-3 text-sm text-[#4b5563]">
                        {formatExamType(response)}
                      </td>
                      <td className="px-4 py-3 text-sm text-[#4b5563]">
                        <input
                          type="checkbox"
                          checked={response.status_checks?.charged || false}
                          onChange={(e) => handleChargedToggle(response.id, e.target.checked)}
                          className="w-4 h-4 text-[#3b82f6] border-[#e5e7eb] rounded focus:ring-[#3b82f6] cursor-pointer"
                        />
                      </td>
                      <td className="px-4 py-3 text-sm text-[#4b5563]">
                        <input
                          type="checkbox"
                          checked={response.status_checks?.order || false}
                          onChange={(e) => handleOrderToggle(response.id, e.target.checked)}
                          className="w-4 h-4 text-[#3b82f6] border-[#e5e7eb] rounded focus:ring-[#3b82f6] cursor-pointer"
                        />
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
                          {response.is_archived ? (
                            <>
                              <span className="px-2 py-1 text-xs bg-gray-200 text-gray-600 rounded">
                                アーカイブ済
                              </span>
                              <button
                                className="px-3 py-1 text-xs bg-[#f3f4f6] text-blue-600 rounded hover:bg-blue-50"
                                onClick={() => handleUnarchive(response.id)}
                                disabled={isProcessing}
                              >
                                戻す
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                className="px-3 py-1 text-xs bg-[#f3f4f6] text-[#4b5563] rounded hover:bg-[#e5e7eb]"
                                onClick={() => setDetailResponse(response)}
                              >
                                詳細
                              </button>
                              {response.linked_student_id ? (
                                <button
                                  className="px-3 py-1 text-xs bg-[#f3f4f6] text-[#4b5563] rounded hover:bg-[#e5e7eb]"
                                  onClick={() => handleUnlinkStudent(response.id)}
                                >
                                  解除
                                </button>
                              ) : (
                                <button
                                  className="px-3 py-1 text-xs bg-[#f3f4f6] text-[#4b5563] rounded hover:bg-[#e5e7eb]"
                                  onClick={() => handleOpenLinkModal(response)}
                                >
                                  紐付け
                                </button>
                              )}
                              <button
                                className="px-3 py-1 text-xs bg-[#f3f4f6] text-gray-500 rounded hover:bg-gray-100"
                                onClick={() => handleArchive(response.id)}
                                disabled={isProcessing}
                              >
                                アーカイブ
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      {/* 紐付けモーダル */}
      {linkingResponse && (
        <LinkStudentModal
          isOpen={!!linkingResponse}
          onClose={() => setLinkingResponse(null)}
          response={{
            id: linkingResponse.id,
            school_id: linkingResponse.school_id,
            form_type: 'moshi',
            form_period: linkingResponse.form_period,
            student_name: linkingResponse.student_name,
            grade: linkingResponse.grade,
            email: linkingResponse.email,
            response_data: linkingResponse.response_data as unknown as Record<string, unknown>,
            linked_student_id: linkingResponse.linked_student_id,
            linked_at: linkingResponse.linked_at,
            status_checks: (linkingResponse.status_checks ?? {}) as Record<string, boolean>,
            is_archived: linkingResponse.is_archived,
            archived_at: linkingResponse.archived_at,
            created_at: linkingResponse.created_at,
            updated_at: linkingResponse.updated_at,
          }}
          students={students}
          isLoadingStudents={isLoadingStudents}
          onSuccess={handleLinkSuccess}
        />
      )}

      {/* 回答詳細モーダル（一覧の最新状態を参照して計上・発注と連動） */}
      {detailResponse && (
        <MoshiResponseDetailModal
          isOpen={!!detailResponse}
          response={responses.find((r) => r.id === detailResponse.id) ?? detailResponse}
          onClose={() => setDetailResponse(null)}
          onChargedChange={handleChargedToggle}
          onOrderChange={handleOrderToggle}
        />
      )}
      {ConfirmDialog}
      </AdminLayout>
    </>
  );
}
