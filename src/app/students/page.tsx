'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Button, Modal } from '@/components/ui';
import {
  StudentForm,
  StudentTable,
  DeleteConfirmDialog,
  StudentDetailModal,
  StudentScores,
  StudentRegularScheduleList,
  RegularScheduleFormModal,
  BulkGradeUpdateModal,
} from '@/components/students';
import {
  getStudents,
  createStudent,
  updateStudent,
  deleteStudent,
  bulkDeleteStudents,
  moveStudentsToSchool,
} from '@/lib/api/students';
import { getSchools } from '@/lib/api/schools';
import type { School } from '@/types/database';
import type { Student, StudentInsert, StudentUpdate, Subject } from '@/types/database';
import {
  generateStudentCSV,
  generateAssessmentCSV,
  generateInterviewCSV,
  downloadCSV,
} from '@/lib/utils/csvUtils';
import { StudentCsvImportModal } from '@/components/csv/StudentCsvImportModal';
import { listAssessmentsBySchool } from '@/lib/api/assessments';
import { getInterviewsBySchool } from '@/lib/api/interviews';
import type { ScheduleRegularPattern, ScheduleTimeSlot } from '@/types/schedule';
import { GRADE_LABELS } from '@/types/database';
import { useRequirePermission } from '@/hooks/usePermissions';
import AccessDenied from '@/components/AccessDenied';
import { AdminLayout } from '@/components/layouts';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertBoard } from '@/components/alerts';
import { BulletinBoard } from '@/components/bulletin';
import { NewResponsesBoard } from '@/components/responses/NewResponsesBoard';
import { RecentUpdatesBoard } from '@/components/students/RecentUpdatesBoard';
import { useToast } from '@/hooks/useToast';
import { ToastContainer } from '@/components/ui';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';

