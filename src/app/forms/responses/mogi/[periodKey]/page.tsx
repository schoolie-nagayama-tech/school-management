'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { AdminLayout } from '@/components/layouts';
import { getMogiResponses, getMogiStats, updateMogiChargedStatus } from '@/lib/api/mogi';
import {
  unlinkResponseFromStudent,
  getArchivedCount,
  archiveResponse,
  unarchiveResponse,
  archiveResponses,
  deleteFormResponse,
  deleteResponses,
} from '@/lib/api/form-responses';
import { getStudents } from '@/lib/api/students';
import { LinkStudentModal } from '@/components/forms/LinkStudentModal';
import { useToast } from '@/hooks/useToast';
import { useConfirm } from '@/hooks/useConfirm';
import { ToastContainer, Loading, Spinner } from '@/components/ui';
import type { MogiResponse, MogiResponseFilters } from '@/types/forms/mogi';
import type { Student } from '@/types/database';
import { getDefaultSchoolId } from '@/lib/api/schools';
import { useAuth } from '@/contexts/AuthContext';
import {
  GRADE_NUMBER_TO_NAME,
  MOGI_EXAM_TYPE_OPTIONS,
  MOGI_EXAM_TYPE_LABELS,
  MOGI_EXAM_TYPE_BADGE_CLASSES,
} from '@/types/forms/mogi';
import type { MogiExamType, DateVenueSelection } from '@/types/forms/mogi';
import { MogiStats } from '@/components/forms/mogi/MogiStats';
import { MogiResponseDetailModal } from '@/components/forms/mogi/MogiResponseDetailModal';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';

