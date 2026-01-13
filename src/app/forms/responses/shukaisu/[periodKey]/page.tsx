'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { AppHeader } from '@/components/layout';
import {
  getShukaisuResponses,
  getShukaisuStats,
  updateShukaisuHandledStatus,
} from '@/lib/api/shukaisu';
import {
  linkResponseToStudent,
  unlinkResponseFromStudent,
  archiveResponse,
  unarchiveResponse,
  archiveResponses,
  getArchivedCount,
} from '@/lib/api/form-responses';
import { getStudents } from '@/lib/api/students';
import { LinkStudentModal } from '@/components/forms/LinkStudentModal';
import { useToast } from '@/hooks/useToast';
import { ToastContainer } from '@/components/ui';
import type { ShukaisuResponse, ShukaisuResponseFilters } from '@/types/forms/shukaisu';
import type { Student } from '@/types/database';
import { getDefaultSchoolId } from '@/lib/api/schools';
import { SHUKAISU_GRADE_NUMBER_TO_NAME } from '@/types/forms/shukaisu';
import { ShukaisuStats } from '@/components/forms/shukaisu/ShukaisuStats';
import { ShukaisuResponseDetailModal } from '@/components/forms/shukaisu/ShukaisuResponseDetailModal';

export default function ShukaisuResponsePage() {
  const params = useParams();
  const periodKey = (params?.periodKey as string) || '';
  const [responses, setResponses] = useState<ShukaisuResponse[]>([]);
  const [stats, setStats] = useState({
    total_responses: 0,
    handled_count: 0,
    linked_count: 0,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [linkingResponse, setLinkingResponse] = useState<ShukaisuResponse | null>(null);
  const [detailResponse, setDetailResponse] = useState<ShukaisuResponse | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [isLoadingStudents, setIsLoadingStudents] = useState(false);
  const { toasts, removeToast, success, error } = useToast();

  // フィルター
  const [filterGrade, setFilterGrade] = useState<number | 'all'>('all');
  const [filterHandledStatus, setFilterHandledStatus] = useState<
    'all' | 'handled' | 'not_handled'
  >('all');
  const [filterLinkedStatus, setFilterLinkedStatus] = useState<
    'all' | 'linked' | 'unlinked'
  >('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [archivedCount, setArchivedCount] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isProcessing, setIsProcessing] = useState(false);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage('');
    try {
      const schoolId = getDefaultSchoolId();
      const filters: ShukaisuResponseFilters = {
        grade: filterGrade === 'all' ? undefined : filterGrade,
        handledStatus: filterHandledStatus === 'all' ? undefined : filterHandledStatus,
        linkedStatus: filterLinkedStatus === 'all' ? undefined : filterLinkedStatus,
        search: searchQuery.trim() || undefined,
        showArchived,
      };

      const [responsesData, statsData, archivedCountData] = await Promise.all([
        getShukaisuResponses(schoolId, periodKey, filters),
        getShukaisuStats(schoolId, periodKey),
        getArchivedCount(schoolId, 'shukaisu', periodKey),
      ]);

      setResponses(responsesData);
      setStats(statsData);
      setArchivedCount(archivedCountData);
    } catch (error) {
      console.error('Error fetching shukaisu responses:', error);
      setErrorMessage(
        error instanceof Error ? error.message : '回答一覧の取得に失敗しました'
      );
    } finally {
      setIsLoading(false);
    }
  }, [periodKey, filterGrade, filterHandledStatus, filterLinkedStatus, searchQuery, showArchived]);

  useEffect(() => {
    if (periodKey) {
      fetchData();
    }
  }, [fetchData, periodKey]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  };

  const formatChangeSummary = (response: ShukaisuResponse): string => {
    const current = response.response_data.current;
    const requested = response.response_data.requested;
    return `週${current.weekly_count}回→週${requested.weekly_count}回`;
  };

  // 対応状況の更新
  const handleHandledToggle = async (responseId: string, handled: boolean) => {
    try {
      await updateShukaisuHandledStatus(responseId, handled);
      await fetchData();
      success(`${handled ? '対応済み' : '未対応'}に更新しました`);
    } catch (err) {
      console.error('Error updating handled status:', err);
      error(
        err instanceof Error
          ? err.message
          : '対応状況の更新に失敗しました'
      );
    }
  };

  // 紐付けモーダルを開く
  const handleOpenLinkModal = async (response: ShukaisuResponse) => {
    setLinkingResponse(response);
    setIsLoadingStudents(true);
    try {
      // 同じ学年の生徒を取得
      const allStudents = await getStudents();
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

    if (!confirm(`${selectedIds.size}件の回答をアーカイブしますか？`)) {
      return;
    }

    setIsProcessing(true);
    try {
      await archiveResponses(Array.from(selectedIds));
      setSelectedIds(new Set());
      await fetchData();
      success(`${selectedIds.size}件をアーカイブしました`);
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

  return (
    <div className="min-h-screen bg-[#eff0f3]">
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      <AppHeader title={`${periodKey} 週回数変更 回答一覧`} />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {errorMessage && (
          <div className="mb-6 p-4 bg-[#d9376e]/10 border border-[#d9376e] rounded-lg">
            <p className="text-sm text-[#d9376e]">{errorMessage}</p>
          </div>
        )}

        {/* 集計表示 */}
        <ShukaisuStats stats={stats} />

        {/* フィルター */}
        <div className="mb-6 bg-[#fffffe] rounded-xl border border-[#0d0d0d] p-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-[#0d0d0d] mb-2">
                生徒名検索
              </label>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="生徒名で検索"
                className="w-full px-3 py-2 border border-[#0d0d0d] rounded-lg text-sm bg-[#fffffe] text-[#2a2a2a]"
              />
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
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((grade) => (
                  <option key={grade} value={grade}>
                    {SHUKAISU_GRADE_NUMBER_TO_NAME[grade]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-[#0d0d0d] mb-2">
                対応状況
              </label>
              <select
                value={filterHandledStatus}
                onChange={(e) =>
                  setFilterHandledStatus(
                    e.target.value as 'all' | 'handled' | 'not_handled'
                  )
                }
                className="w-full px-3 py-2 border border-[#0d0d0d] rounded-lg text-sm bg-[#fffffe] text-[#2a2a2a]"
              >
                <option value="all">全て</option>
                <option value="handled">対応済み</option>
                <option value="not_handled">未対応</option>
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
          <div className="flex items-center justify-between pt-4 border-t border-[#0d0d0d]/20">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
                className="w-4 h-4 text-[#ff8e3c] border-[#0d0d0d] rounded focus:ring-[#ff8e3c] cursor-pointer"
              />
              <span className="text-sm text-[#0d0d0d]">
                アーカイブ済みを表示
                {archivedCount > 0 && (
                  <span className="ml-1 text-[#2a2a2a]/60">({archivedCount}件)</span>
                )}
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
                    <th className="px-2 py-3 text-center w-10">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={(e) => handleSelectAll(e.target.checked)}
                        className="w-4 h-4 text-[#ff8e3c] border-[#0d0d0d] rounded focus:ring-[#ff8e3c] cursor-pointer"
                      />
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[#0d0d0d] uppercase">
                      回答日時
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[#0d0d0d] uppercase">
                      生徒名
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[#0d0d0d] uppercase">
                      学年
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[#0d0d0d] uppercase">
                      変更内容
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[#0d0d0d] uppercase">
                      変更希望日
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[#0d0d0d] uppercase">
                      対応
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
                      className={`border-b border-[#0d0d0d]/20 hover:bg-[#eff0f3] ${
                        response.is_archived ? 'bg-gray-100 opacity-60' : ''
                      }`}
                    >
                      <td className="px-2 py-3 text-center">
                        {!response.is_archived && (
                          <input
                            type="checkbox"
                            checked={selectedIds.has(response.id)}
                            onChange={(e) => handleSelect(response.id, e.target.checked)}
                            className="w-4 h-4 text-[#ff8e3c] border-[#0d0d0d] rounded focus:ring-[#ff8e3c] cursor-pointer"
                          />
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-[#2a2a2a]">
                        {formatDate(response.created_at)}
                      </td>
                      <td className="px-4 py-3 text-sm text-[#0d0d0d] font-medium">
                        {response.linked_student
                          ? `${response.linked_student.last_name} ${response.linked_student.first_name}`
                          : response.student_name}
                      </td>
                      <td className="px-4 py-3 text-sm text-[#2a2a2a]">
                        {SHUKAISU_GRADE_NUMBER_TO_NAME[response.grade] || response.grade}
                      </td>
                      <td className="px-4 py-3 text-sm text-[#2a2a2a]">
                        {formatChangeSummary(response)}
                      </td>
                      <td className="px-4 py-3 text-sm text-[#2a2a2a]">
                        {response.response_data.change_from_label || response.response_data.change_from}
                      </td>
                      <td className="px-4 py-3 text-sm text-[#2a2a2a]">
                        <input
                          type="checkbox"
                          checked={response.status_checks?.handled || false}
                          onChange={(e) => handleHandledToggle(response.id, e.target.checked)}
                          className="w-4 h-4 text-[#ff8e3c] border-[#0d0d0d] rounded focus:ring-[#ff8e3c] cursor-pointer"
                        />
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
                          {response.is_archived ? (
                            <>
                              <span className="px-2 py-1 text-xs bg-gray-200 text-gray-600 rounded">
                                アーカイブ済
                              </span>
                              <button
                                className="px-3 py-1 text-xs bg-[#eff0f3] text-blue-600 rounded hover:bg-blue-50"
                                onClick={() => handleUnarchive(response.id)}
                                disabled={isProcessing}
                              >
                                戻す
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                className="px-3 py-1 text-xs bg-[#eff0f3] text-[#2a2a2a] rounded hover:bg-[#0d0d0d]/10"
                                onClick={() => setDetailResponse(response)}
                              >
                                詳細
                              </button>
                              {response.linked_student_id ? (
                                <button
                                  className="px-3 py-1 text-xs bg-[#eff0f3] text-[#2a2a2a] rounded hover:bg-[#0d0d0d]/10"
                                  onClick={() => handleUnlinkStudent(response.id)}
                                >
                                  解除
                                </button>
                              ) : (
                                <button
                                  className="px-3 py-1 text-xs bg-[#eff0f3] text-[#2a2a2a] rounded hover:bg-[#0d0d0d]/10"
                                  onClick={() => handleOpenLinkModal(response)}
                                >
                                  紐付け
                                </button>
                              )}
                              <button
                                className="px-3 py-1 text-xs bg-[#eff0f3] text-gray-500 rounded hover:bg-gray-100"
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
      </main>

      {/* 紐付けモーダル */}
      {linkingResponse && (
        <LinkStudentModal
          isOpen={!!linkingResponse}
          onClose={() => setLinkingResponse(null)}
          response={{
            id: linkingResponse.id,
            school_id: linkingResponse.school_id,
            form_type: 'shukaisu',
            form_period: linkingResponse.form_period,
            student_name: linkingResponse.student_name,
            grade: linkingResponse.grade,
            email: linkingResponse.email,
            response_data: linkingResponse.response_data as Record<string, unknown>,
            linked_student_id: linkingResponse.linked_student_id,
            linked_at: linkingResponse.linked_at,
            status_checks: linkingResponse.status_checks,
            created_at: linkingResponse.created_at,
            updated_at: linkingResponse.updated_at,
          }}
          students={students}
          onSuccess={handleLinkSuccess}
        />
      )}

      {/* 回答詳細モーダル */}
      {detailResponse && (
        <ShukaisuResponseDetailModal
          isOpen={!!detailResponse}
          response={detailResponse}
          onClose={() => setDetailResponse(null)}
        />
      )}
    </div>
  );
}
