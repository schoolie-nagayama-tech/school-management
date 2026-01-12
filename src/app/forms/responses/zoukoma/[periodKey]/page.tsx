'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { AppHeader } from '@/components/layout';
import {
  getZoukomaResponses,
  getZoukomaStats,
  updateZoukomaResponseStatus,
} from '@/lib/api/zoukoma';
import {
  linkResponseToStudent,
  unlinkResponseFromStudent,
} from '@/lib/api/form-responses';
import { getStudents } from '@/lib/api/students';
import { LinkStudentModal } from '@/components/forms/LinkStudentModal';
import { useToast } from '@/hooks/useToast';
import { ToastContainer } from '@/components/ui';
import type { ZoukomaResponse, ZoukomaResponseFilters } from '@/types/forms/zoukoma';
import type { Student } from '@/types/database';
import { getDefaultSchoolId } from '@/lib/api/schools';
import { GRADE_NUMBER_TO_NAME } from '@/types/forms/zoukoma';

export default function ZoukomaResponsePage() {
  const params = useParams();
  const periodKey = (params?.periodKey as string) || '';
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
  const [linkingResponse, setLinkingResponse] = useState<ZoukomaResponse | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [isLoadingStudents, setIsLoadingStudents] = useState(false);
  const { toasts, removeToast, success, error } = useToast();

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage('');
    try {
      const schoolId = getDefaultSchoolId();
      const [responsesData, statsData] = await Promise.all([
        getZoukomaResponses(schoolId, periodKey, filters),
        getZoukomaStats(schoolId, periodKey),
      ]);
      setResponses(responsesData);
      setStats(statsData);
    } catch (error) {
      console.error('Error fetching data:', error);
      setErrorMessage(
        error instanceof Error ? error.message : 'データの取得に失敗しました'
      );
    } finally {
      setIsLoading(false);
    }
  }, [periodKey, filters]);

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
      error(
        err instanceof Error
          ? err.message
          : 'ステータスの更新に失敗しました'
      );
    }
  };

  // 紐付けモーダルを開く
  const handleOpenLinkModal = async (response: ZoukomaResponse) => {
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

  return (
    <div className="min-h-screen bg-[#eff0f3]">
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      <AppHeader title={`${periodKey} 増コマ申込 回答一覧`} />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {errorMessage && (
          <div className="mb-4 p-4 bg-[#d9376e]/20 border border-[#d9376e] rounded-lg">
            <p className="text-sm text-[#d9376e]">{errorMessage}</p>
          </div>
        )}

        {/* 集計表示 */}
        <div className="mb-6 bg-[#fffffe] rounded-xl border border-[#0d0d0d] p-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <div className="text-sm text-[#2a2a2a]">合計コマ数</div>
              <div className="text-2xl font-bold text-[#0d0d0d]">
                {stats.total_koma}コマ
              </div>
            </div>
            <div>
              <div className="text-sm text-[#2a2a2a]">合計金額</div>
              <div className="text-2xl font-bold text-[#0d0d0d]">
                ¥{stats.total_fee.toLocaleString()}
              </div>
            </div>
            <div>
              <div className="text-sm text-[#2a2a2a]">計上済み</div>
              <div className="text-2xl font-bold text-[#0d0d0d]">
                {stats.charged_count}件
              </div>
            </div>
            <div>
              <div className="text-sm text-[#2a2a2a]">座席落とし込み済み</div>
              <div className="text-2xl font-bold text-[#0d0d0d]">
                {stats.seated_count}件
              </div>
            </div>
          </div>
        </div>

        {/* フィルター */}
        <div className="mb-6 bg-[#fffffe] rounded-xl border border-[#0d0d0d] p-4">
          <div className="flex gap-4">
            <select
              value={filters.grade || 'all'}
              onChange={(e) =>
                setFilters({
                  ...filters,
                  grade: e.target.value === 'all' ? undefined : parseInt(e.target.value, 10),
                })
              }
              className="px-3 py-2 border border-[#0d0d0d] rounded-lg text-sm"
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
                  chargedStatus: e.target.value === 'all' ? undefined : e.target.value as 'charged' | 'not_charged',
                })
              }
              className="px-3 py-2 border border-[#0d0d0d] rounded-lg text-sm"
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
                  seatedStatus: e.target.value === 'all' ? undefined : e.target.value as 'seated' | 'not_seated',
                })
              }
              className="px-3 py-2 border border-[#0d0d0d] rounded-lg text-sm"
            >
              <option value="all">座席状態: 全て</option>
              <option value="seated">座席落とし込み済み</option>
              <option value="not_seated">未落とし込み</option>
            </select>
          </div>
        </div>

        {/* 回答一覧 */}
        <div className="bg-[#fffffe] rounded-xl border border-[#0d0d0d] p-6">
          {isLoading ? (
            <div className="text-center py-8 text-[#2a2a2a]">読み込み中...</div>
          ) : responses.length === 0 ? (
            <div className="text-center py-8 text-[#2a2a2a]">回答がありません</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse border border-[#0d0d0d] text-sm">
                <thead>
                  <tr className="bg-[#eff0f3]">
                    <th className="border border-[#0d0d0d] px-4 py-3 text-left">
                      回答日時
                    </th>
                    <th className="border border-[#0d0d0d] px-4 py-3 text-left">
                      生徒名
                    </th>
                    <th className="border border-[#0d0d0d] px-4 py-3 text-left">
                      学年
                    </th>
                    <th className="border border-[#0d0d0d] px-4 py-3 text-left">
                      科目内訳
                    </th>
                    <th className="border border-[#0d0d0d] px-4 py-3 text-right">
                      コマ数
                    </th>
                    <th className="border border-[#0d0d0d] px-4 py-3 text-right">
                      金額
                    </th>
                    <th className="border border-[#0d0d0d] px-4 py-3 text-center">
                      計上
                    </th>
                    <th className="border border-[#0d0d0d] px-4 py-3 text-center">
                      座席
                    </th>
                    <th className="border border-[#0d0d0d] px-4 py-3 text-center">
                      紐付け
                    </th>
                    <th className="border border-[#0d0d0d] px-4 py-3 text-left">
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {responses.map((response) => (
                    <tr key={response.id} className="table-row-hover">
                      <td className="border border-[#0d0d0d] px-4 py-3">
                        {formatDateTime(response.created_at)}
                      </td>
                      <td className="border border-[#0d0d0d] px-4 py-3">
                        {response.student_name}
                      </td>
                      <td className="border border-[#0d0d0d] px-4 py-3">
                        {GRADE_NUMBER_TO_NAME[response.grade] || response.grade}
                      </td>
                      <td className="border border-[#0d0d0d] px-4 py-3">
                        {formatSubjectBreakdown(response.response_data.subjects)}
                      </td>
                      <td className="border border-[#0d0d0d] px-4 py-3 text-right">
                        {response.response_data.total_koma}コマ
                      </td>
                      <td className="border border-[#0d0d0d] px-4 py-3 text-right">
                        ¥{response.response_data.total_fee.toLocaleString()}
                      </td>
                      <td className="border border-[#0d0d0d] px-4 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={response.status_checks?.charged === true}
                          onChange={(e) => {
                            handleStatusCheck(response.id, 'charged', e.target.checked);
                          }}
                          className="w-4 h-4 text-[#ff8e3c] border-[#0d0d0d] rounded focus:ring-[#ff8e3c] cursor-pointer"
                        />
                      </td>
                      <td className="border border-[#0d0d0d] px-4 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={response.status_checks?.seated === true}
                          onChange={(e) => {
                            handleStatusCheck(response.id, 'seated', e.target.checked);
                          }}
                          className="w-4 h-4 text-[#ff8e3c] border-[#0d0d0d] rounded focus:ring-[#ff8e3c] cursor-pointer"
                        />
                      </td>
                      <td className="border border-[#0d0d0d] px-4 py-3 text-center">
                        {response.linked_student_id ? (
                          <span className="text-green-600">済</span>
                        ) : (
                          <span className="text-gray-400">未</span>
                        )}
                      </td>
                      <td className="border border-[#0d0d0d] px-4 py-3">
                        <div className="flex gap-2">
                          <button className="text-sm text-[#2a2a2a] hover:text-[#0d0d0d]">
                            詳細
                          </button>
                          {response.linked_student_id ? (
                            <button
                              onClick={() => handleUnlinkStudent(response.id)}
                              className="text-sm text-[#d9376e] hover:text-[#c02d5a]"
                            >
                              解除
                            </button>
                          ) : (
                            <button
                              onClick={() => handleOpenLinkModal(response)}
                              className="text-sm text-[#2a2a2a] hover:text-[#0d0d0d]"
                            >
                              紐付け
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
    </div>
  );
}