export default function StudentsPage() {
  // 権限チェック
  const { hasPermission, isLoading: permissionLoading } = useRequirePermission(
    (p) => p.canAccessStudents
  );
  const { getSelectedSchoolIds, selectedSchoolId, profile } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  
  // 講師かどうかを判定
  const isTeacher = profile?.role === 'teacher';
  const { toasts, removeToast, success } = useToast();
  // 状態管理
  const [students, setStudents] = useState<(Student & { subjects?: Subject[] })[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  
  // 在籍状況フィルター（デフォルトは在籍中のみ表示）
  const [showInactive, setShowInactive] = useState(false);
  
  // 学年フィルター
  const [selectedGrade, setSelectedGrade] = useState<number | 'all'>('all');

  // モーダル関連
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [isScoresModalOpen, setIsScoresModalOpen] = useState(false);
  const [isBulkGradeUpdateModalOpen, setIsBulkGradeUpdateModalOpen] = useState(false);
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [scheduleModalStudent, setScheduleModalStudent] = useState<Student | null>(null);
  const [addScheduleFormContext, setAddScheduleFormContext] = useState<{
    student: Student;
    timeSlots: { id: string; slot_number: number; start_time: string; end_time: string }[];
    teachers: { id: string; display_name: string | null; email: string | null }[];
    subjects: Subject[];
    pattern?: ScheduleRegularPattern | null;
  } | null>(null);
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCsvImportModalOpen, setIsCsvImportModalOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  // 選択状態
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // 一括削除確認
  const [isBulkDeleteDialogOpen, setIsBulkDeleteDialogOpen] = useState(false);

  // 選択生徒の教室移動
  const [isMoveSelectedModalOpen, setIsMoveSelectedModalOpen] = useState(false);
  const [moveTargetSchoolId, setMoveTargetSchoolId] = useState('');
  const [schools, setSchools] = useState<School[]>([]);

  // エラーメッセージ
  const [errorMessage, setErrorMessage] = useState('');

  // 生徒一覧を取得
  const fetchStudents = useCallback(async (query?: string) => {
    setIsLoading(true);
    setErrorMessage('');
    try {
      const schoolIds = getSelectedSchoolIds();
      const data = await getStudents(query, schoolIds);
      setStudents(data);
    } catch (error) {
      console.error('Error fetching students:', error);
      setErrorMessage(
        getUserErrorMessage(error, '生徒一覧の取得に失敗しました')
      );
    } finally {
      setIsLoading(false);
    }
  }, [getSelectedSchoolIds]);

  // URLパラメータ ?edit=studentId で編集モーダルを自動起動
  useEffect(() => {
    const editId = searchParams.get('edit');
    if (editId && students.length > 0 && !isLoading) {
      const student = students.find((s) => s.id === editId);
      if (student) {
        setSelectedStudent(student);
        setIsEditModalOpen(true);
        // URLからパラメータを消す
        router.replace('/students', { scroll: false });
      }
    }
  }, [searchParams, students, isLoading, router]);

  // フィルター済みの生徒一覧
  const filteredStudents = useMemo(() => {
    let filtered = students;
    
    // 在籍状況フィルター
    if (!showInactive) {
      filtered = filtered.filter((student) => student.status === 'active');
    }
    
    // 学年フィルター
    if (selectedGrade !== 'all') {
      filtered = filtered.filter((student) => student.grade === selectedGrade);
    }
    
    return filtered;
  }, [students, showInactive, selectedGrade]);

  // 初回読み込みと教室選択変更時の再読み込み
  useEffect(() => {
    if (selectedSchoolId !== null) {
      fetchStudents();
    }
  }, [fetchStudents, selectedSchoolId]);

  // 検索（デバウンス処理）
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchStudents(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, fetchStudents]);

  // エクスポートメニュー外クリックで閉じる
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setExportMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // CSVエクスポート: 生徒一覧
  const handleExportStudents = () => {
    setIsExporting(true);
    setExportMenuOpen(false);
    try {
      const csv = generateStudentCSV(students);
      const date = new Date().toISOString().slice(0, 10);
      downloadCSV(csv, `生徒一覧_${date}.csv`);
    } catch (err) {
      setErrorMessage(getUserErrorMessage(err, '生徒一覧のエクスポートに失敗しました'));
    } finally {
      setIsExporting(false);
    }
  };

  // CSVエクスポート: 成績
  const handleExportAssessments = async () => {
    setIsExporting(true);
    setExportMenuOpen(false);
    try {
      const schoolIds = getSelectedSchoolIds();
      const map = await listAssessmentsBySchool(schoolIds);
      const csv = generateAssessmentCSV(students, map);
      const date = new Date().toISOString().slice(0, 10);
      downloadCSV(csv, `成績一覧_${date}.csv`);
    } catch (err) {
      setErrorMessage(getUserErrorMessage(err, '成績データのエクスポートに失敗しました'));
    } finally {
      setIsExporting(false);
    }
  };

  // CSVエクスポート: 面談記録
  const handleExportInterviews = async () => {
    setIsExporting(true);
    setExportMenuOpen(false);
    try {
      const schoolIds = getSelectedSchoolIds();
      const map = await getInterviewsBySchool(schoolIds);
      const csv = generateInterviewCSV(students, map);
      const date = new Date().toISOString().slice(0, 10);
      downloadCSV(csv, `面談記録_${date}.csv`);
    } catch (err) {
      setErrorMessage(getUserErrorMessage(err, '面談記録のエクスポートに失敗しました'));
    } finally {
      setIsExporting(false);
    }
  };

  // 新規登録モーダルを開く
  const handleOpenCreateModal = () => {
    setIsCreateModalOpen(true);
  };

  // 編集モーダルを開く（詳細モーダルから開く場合は詳細を閉じて前面に表示）
  const handleOpenEditModal = (student: Student) => {
    setSelectedStudent(student);
    setIsDetailModalOpen(false);
    setIsEditModalOpen(true);
  };

  // 削除ダイアログを開く
  const handleOpenDeleteDialog = (student: Student) => {
    setSelectedStudent(student);
    setIsDeleteDialogOpen(true);
  };

  // 新規登録
  const handleCreate = async (
    data: StudentInsert | StudentUpdate,
    subjectIds?: string[]
  ) => {
    setIsSubmitting(true);
    setErrorMessage('');
    try {
      await createStudent(data as StudentInsert, subjectIds);
      setIsCreateModalOpen(false);
      await fetchStudents(searchQuery);
    } catch (error) {
      console.error('Error creating student:', error);
      setErrorMessage(
        getUserErrorMessage(error, '生徒の登録に失敗しました')
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // 更新
  const handleUpdate = async (
    data: StudentInsert | StudentUpdate,
    subjectIds?: string[]
  ) => {
    if (!selectedStudent) return;

    setIsSubmitting(true);
    setErrorMessage('');
    try {
      const update = data as StudentUpdate;
      await updateStudent(selectedStudent.id, update, subjectIds);
      setIsEditModalOpen(false);
      // ステータス変更時のトースト案内
      if (update.status && update.status !== selectedStudent.status) {
        const statusLabel = update.status === 'withdrawn' ? '退会' : update.status === 'inactive' ? '休会' : '在籍中';
        success(`${selectedStudent.last_name} ${selectedStudent.first_name} を「${statusLabel}」に変更しました`);
        if ((update.status === 'withdrawn' || update.status === 'inactive') && !showInactive) {
          success('退会・休会の生徒を表示するには「退会済み表示」をONにしてください');
        }
      } else {
        success('生徒情報を更新しました');
      }
      setSelectedStudent(null);
      await fetchStudents(searchQuery);
    } catch (error) {
      console.error('Error updating student:', error);
      setErrorMessage(
        getUserErrorMessage(error, '生徒情報の更新に失敗しました')
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // 詳細モーダルを開く
  const handleOpenDetailModal = (student: Student) => {
    setSelectedStudent(student);
    setIsDetailModalOpen(true);
  };

  // 進行表を開く
  const handleOpenProgress = (student: Student) => {
    router.push(`/students/${student.id}/progress`);
  };

  // 面談記録を開く（直接面談記録ページに遷移）
  const handleOpenInterviews = (student: Student) => {
    router.push(`/students/${student.id}/interviews`);
  };

  // 成績推移ページへ遷移
  const handleOpenScores = (student: Student) => {
    router.push(`/students/${student.id}/scores`);
  };

  // 通塾日程モーダルを直接開く（その生徒の授業設定）
  const handleOpenSchedule = (student: Student) => {
    setScheduleModalStudent(student);
    setIsScheduleModalOpen(true);
    setIsDetailModalOpen(false);
    setSelectedStudent(null);
  };

  // 一括削除
  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    setIsSubmitting(true);
    setErrorMessage('');
    try {
      await bulkDeleteStudents(Array.from(selectedIds));
      setIsBulkDeleteDialogOpen(false);
      setSelectedIds(new Set());
      await fetchStudents(searchQuery);
    } catch (error) {
      console.error('Error bulk deleting students:', error);
      setErrorMessage(
        getUserErrorMessage(error, '一括削除に失敗しました')
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // 選択した生徒を教室移動
  const handleMoveSelected = async () => {
    if (selectedIds.size === 0 || !moveTargetSchoolId) return;
    setIsSubmitting(true);
    setErrorMessage('');
    try {
      const count = await moveStudentsToSchool(Array.from(selectedIds), moveTargetSchoolId);
      setIsMoveSelectedModalOpen(false);
      setMoveTargetSchoolId('');
      setSelectedIds(new Set());
      if (count > 0) {
        await fetchStudents(searchQuery);
      }
    } catch (error) {
      console.error('Error moving students:', error);
      setErrorMessage(
        getUserErrorMessage(error, '教室移動に失敗しました')
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // 教室移動モーダルを開くときに教室一覧を取得
  const handleOpenMoveSelectedModal = async () => {
    try {
      const allSchools = await getSchools();
      setSchools(allSchools.filter((s) => !s.is_demo));
      setIsMoveSelectedModalOpen(true);
    } catch (error) {
      console.error('Error fetching schools:', error);
      setErrorMessage('教室一覧の取得に失敗しました');
    }
  };

  // 削除（論理削除、詳細モーダルから呼ばれる場合もある）
  const handleDelete = async () => {
    if (!selectedStudent) return;

    setIsSubmitting(true);
    setErrorMessage('');
    try {
      await deleteStudent(selectedStudent.id);
      setIsDeleteDialogOpen(false);
      setSelectedStudent(null);
      await fetchStudents(searchQuery);
    } catch (error) {
      console.error('Error deleting student:', error);
      setErrorMessage(
        getUserErrorMessage(error, '生徒の削除に失敗しました')
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // 権限チェック中
  if (permissionLoading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <div className="w-12 h-12 border-4 border-[#1e3a5f] border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-gray-500">読み込み中...</p>
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
    <AdminLayout
      headerTitle="生徒管理"
      headerOnBulkGradeUpdateClick={!isTeacher ? () => setIsBulkGradeUpdateModalOpen(true) : undefined}
    >
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      {/* エラーメッセージ */}
        {errorMessage && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl">
            <div className="flex items-center gap-2">
              <svg
                className="w-5 h-5 text-[#c62828]"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <p className="text-sm text-[#c62828]">{errorMessage}</p>
            </div>
          </div>
        )}

        {/* 閲覧専用バッジ（講師向け） */}
        {isTeacher && (
          <div className="mb-4 flex items-center gap-2 px-3 py-1.5 bg-blue-50 border border-blue-200 rounded-lg w-fit">
            <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
            <span className="text-xs font-medium text-blue-600">閲覧専用モード</span>
          </div>
        )}

        {/* 新着申し込み通知 ＆ 更新履歴 */}
        {!isTeacher && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            <NewResponsesBoard />
            <RecentUpdatesBoard
              onStudentClick={(studentId) => {
                const student = students.find((s) => s.id === studentId);
                if (student) handleOpenDetailModal(student);
              }}
            />
          </div>
        )}

        {/* 掲示板とアラート */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          <BulletinBoard />
          <AlertBoard />
        </div>

        {/* ツールバー */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          {/* 左側: 検索 + フィルターボタン */}
          <div className="flex flex-col sm:flex-row gap-3">
            {/* 検索 */}
            <div className="w-full sm:w-72">
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <svg
                    className="w-5 h-5 text-gray-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                    />
                  </svg>
                </div>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="氏名・フリガナ・コードで検索..."
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm bg-white text-[#1a1a1a] focus:ring-2 focus:ring-[#1e3a5f]/30 focus:border-[#1e3a5f] placeholder:text-gray-400"
                />
              </div>
            </div>

            {/* 学年フィルター */}
            <select
              value={selectedGrade}
              onChange={(e) => setSelectedGrade(e.target.value === 'all' ? 'all' : Number(e.target.value))}
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm bg-white text-[#1a1a1a] focus:ring-2 focus:ring-[#1e3a5f]/30 focus:border-[#1e3a5f]"
            >
              <option value="all">全学年</option>
              {Array.from({ length: 13 }, (_, i) => i + 1).map((grade) => (
                <option key={grade} value={grade}>
                  {GRADE_LABELS[grade] || `学年${grade}`}
                </option>
              ))}
            </select>

            {/* 休会・退会表示ボタン（講師には非表示） */}
            {!isTeacher && (
              <button
                onClick={() => {
                  const next = !showInactive;
                  setShowInactive(next);
                  if (next) {
                    const inactiveCount = students.filter((s) => s.status !== 'active').length;
                    if (inactiveCount === 0) {
                      success('現在、休会・退会の生徒はいません');
                    }
                  }
                }}
                className={`
                  inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors
                  ${
                    showInactive
                      ? 'bg-[#1e3a5f] text-white hover:bg-[#1e3a5f]/90 border border-[#1e3a5f]'
                      : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50'
                  }
                `}
              >
              {showInactive ? (
                <>
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                    />
                  </svg>
                  全員表示中
                </>
              ) : (
                <>
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
                    />
                  </svg>
                  休会・退会を表示
                </>
              )}
              </button>
            )}
          </div>

          {/* CSV / 新規登録ボタン（講師には非表示） */}
          {!isTeacher && (
            <div className="flex items-center gap-2">
              {/* CSVエクスポート ドロップダウン */}
              <div className="relative" ref={exportMenuRef}>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setExportMenuOpen((prev) => !prev)}
                  disabled={isExporting}
                >
                  {isExporting ? 'エクスポート中...' : 'CSVエクスポート ▾'}
                </Button>
                {exportMenuOpen && (
                  <div className="absolute right-0 top-full mt-1 bg-white rounded-lg shadow-lg border border-[#e5e7eb] z-50 min-w-[140px] overflow-hidden">
                    {[
                      { label: '生徒一覧', onClick: handleExportStudents },
                      { label: '成績', onClick: handleExportAssessments },
                      { label: '面談記録', onClick: handleExportInterviews },
                    ].map((item) => (
                      <button
                        key={item.label}
                        onClick={item.onClick}
                        className="w-full text-left px-4 py-2 text-sm text-[#1f2937] hover:bg-[#f3f4f6] transition-colors"
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsCsvImportModalOpen(true)}
              >
                CSVインポート
              </Button>
<Button onClick={handleOpenCreateModal}>
                <svg
                  className="w-4 h-4 mr-2"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 4v16m8-8H4"
                  />
                </svg>
                新規登録
              </Button>
            </div>
          )}
        </div>

        {/* 一括操作バー */}
        {!isTeacher && selectedIds.size > 0 && (
          <div className="mb-4 flex items-center gap-3 p-3 bg-[#1e3a5f]/5 border border-[#1e3a5f]/20 rounded-lg">
            <span className="text-sm font-medium text-[#1e3a5f]">
              {selectedIds.size}件選択中
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={handleOpenMoveSelectedModal}
            >
              教室移動
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => setIsBulkDeleteDialogOpen(true)}
            >
              一括削除
            </Button>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="ml-auto text-sm text-gray-500 hover:text-gray-700"
            >
              選択解除
            </button>
          </div>
        )}

        {/* 生徒一覧テーブル */}
        <StudentTable
          students={filteredStudents}
          onEdit={!isTeacher ? handleOpenEditModal : undefined}
          onDelete={!isTeacher ? handleOpenDeleteDialog : undefined}
          onRowClick={handleOpenDetailModal}
          onScores={handleOpenScores}
          onProgress={handleOpenProgress}
          onInterviews={handleOpenInterviews}
          onSchedule={!isTeacher ? handleOpenSchedule : undefined}
          isLoading={isLoading}
          selectedIds={!isTeacher ? selectedIds : undefined}
          onSelectionChange={!isTeacher ? setSelectedIds : undefined}
        />

      {/* CSVインポートモーダル */}
      <StudentCsvImportModal
        isOpen={isCsvImportModalOpen}
        onClose={() => setIsCsvImportModalOpen(false)}
        schoolId={getSelectedSchoolIds()[0] ?? ''}
        onImportComplete={() => fetchStudents(searchQuery)}
        existingStudentCodes={
          new Set(
            students
              .map((s) => s.student_code)
              .filter((c): c is string => !!c)
          )
        }
      />

{/* 新規登録モーダル */}
      <Modal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        title="生徒の新規登録"
        size="md"
      >
        <StudentForm
          onSubmit={handleCreate}
          onCancel={() => setIsCreateModalOpen(false)}
          isLoading={isSubmitting}
        />
      </Modal>

      {/* 編集モーダル */}
      <Modal
        isOpen={isEditModalOpen}
        onClose={() => {
          setIsEditModalOpen(false);
          setSelectedStudent(null);
        }}
        title="生徒情報の編集"
        size="md"
      >
        <StudentForm
          student={selectedStudent}
          onSubmit={handleUpdate}
          onCancel={() => {
            setIsEditModalOpen(false);
            setSelectedStudent(null);
          }}
          isLoading={isSubmitting}
        />
      </Modal>

      {/* 削除確認ダイアログ */}
      <DeleteConfirmDialog
        isOpen={isDeleteDialogOpen}
        student={selectedStudent}
        onConfirm={handleDelete}
        onCancel={() => {
          setIsDeleteDialogOpen(false);
          setSelectedStudent(null);
        }}
        isLoading={isSubmitting}
      />

      {/* 詳細モーダル */}
      <StudentDetailModal
        isOpen={isDetailModalOpen}
        student={selectedStudent}
        onClose={() => {
          setIsDetailModalOpen(false);
          setSelectedStudent(null);
        }}
        onEdit={handleOpenEditModal}
        onOpenSchedule={!isTeacher ? handleOpenSchedule : undefined}
        onDelete={
          !isTeacher
            ? async (student) => {
                await deleteStudent(student.id);
                setSelectedStudent(null);
                setIsDetailModalOpen(false);
                await fetchStudents(searchQuery);
              }
            : undefined
        }
      />

      {/* 通塾日程 追加/編集フォーム（モーダル外で表示・重なり防止） */}
      {addScheduleFormContext && (
        <RegularScheduleFormModal
          open={true}
          onClose={() => setAddScheduleFormContext(null)}
          studentId={addScheduleFormContext.student.id}
          schoolId={addScheduleFormContext.student.school_id ?? ''}
          studentGrade={addScheduleFormContext.student.grade}
          pattern={addScheduleFormContext.pattern ?? null}
          timeSlots={addScheduleFormContext.timeSlots as ScheduleTimeSlot[]}
          teachers={addScheduleFormContext.teachers}
          subjects={addScheduleFormContext.subjects}
          onSuccess={() => {
            fetchStudents(searchQuery);
            setAddScheduleFormContext(null);
          }}
        />
      )}

      {/* 通塾日程モーダル（生徒の授業設定を直接編集） */}
      <Modal
        isOpen={isScheduleModalOpen}
        onClose={() => {
          setIsScheduleModalOpen(false);
          setScheduleModalStudent(null);
        }}
        title={scheduleModalStudent ? `${scheduleModalStudent.last_name} ${scheduleModalStudent.first_name} の通塾日程` : '通塾日程'}
        size="lg"
      >
        {scheduleModalStudent && (
          <StudentRegularScheduleList
            studentId={scheduleModalStudent.id}
            schoolId={scheduleModalStudent.school_id ?? ''}
            studentName={`${scheduleModalStudent.last_name} ${scheduleModalStudent.first_name}`}
            studentGrade={scheduleModalStudent.grade}
            onRefresh={() => fetchStudents(searchQuery)}
            onOpenAddForm={(ctx) => {
              setIsScheduleModalOpen(false);
              setAddScheduleFormContext({
                student: scheduleModalStudent,
                timeSlots: ctx.timeSlots,
                teachers: ctx.teachers,
                subjects: ctx.subjects,
              });
            }}
            onOpenEditForm={(ctx) => {
              setIsScheduleModalOpen(false);
              setAddScheduleFormContext({
                student: scheduleModalStudent,
                timeSlots: ctx.timeSlots,
                teachers: ctx.teachers,
                subjects: ctx.subjects,
                pattern: ctx.pattern,
              });
            }}
          />
        )}
      </Modal>

      {/* 成績管理モーダル */}
      {selectedStudent && (
        <StudentScores
          student={selectedStudent}
          isOpen={isScoresModalOpen}
          onClose={() => {
            setIsScoresModalOpen(false);
            setSelectedStudent(null);
          }}
        />
      )}

      {/* 一括削除確認ダイアログ */}
      <Modal
        isOpen={isBulkDeleteDialogOpen}
        onClose={() => setIsBulkDeleteDialogOpen(false)}
        title="生徒の一括削除"
        size="sm"
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 w-10 h-10 rounded-full bg-[#ef4444]/20 flex items-center justify-center">
              <svg
                className="w-5 h-5 text-[#ef4444]"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            </div>
            <div>
              <p className="text-[#1f2937]">
                選択した <span className="font-bold">{selectedIds.size}名</span> の生徒を削除してもよろしいですか？
              </p>
              <p className="mt-3 text-sm text-[#4b5563]">
                削除後もデータは保持されますが、一覧には表示されなくなります。
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t border-[#e5e7eb]">
            <Button variant="secondary" onClick={() => setIsBulkDeleteDialogOpen(false)}>
              キャンセル
            </Button>
            <Button variant="danger" onClick={handleBulkDelete} isLoading={isSubmitting}>
              {selectedIds.size}名を削除する
            </Button>
          </div>
        </div>
      </Modal>

      {/* 選択生徒の教室移動モーダル */}
      <Modal
        isOpen={isMoveSelectedModalOpen}
        onClose={() => {
          setIsMoveSelectedModalOpen(false);
          setMoveTargetSchoolId('');
        }}
        title="選択した生徒の教室移動"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-[#4b5563]">
            選択した <span className="font-bold">{selectedIds.size}名</span> の生徒を移動します。
          </p>
          <div>
            <label className="block text-sm font-medium text-[#1f2937] mb-1">
              移動先の教室
            </label>
            <select
              value={moveTargetSchoolId}
              onChange={(e) => setMoveTargetSchoolId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white text-[#1a1a1a] focus:ring-2 focus:ring-[#1e3a5f]/30 focus:border-[#1e3a5f]"
            >
              <option value="">教室を選択...</option>
              {schools.map((school) => (
                <option key={school.id} value={school.id}>
                  {school.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t border-[#e5e7eb]">
            <Button
              variant="secondary"
              onClick={() => {
                setIsMoveSelectedModalOpen(false);
                setMoveTargetSchoolId('');
              }}
            >
              キャンセル
            </Button>
            <Button
              onClick={handleMoveSelected}
              isLoading={isSubmitting}
              disabled={!moveTargetSchoolId}
            >
              移動する
            </Button>
          </div>
        </div>
      </Modal>

      {/* 一括学年更新モーダル */}
      <BulkGradeUpdateModal
        isOpen={isBulkGradeUpdateModalOpen}
        onClose={() => setIsBulkGradeUpdateModalOpen(false)}
        onSuccess={fetchStudents}
        schoolIds={getSelectedSchoolIds()}
      />
    </AdminLayout>
  );
}
