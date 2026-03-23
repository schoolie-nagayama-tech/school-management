'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { AdminLayout } from '@/components/layouts';
import {
  getShukaisuResponses,
  getShukaisuStats,
  updateShukaisuStatusCheck,
} from '@/lib/api/shukaisu';
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
import type { ShukaisuResponse, ShukaisuResponseFilters } from '@/types/forms/shukaisu';
import type { Student } from '@/types/database';
import { getDefaultSchoolId } from '@/lib/api/schools';
import { useAuth } from '@/contexts/AuthContext';
import { SHUKAISU_GRADE_NUMBER_TO_NAME } from '@/types/forms/shukaisu';
import { ShukaisuStats } from '@/components/forms/shukaisu/ShukaisuStats';
import { ShukaisuResponseDetailModal } from '@/components/forms/shukaisu/ShukaisuResponseDetailModal';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';

export default function ShukaisuResponsePage() {
  const params = useParams();
  const periodKey = (params?.periodKey as string) || '';
  const { getSelectedSchoolIds } = useAuth();
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
  const { confirm, ConfirmDialog } = useConfirm();

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
      const schoolIds = getSelectedSchoolIds();
      const schoolId = schoolIds.length > 0 ? schoolIds[0] : getDefaultSchoolId();
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
        getUserErrorMessage(error, '回答一覧の取得に失敗しました')
      );
    } finally {
      setIsLoading(false);
    }
  }, [getSelectedSchoolIds, periodKey, filterGrade, filterHandledStatus, filterLinkedStatus, searchQuery, showArchived]);

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

  // 計上・座席の更新
  const handleStatusCheck = async (
    responseId: string,
    checkType: 'charged' | 'seated',
    checked: boolean
  ) => {
    try {
      await updateShukaisuStatusCheck(responseId, { [checkType]: checked });
      await fetchData();
      success(`${checkType === 'charged' ? '計上' : '座席'}状態を更新しました`);
    } catch (err) {
      console.error('Error updating status:', err);
      error(
        err instanceof Error
          ? err.message
          : 'ステータスの更新に失敗しました'
      );
    }
  };

  // 紐付けモーダルを開く
  const handleOpenLinkModal = async (response: ShukaisuResponse) => {
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
        getUserErrorMessage(err, '紐付け解除に失敗しました')
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
      error(getUserErrorMessage(err, 'アーカイブに失敗しました'));
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
      error(getUserErrorMessage(err, 'アーカイブ解除に失敗しました'));
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
      error(getUserErrorMessage(err, 'アーカイブに失敗しました'));
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
    <>
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      <AdminLayout headerTitle={`${periodKey} 週回数変更 回答一覧`}>
        {errorMessage && (
          <div className="mb-6 p-4 bg-[#ef4444]/10 border border-[#ef4444] rounded-lg">
            <p className="text-sm text-[#ef4444]">{errorMessage}</p>
          </div>
        )}

        {/* 集計表示 */}
        <ShukaisuStats stats={stats} />

        {/* フィルター */}
        <div className="mb-6 bg-white rounded-xl border border-[#e5e7eb] p-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-[#1f2937] mb-2">
                生徒名検索
              </label>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="生徒名で検索"
                className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm bg-white text-[#4b5563]"
              />
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
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((grade) => (
                  <option key={grade} value={grade}>
                    {SHUKAISU_GRADE_NUMBER_TO_NAME[grade]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-[#1f2937] mb-2">
                対応状況
              </label>
              <select
                value={filterHandledStatus}
                onChange={(e) =>
                  setFilterHandledStatus(
                    e.target.value as 'all' | 'handled' | 'not_handled'
                  )
                }
                className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm bg-white text-[#4b5563]"
              >
                <option value="all">全て</option>
                <option value="handled">対応済み</option>
                <option value="not_handled">未対応</option>
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
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[#1f2937] uppercase">
                      回答日時
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[#1f2937] uppercase">
                      生徒名
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[#1f2937] uppercase">
                      学年
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[#1f2937] uppercase">
                      変更内容
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[#1f2937] uppercase">
                      変更希望日
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-[#1f2937] uppercase">
                      計上
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-[#1f2937] uppercase">
                      座席
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[#1f2937] uppercase">
                      紐付け
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[#1f2937] uppercase">
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {responses.map((response) => (
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
                        {SHUKAISU_GRADE_NUMBER_TO_NAME[response.grade] || response.grade}
                      </td>
                      <td className="px-4 py-3 text-sm text-[#4b5563]">
                        {formatChangeSummary(response)}
                      </td>
                      <td className="px-4 py-3 text-sm text-[#4b5563]">
                        {response.response_data.change_from_label || response.response_data.change_from}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={response.status_checks?.charged === true}
                          onChange={(e) => handleStatusCheck(response.id, 'charged', e.target.checked)}
                          className="w-4 h-4 text-[#3b82f6] border-[#e5e7eb] rounded focus:ring-[#3b82f6] cursor-pointer"
                        />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={response.status_checks?.seated === true}
                          onChange={(e) => handleStatusCheck(response.id, 'seated', e.target.checked)}
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
            form_type: 'shukaisu',
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

      {/* 回答詳細モーダル */}
      {detailResponse && (
        <ShukaisuResponseDetailModal
          isOpen={!!detailResponse}
          response={detailResponse}
          onClose={() => setDetailResponse(null)}
        />
      )}
      {ConfirmDialog}
      </AdminLayout>
    </>
  );
}
