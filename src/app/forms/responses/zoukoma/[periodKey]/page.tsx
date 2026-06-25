'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { AdminLayout } from '@/components/layouts';
import {
  getZoukomaResponses,
  getZoukomaStats,
  updateZoukomaResponseStatus,
} from '@/lib/api/zoukoma';
import { unlinkResponseFromStudent, deleteFormResponse } from '@/lib/api/form-responses';
import { getStudents } from '@/lib/api/students';
import { LinkStudentModal } from '@/components/forms/LinkStudentModal';
import { ZoukomaResponseDetailModal } from '@/components/forms/zoukoma';
import { useToast } from '@/hooks/useToast';
import { useConfirm } from '@/hooks/useConfirm';
import { ToastContainer, Loading } from '@/components/ui';
import type { ZoukomaResponse, ZoukomaResponseFilters } from '@/types/forms/zoukoma';
import type { Student } from '@/types/database';
import { getDefaultSchoolId } from '@/lib/api/schools';
import { useAuth } from '@/contexts/AuthContext';
import { GRADE_NUMBER_TO_NAME } from '@/types/forms/zoukoma';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';

export default function ZoukomaResponsePage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const schoolIdParam = searchParams.get('schoolId');
  const periodKey = (params?.periodKey as string) || '';
  const { getSelectedSchoolIds, permissions } = useAuth();
  const [responses, setResponses] = useState<ZoukomaResponse[]>([]);
  const [stats, setStats] = useState({
    total_responses: 0,
    total_koma: 0,
    total_fee: 0,
    charged_count: 0,
    seated_count: 0,
    linked_count: 0,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [filters, setFilters] = useState<ZoukomaResponseFilters>({});
  const [detailResponse, setDetailResponse] = useState<ZoukomaResponse | null>(null);
  const [linkingResponse, setLinkingResponse] = useState<ZoukomaResponse | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [isLoadingStudents, setIsLoadingStudents] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const { toasts, removeToast, success, error } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage('');
    try {
      const schoolIds = getSelectedSchoolIds();
      const schoolId: string | string[] =
        schoolIdParam || (schoolIds.length > 0 ? schoolIds : getDefaultSchoolId());
      const [responsesData, statsData] = await Promise.all([
        getZoukomaResponses(schoolId, periodKey, filters),
        getZoukomaStats(schoolId, periodKey),
      ]);
      setResponses(responsesData);
      setStats(statsData);
    } catch (error) {
      console.error('Error fetching data:', error);
      setErrorMessage(getUserErrorMessage(error, 'データの取得に失敗しました'));
    } finally {
      setIsLoading(false);
    }
  }, [getSelectedSchoolIds, schoolIdParam, periodKey, filters]);

  useEffect(() => {
    if (periodKey) {
      fetchData();
    }
  }, [periodKey, fetchData]);

  const formatDateTime = (date: string) => {
    const d = new Date(date);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const formatSubjectBreakdown = (subjects: Record<string, number>) => {
    return Object.entries(subjects)
      .filter(([, koma]) => koma > 0)
      .map(([subject, koma]) => `${subject}${koma}`)
      .join('/');
  };

  // ステータスチェックの更新
  const handleStatusCheck = async (
    responseId: string,
    checkType: 'charged' | 'seated',
    checked: boolean
  ) => {
    try {
      await updateZoukomaResponseStatus(responseId, { [checkType]: checked });
      await fetchData(); // データを再取得
      success(`${checkType === 'charged' ? '計上' : '座席'}状態を更新しました`);
    } catch (err) {
      console.error('Error updating status:', err);
      error(err instanceof Error ? err.message : 'ステータスの更新に失敗しました');
    }
  };

  // 紐付けモーダルを開く
  const handleOpenLinkModal = async (response: ZoukomaResponse) => {
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

  // 回答を完全削除（マネージャー以上のみ）。アーカイブと違い物理削除で復元不可。
  const handleDelete = async (id: string) => {
    if (!permissions?.canDeleteFormResponses) return;
    if (
      !(await confirm({
        title: '回答削除',
        description: 'この回答を完全に削除しますか？この操作は取り消せません。',
        confirmLabel: '削除',
        variant: 'danger',
      }))
    ) {
      return;
    }
    setIsProcessing(true);
    try {
      await deleteFormResponse(id);
      await fetchData();
      success('回答を削除しました');
    } catch (err) {
      console.error('Error deleting response:', err);
      error(getUserErrorMessage(err, '削除に失敗しました'));
    } finally {
      setIsProcessing(false);
    }
  };

  // 紐付けを解除
  const handleUnlinkStudent = async (responseId: string) => {
    try {
      await unlinkResponseFromStudent(responseId);
      await fetchData();
      success('紐付けを解除しました');
    } catch (err) {
      console.error('Error unlinking student:', err);
      error(getUserErrorMessage(err, '紐付け解除に失敗しました'));
    }
  };

  return (
    <>
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      <AdminLayout headerTitle={`${periodKey} テスト対策増コマ申し込み 回答一覧`}>
        <div>
          {errorMessage && (
            <div className="mb-4 p-4 bg-danger/20 border border-danger rounded-lg">
              <p className="text-sm text-danger">{errorMessage}</p>
            </div>
          )}

          {/* 集計表示 */}
          <div className="mb-6 bg-surface-raised rounded-xl border border-border p-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <div className="text-sm text-text-body">合計コマ数</div>
                <div className="text-2xl font-bold text-text-heading">{stats.total_koma}コマ</div>
              </div>
              <div>
                <div className="text-sm text-text-body">合計金額</div>
                <div className="text-2xl font-bold text-text-heading">
                  ¥{stats.total_fee.toLocaleString()}
                </div>
              </div>
              <div>
                <div className="text-sm text-text-body">計上済み</div>
                <div className="text-2xl font-bold text-text-heading">{stats.charged_count}件</div>
              </div>
              <div>
                <div className="text-sm text-text-body">座席落とし込み済み</div>
                <div className="text-2xl font-bold text-text-heading">{stats.seated_count}件</div>
              </div>
            </div>
          </div>

          {/* フィルター */}
          <div className="mb-6 bg-surface-raised rounded-xl border border-border p-4">
            <div className="flex gap-4">
              <select
                value={filters.grade || 'all'}
                onChange={(e) =>
                  setFilters({
                    ...filters,
                    grade: e.target.value === 'all' ? undefined : parseInt(e.target.value, 10),
                  })
                }
                className="px-3 py-2 border border-border rounded-lg text-sm"
              >
                <option value="all">全学年</option>
                {[7, 8, 9, 10, 11, 12].map((grade) => (
                  <option key={grade} value={grade}>
                    {GRADE_NUMBER_TO_NAME[grade]}
                  </option>
                ))}
              </select>
              <select
                value={filters.chargedStatus || 'all'}
                onChange={(e) =>
                  setFilters({
                    ...filters,
                    chargedStatus:
                      e.target.value === 'all'
                        ? undefined
                        : (e.target.value as 'charged' | 'not_charged'),
                  })
                }
                className="px-3 py-2 border border-border rounded-lg text-sm"
              >
                <option value="all">計上状態: 全て</option>
                <option value="charged">計上済み</option>
                <option value="not_charged">未計上</option>
              </select>
              <select
                value={filters.seatedStatus || 'all'}
                onChange={(e) =>
                  setFilters({
                    ...filters,
                    seatedStatus:
                      e.target.value === 'all'
                        ? undefined
                        : (e.target.value as 'seated' | 'not_seated'),
                  })
                }
                className="px-3 py-2 border border-border rounded-lg text-sm"
              >
                <option value="all">座席状態: 全て</option>
                <option value="seated">座席落とし込み済み</option>
                <option value="not_seated">未落とし込み</option>
              </select>
            </div>
          </div>

          {/* 回答一覧 */}
          <div className="bg-surface-raised rounded-xl border border-border p-6">
            {isLoading ? (
              <Loading size="md" />
            ) : responses.length === 0 ? (
              <div className="text-center py-8 text-text-body">
                回答がありません。保護者ポータルから申込が届くとここに表示されます。
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse border border-border text-sm">
                  <thead>
                    <tr className="bg-surface-hover">
                      <th className="border border-border px-4 py-3 text-left">回答日時</th>
                      <th className="border border-border px-4 py-3 text-left">生徒名</th>
                      <th className="border border-border px-4 py-3 text-left">学年</th>
                      <th className="border border-border px-4 py-3 text-left">科目内訳</th>
                      <th className="border border-border px-4 py-3 text-right">コマ数</th>
                      <th className="border border-border px-4 py-3 text-right">金額</th>
                      <th className="border border-border px-4 py-3 text-center">計上</th>
                      <th className="border border-border px-4 py-3 text-center">座席</th>
                      <th className="border border-border px-4 py-3 text-center">紐付け</th>
                      <th className="border border-border px-4 py-3 text-left">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {responses.map((response) => (
                      <tr key={response.id} className="table-row-hover">
                        <td className="border border-border px-4 py-3">
                          {formatDateTime(response.created_at)}
                        </td>
                        <td className="border border-border px-4 py-3">{response.student_name}</td>
                        <td className="border border-border px-4 py-3">
                          {GRADE_NUMBER_TO_NAME[response.grade] || response.grade}
                        </td>
                        <td className="border border-border px-4 py-3">
                          {formatSubjectBreakdown(response.response_data.subjects)}
                        </td>
                        <td className="border border-border px-4 py-3 text-right">
                          {response.response_data.total_koma}コマ
                        </td>
                        <td className="border border-border px-4 py-3 text-right">
                          ¥{response.response_data.total_fee.toLocaleString()}
                        </td>
                        <td className="border border-border px-4 py-3 text-center">
                          <input
                            type="checkbox"
                            checked={response.status_checks?.charged === true}
                            onChange={(e) => {
                              handleStatusCheck(response.id, 'charged', e.target.checked);
                            }}
                            className="w-4 h-4 text-info border-border rounded focus:ring-primary cursor-pointer"
                          />
                        </td>
                        <td className="border border-border px-4 py-3 text-center">
                          <input
                            type="checkbox"
                            checked={response.status_checks?.seated === true}
                            onChange={(e) => {
                              handleStatusCheck(response.id, 'seated', e.target.checked);
                            }}
                            className="w-4 h-4 text-info border-border rounded focus:ring-primary cursor-pointer"
                          />
                        </td>
                        <td className="border border-border px-4 py-3 text-center">
                          {response.linked_student_id ? (
                            <span className="text-green-600">済</span>
                          ) : (
                            <span className="text-gray-400">未</span>
                          )}
                        </td>
                        <td className="border border-border px-4 py-3">
                          <div className="flex gap-2">
                            <button
                              onClick={() => setDetailResponse(response)}
                              className="px-3 py-1 text-xs bg-surface-hover text-text-body rounded hover:bg-border active:scale-[0.97] transition-[transform,background-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]"
                            >
                              詳細
                            </button>
                            {response.linked_student_id ? (
                              <button
                                onClick={() => handleUnlinkStudent(response.id)}
                                className="px-3 py-1 text-xs bg-surface-hover text-text-body rounded hover:bg-border active:scale-[0.97] transition-[transform,background-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]"
                              >
                                解除
                              </button>
                            ) : (
                              <button
                                onClick={() => handleOpenLinkModal(response)}
                                className="px-3 py-1 text-xs bg-surface-hover text-text-body rounded hover:bg-border active:scale-[0.97] transition-[transform,background-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]"
                              >
                                紐付け
                              </button>
                            )}
                            {permissions?.canDeleteFormResponses && (
                              <button
                                className="px-3 py-1 text-xs bg-surface-hover text-danger rounded hover:bg-danger-subtle active:scale-[0.97] transition-[transform,background-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]"
                                onClick={() => handleDelete(response.id)}
                                disabled={isProcessing}
                              >
                                削除
                              </button>
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
        </div>

        {/* 詳細モーダル */}
        {detailResponse && (
          <ZoukomaResponseDetailModal
            isOpen={!!detailResponse}
            response={detailResponse}
            onClose={() => setDetailResponse(null)}
          />
        )}

        {/* 紐付けモーダル */}
        {linkingResponse && (
          <LinkStudentModal
            isOpen={!!linkingResponse}
            onClose={() => setLinkingResponse(null)}
            response={{
              id: linkingResponse.id,
              school_id: linkingResponse.school_id,
              form_type: 'zoukoma',
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
        {ConfirmDialog}
      </AdminLayout>
    </>
  );
}