export default function MogiResponsePage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const schoolIdParam = searchParams.get('schoolId');
  const periodKey = (params?.periodKey as string) || '';
  const { getSelectedSchoolIds, permissions } = useAuth();
  const [responses, setResponses] = useState<MogiResponse[]>([]);
  const [stats, setStats] = useState({
    total_responses: 0,
    date_venue_counts: [] as Array<{
      date_id: string;
      date_label: string;
      exam_type?: MogiExamType;
      venue_counts: Array<{
        venue_id: string;
        venue_label: string;
        count: number;
      }>;
      total: number;
    }>,
    charged_count: 0,
    linked_count: 0,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [linkingResponse, setLinkingResponse] = useState<MogiResponse | null>(null);
  const [detailResponse, setDetailResponse] = useState<MogiResponse | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [isLoadingStudents, setIsLoadingStudents] = useState(false);
  const { toasts, removeToast, success, error } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();

  // フィルター
  const [filterGrade, setFilterGrade] = useState<number | 'all'>('all');
  const [filterExamType, setFilterExamType] = useState<MogiExamType | 'all'>('all');
  const [filterDateId, setFilterDateId] = useState<string>('all');
  const [filterVenueId, setFilterVenueId] = useState<string>('all');
  const [filterChargedStatus, setFilterChargedStatus] = useState<'all' | 'charged' | 'not_charged'>(
    'all'
  );
  const [filterLinkedStatus, setFilterLinkedStatus] = useState<'all' | 'linked' | 'unlinked'>(
    'all'
  );
  const [showArchived, setShowArchived] = useState(false);
  const [archivedCount, setArchivedCount] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isProcessing, setIsProcessing] = useState(false);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage('');
    try {
      const schoolIds = getSelectedSchoolIds();
      const schoolId: string | string[] =
        schoolIdParam || (schoolIds.length > 0 ? schoolIds : getDefaultSchoolId());
      const filters: MogiResponseFilters = {
        grade: filterGrade === 'all' ? undefined : filterGrade,
        examType: filterExamType === 'all' ? undefined : filterExamType,
        dateId: filterDateId === 'all' ? undefined : filterDateId,
        venueId: filterVenueId === 'all' ? undefined : filterVenueId,
        chargedStatus: filterChargedStatus === 'all' ? undefined : filterChargedStatus,
        linkedStatus: filterLinkedStatus === 'all' ? undefined : filterLinkedStatus,
        showArchived,
      };

      const [responsesData, statsData, archivedCountData] = await Promise.all([
        getMogiResponses(schoolId, periodKey, filters),
        getMogiStats(schoolId, periodKey),
        getArchivedCount(schoolId, 'mogi', periodKey),
      ]);

      setResponses(responsesData);
      setStats(statsData);
      setArchivedCount(archivedCountData);
    } catch (error) {
      console.error('Error fetching mogi responses:', error);
      setErrorMessage(getUserErrorMessage(error, '回答一覧の取得に失敗しました'));
    } finally {
      setIsLoading(false);
    }
  }, [
    getSelectedSchoolIds,
    schoolIdParam,
    periodKey,
    filterGrade,
    filterExamType,
    filterDateId,
    filterVenueId,
    filterChargedStatus,
    filterLinkedStatus,
    showArchived,
  ]);

  useEffect(() => {
    if (periodKey) {
      fetchData();
    }
  }, [fetchData, periodKey]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  };

  /**
   * 選択した日程・会場を1件1行で描画する。
   * 同じ日に都立V・私立Vなど複数種別の模試が立つため、日程と会場だけでは
   * どの模試を申し込んだのか分からない。先頭に種別バッジを付けて区別する。
   * exam_type は後付けの項目なので、持っていない古い回答は「種別未設定」と出す
   * （空欄にすると「種別が無い」のか「読み落とした」のか判別できないため）。
   */
  const renderSelections = (selections: DateVenueSelection[]) => {
    if (selections.length === 0) {
      return <span className="text-text-muted">—</span>;
    }
    return (
      <div className="flex flex-col gap-1">
        {selections.map((s, index) => {
          const typeLabel =
            s.exam_type_label ?? (s.exam_type ? MOGI_EXAM_TYPE_LABELS[s.exam_type] : null);
          return (
            <div key={`${s.date_id}-${s.venue_id}-${index}`} className="flex items-start gap-2">
              <span
                className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap ${
                  s.exam_type
                    ? MOGI_EXAM_TYPE_BADGE_CLASSES[s.exam_type]
                    : 'bg-surface-hover text-text-muted'
                }`}
              >
                {typeLabel ?? '種別未設定'}
              </span>
              <span>
                {s.date_label} {s.venue_label}
              </span>
            </div>
          );
        })}
      </div>
    );
  };

  // 計上状態の更新（APIで既存 status_checks をマージし、成功時にサマリーも即時反映）
  const handleChargedToggle = async (responseId: string, charged: boolean) => {
    const prevResponses = responses;
    const prevStats = stats;
    setResponses((prev) =>
      prev.map((r) =>
        r.id === responseId ? { ...r, status_checks: { ...r.status_checks, charged } } : r
      )
    );
    setStats((s) => ({
      ...s,
      charged_count: s.charged_count + (charged ? 1 : -1),
    }));
    try {
      await updateMogiChargedStatus(responseId, charged);
      await fetchData();
      success(`${charged ? '計上' : '計上解除'}しました`);
    } catch (err) {
      console.error('Error updating charged status:', err);
      setResponses(prevResponses);
      setStats(prevStats);
      error(err instanceof Error ? err.message : '計上状態の更新に失敗しました');
    }
  };

  // 紐付けモーダルを開く
  const handleOpenLinkModal = async (response: MogiResponse) => {
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
      error(getUserErrorMessage(err, '紐付け解除に失敗しました'));
    }
  };

  // 利用可能な会場IDのリストを取得（フィルター用）
  const availableVenueIds = stats.date_venue_counts.flatMap((d) =>
    d.venue_counts.map((v) => v.venue_id)
  );
  const uniqueVenueIds = Array.from(new Set(availableVenueIds));

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

    if (
      !(await confirm({
        title: 'アーカイブ確認',
        description: `${selectedIds.size}件の回答をアーカイブしますか？`,
        confirmLabel: 'アーカイブ',
        variant: 'warning',
      }))
    ) {
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

  // 選択した回答を一括で完全削除（マネージャー以上のみ）
  const handleBulkDelete = async () => {
    if (!permissions?.canDeleteFormResponses) return;
    if (selectedIds.size === 0) {
      error('削除する回答を選択してください');
      return;
    }
    if (
      !(await confirm({
        title: '一括削除確認',
        description: `${selectedIds.size}件の回答を完全に削除しますか？この操作は取り消せません。`,
        confirmLabel: '削除',
        variant: 'danger',
      }))
    ) {
      return;
    }
    setIsProcessing(true);
    try {
      const count = selectedIds.size;
      await deleteResponses(Array.from(selectedIds));
      setSelectedIds(new Set());
      await fetchData();
      success(`${count}件を削除しました`);
    } catch (err) {
      console.error('Error bulk deleting:', err);
      error(getUserErrorMessage(err, '削除に失敗しました'));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      const activeResponses = responses.filter((r) => !r.is_archived);
      setSelectedIds(new Set(activeResponses.map((r) => r.id)));
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

  const activeResponses = responses.filter((r) => !r.is_archived);
  const allSelected =
    activeResponses.length > 0 && activeResponses.every((r) => selectedIds.has(r.id));

  return (
    <>
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      <AdminLayout headerTitle={`${periodKey} Vもぎ申込 回答一覧`}>
        <main>
          {errorMessage && (
            <div className="mb-6 p-4 bg-danger/10 border border-danger rounded-lg">
              <p className="text-sm text-danger">{errorMessage}</p>
            </div>
          )}

          {/* 集計表示 */}
          <MogiStats stats={stats} />

          {/* フィルター */}
          <div className="mb-6 bg-surface-raised rounded-xl border border-border p-4">
            <div className="grid grid-cols-1 md:grid-cols-6 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-text-heading mb-2">学年</label>
                <select
                  value={filterGrade}
                  onChange={(e) =>
                    setFilterGrade(e.target.value === 'all' ? 'all' : Number(e.target.value))
                  }
                  className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface-raised text-text-body"
                >
                  <option value="all">全て</option>
                  {Array.from({ length: 13 }, (_, i) => i + 1).map((grade) => (
                    <option key={grade} value={grade}>
                      {GRADE_NUMBER_TO_NAME[grade]}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-heading mb-2">模試種別</label>
                <select
                  value={filterExamType}
                  onChange={(e) => {
                    const next = e.target.value as MogiExamType | 'all';
                    setFilterExamType(next);
                    setFilterDateId('all');
                  }}
                  className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface-raised text-text-body"
                >
                  <option value="all">全て</option>
                  {MOGI_EXAM_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-heading mb-2">日程</label>
                <select
                  value={filterDateId}
                  onChange={(e) => setFilterDateId(e.target.value)}
                  className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface-raised text-text-body"
                >
                  <option value="all">全て</option>
                  {stats.date_venue_counts
                    .filter((d) => filterExamType === 'all' || d.exam_type === filterExamType)
                    .map((d) => (
                      <option key={d.date_id} value={d.date_id}>
                        {d.exam_type ? `[${MOGI_EXAM_TYPE_LABELS[d.exam_type]}] ` : ''}
                        {d.date_label}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-heading mb-2">会場</label>
                <select
                  value={filterVenueId}
                  onChange={(e) => setFilterVenueId(e.target.value)}
                  className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface-raised text-text-body"
                >
                  <option value="all">全て</option>
                  {uniqueVenueIds.map((venueId) => {
                    const venueLabel =
                      stats.date_venue_counts
                        .flatMap((d) => d.venue_counts)
                        .find((v) => v.venue_id === venueId)?.venue_label || venueId;
                    return (
                      <option key={venueId} value={venueId}>
                        {venueLabel}
                      </option>
                    );
                  })}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-heading mb-2">計上状態</label>
                <select
                  value={filterChargedStatus}
                  onChange={(e) =>
                    setFilterChargedStatus(e.target.value as 'all' | 'charged' | 'not_charged')
                  }
                  className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface-raised text-text-body"
                >
                  <option value="all">全て</option>
                  <option value="charged">計上済み</option>
                  <option value="not_charged">未計上</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-heading mb-2">
                  紐付け状態
                </label>
                <select
                  value={filterLinkedStatus}
                  onChange={(e) =>
                    setFilterLinkedStatus(e.target.value as 'all' | 'linked' | 'unlinked')
                  }
                  className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface-raised text-text-body"
                >
                  <option value="all">全て</option>
                  <option value="linked">紐付け済み</option>
                  <option value="unlinked">未紐付け</option>
                </select>
              </div>
            </div>
            <div className="flex items-center justify-between pt-4 border-t border-border/20">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showArchived}
                  onChange={(e) => setShowArchived(e.target.checked)}
                  className="w-4 h-4 text-info border-border rounded focus:ring-primary cursor-pointer"
                />
                <span className="text-sm text-text-heading flex items-center gap-2">
                  アーカイブ済みを表示
                  {archivedCount > 0 && (
                    <span className="ml-1 text-text-body/60">({archivedCount}件)</span>
                  )}
                  {isLoading && <Spinner size="xs" tone="current" className="inline-block" />}
                </span>
              </label>
            </div>
          </div>

          {/* 一括操作バー: slide-in-bar で @starting-style スライドイン */}
          {selectedIds.size > 0 && (
            <div className="slide-in-bar mb-4 p-3 bg-info-subtle border border-info/30 rounded-lg flex items-center justify-between">
              <span className="text-sm text-info">{selectedIds.size}件を選択中</span>
              <div className="flex gap-2">
                <button
                  onClick={handleBulkArchive}
                  disabled={isProcessing}
                  className="px-3 py-1 bg-surface-hover text-text-body text-sm rounded hover:bg-border active:scale-[0.97] disabled:opacity-50 transition-[transform,background-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]"
                >
                  一括アーカイブ
                </button>
                {permissions?.canDeleteFormResponses && (
                  <button
                    onClick={handleBulkDelete}
                    disabled={isProcessing}
                    className="px-3 py-1 bg-danger text-white text-sm rounded hover:bg-danger/90 active:scale-[0.97] disabled:opacity-50 transition-[transform,background-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]"
                  >
                    一括削除
                  </button>
                )}
                <button
                  onClick={() => setSelectedIds(new Set())}
                  className="px-3 py-1 text-text-muted text-sm hover:text-text-body transition-colors duration-150"
                >
                  選択解除
                </button>
              </div>
            </div>
          )}

          {/* 回答一覧 */}
          <div className="bg-surface-raised rounded-xl border border-border overflow-hidden">
            {isLoading ? (
              <div className="p-8">
                <Loading size="md" />
              </div>
            ) : responses.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-text-body">
                  回答がありません。保護者ポータルから申込が届くとここに表示されます。
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-surface-hover border-b border-border">
                      <th className="px-2 py-3 text-center w-10">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          onChange={(e) => handleSelectAll(e.target.checked)}
                          className="w-4 h-4 text-info border-border rounded focus:ring-primary cursor-pointer"
                        />
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-text-heading uppercase">
                        回答日時
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-text-heading uppercase">
                        生徒名
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-text-heading uppercase">
                        学年
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-text-heading uppercase">
                        模試種別・日程・会場
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-text-heading uppercase">
                        計上
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-text-heading uppercase">
                        紐付け
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-text-heading uppercase">
                        操作
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {responses.map((response) => (
                      <tr
                        key={response.id}
                        className={`border-b border-border/20 hover:bg-surface-hover transition-colors duration-150 ${
                          response.is_archived ? 'bg-gray-100 opacity-60' : ''
                        }`}
                      >
                        <td className="px-2 py-3 text-center">
                          {!response.is_archived && (
                            <input
                              type="checkbox"
                              checked={selectedIds.has(response.id)}
                              onChange={(e) => handleSelect(response.id, e.target.checked)}
                              className="w-4 h-4 text-info border-border rounded focus:ring-primary cursor-pointer"
                            />
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-text-body">
                          {formatDate(response.created_at)}
                        </td>
                        <td className="px-4 py-3 text-sm text-text-heading font-medium">
                          {response.linked_student
                            ? `${response.linked_student.last_name} ${response.linked_student.first_name}`
                            : response.student_name}
                        </td>
                        <td className="px-4 py-3 text-sm text-text-body">
                          {GRADE_NUMBER_TO_NAME[response.grade] || response.grade}
                        </td>
                        <td className="px-4 py-3 text-sm text-text-body">
                          {renderSelections(response.response_data.selections)}
                        </td>
                        <td className="px-4 py-3 text-sm text-text-body">
                          <input
                            type="checkbox"
                            checked={response.status_checks?.charged || false}
                            onChange={(e) => handleChargedToggle(response.id, e.target.checked)}
                            className="w-4 h-4 text-info border-border rounded focus:ring-primary cursor-pointer"
                          />
                        </td>
                        <td className="px-4 py-3 text-sm text-text-body">
                          {response.linked_student_id ? (
                            <span className="text-text-heading font-medium">済</span>
                          ) : (
                            <span className="text-text-body/60">未</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-2">
                            {response.is_archived ? (
                              <>
                                <span className="px-2 py-1 text-xs bg-surface-hover text-text-muted rounded">
                                  アーカイブ済
                                </span>
                                <button
                                  className="px-3 py-1 text-xs bg-surface-hover text-info rounded hover:bg-info-subtle active:scale-[0.97] transition-[transform,background-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]"
                                  onClick={() => handleUnarchive(response.id)}
                                  disabled={isProcessing}
                                >
                                  戻す
                                </button>
                                {permissions?.canDeleteFormResponses && (
                                  <button
                                    className="px-3 py-1 text-xs bg-surface-hover text-danger rounded hover:bg-danger-subtle active:scale-[0.97] transition-[transform,background-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]"
                                    onClick={() => handleDelete(response.id)}
                                    disabled={isProcessing}
                                  >
                                    削除
                                  </button>
                                )}
                              </>
                            ) : (
                              <>
                                <button
                                  className="px-3 py-1 text-xs bg-surface-hover text-text-body rounded hover:bg-border active:scale-[0.97] transition-[transform,background-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]"
                                  onClick={() => setDetailResponse(response)}
                                >
                                  詳細
                                </button>
                                {response.linked_student_id ? (
                                  <button
                                    className="px-3 py-1 text-xs bg-surface-hover text-text-body rounded hover:bg-border active:scale-[0.97] transition-[transform,background-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]"
                                    onClick={() => handleUnlinkStudent(response.id)}
                                  >
                                    解除
                                  </button>
                                ) : (
                                  <button
                                    className="px-3 py-1 text-xs bg-surface-hover text-text-body rounded hover:bg-border active:scale-[0.97] transition-[transform,background-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]"
                                    onClick={() => handleOpenLinkModal(response)}
                                  >
                                    紐付け
                                  </button>
                                )}
                                <button
                                  className="px-3 py-1 text-xs bg-surface-hover text-text-muted rounded hover:bg-border active:scale-[0.97] transition-[transform,background-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]"
                                  onClick={() => handleArchive(response.id)}
                                  disabled={isProcessing}
                                >
                                  アーカイブ
                                </button>
                                {permissions?.canDeleteFormResponses && (
                                  <button
                                    className="px-3 py-1 text-xs bg-surface-hover text-danger rounded hover:bg-danger-subtle active:scale-[0.97] transition-[transform,background-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]"
                                    onClick={() => handleDelete(response.id)}
                                    disabled={isProcessing}
                                  >
                                    削除
                                  </button>
                                )}
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
              form_type: 'mogi',
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
          <MogiResponseDetailModal
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
