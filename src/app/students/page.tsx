'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import dynamic from 'next/dynamic';
import { Button, Modal, Loading } from '@/components/ui';
import Link from 'next/link';
import { Plus, AlertCircle, Eye, EyeOff, AlertTriangle, Mic, Search, ClipboardPaste } from 'lucide-react';
import { ContextHelp } from '@/components/help/ContextHelp';
import {
  StudentForm,
  StudentTable,
  DeleteConfirmDialog,
  StudentDetailModal,
} from '@/components/students';

const StudentScores = dynamic(
  () => import('@/components/students').then((m) => m.StudentScores),
  { ssr: false }
);
const AttendanceMatrix = dynamic(
  () => import('@/components/students').then((m) => m.AttendanceMatrix),
  { ssr: false }
);
import {
  getStudents,
  getStudentsPage,
  getStudent,
  getStudentCodesInSchools,
  countNonActiveStudents,
  createStudent,
  updateStudent,
  deleteStudent,
  bulkDeleteStudents,
  moveStudentsToSchool,
} from '@/lib/api/students';
import { useMasterData } from '@/contexts/MasterDataContext';
import type { Student, StudentInsert, StudentUpdate, Subject } from '@/types/database';
import {
  generateStudentCSV,
  generateAssessmentCSV,
  generateInterviewCSV,
  downloadCSV,
} from '@/lib/utils/csvUtils';
import { listAssessmentsBySchool } from '@/lib/api/assessments';
import { getInterviewsBySchool } from '@/lib/api/interviews';
import { GRADE_LABELS } from '@/types/database';
import { useRequirePermission } from '@/hooks/usePermissions';
import AccessDenied from '@/components/AccessDenied';
import { AdminLayout } from '@/components/layouts';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertBoard } from '@/components/alerts';
import { AttendanceUnsubmittedAlert } from '@/components/attendance/AttendanceUnsubmittedAlert';
import { TaskProgressWidget } from '@/components/monthly-tasks/TaskProgressWidget';
import { useToast } from '@/hooks/useToast';
import { ToastContainer } from '@/components/ui';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';

const BulletinBoard = dynamic(
  () => import('@/components/bulletin/BulletinBoard').then((m) => m.BulletinBoard),
  {
    loading: () => <div className="h-64 rounded-xl bg-surface border border-border-subtle" />,
  }
);

// 外部ツール（Grow・らくプリ等）への上部クイックリンク
const QuickLinksBar = dynamic(
  () => import('@/components/quick-links/QuickLinksBar').then((m) => m.QuickLinksBar),
  { ssr: false }
);

const NotificationFeed = dynamic(
  () => import('@/components/notifications/NotificationFeed').then((m) => m.NotificationFeed),
  {
    loading: () => <div className="h-48 rounded-xl bg-surface border border-border-subtle" />,
  }
);

const ScoreListView = dynamic(
  () => import('@/components/score-list').then((m) => m.ScoreListView),
  {
    loading: () => (
      <div className="py-12 text-center text-sm text-text-muted">成績一覧を読み込み中...</div>
    ),
  }
);

const StudentCsvImportModalDynamic = dynamic(
  () => import('@/components/csv/StudentCsvImportModal').then((m) => m.StudentCsvImportModal),
  { loading: () => null }
);

const BulkGradeUpdateModalDynamic = dynamic(
  () =>
    import('@/components/students/BulkGradeUpdateModal').then((m) => m.BulkGradeUpdateModal),
  { loading: () => null }
);

const MockPasteImportModalDynamic = dynamic(
  () =>
    import('@/components/scores/MockPasteImportModal').then((m) => m.MockPasteImportModal),
  { loading: () => null }
);

export default function StudentsPage() {
  // 権限チェック
  const { hasPermission, isLoading: permissionLoading } = useRequirePermission(
    (p) => p.canAccessStudents
  );
  const { getSelectedSchoolIds, selectedSchoolId, profile } = useAuth();
  const { schools: masterSchools } = useMasterData();
  const router = useRouter();
  const searchParams = useSearchParams();
  
  // 講師かどうかを判定
  const isTeacher = profile?.role === 'teacher';
  const { toasts, removeToast, success } = useToast();
  // 状態管理（名簿タブはサーバページング、成績タブは従来どおり全件）
  const [rosterRows, setRosterRows] = useState<(Student & { subjects?: Subject[] })[]>([]);
  const [rosterTotalCount, setRosterTotalCount] = useState(0);
  const [studentsForScores, setStudentsForScores] = useState<(Student & { subjects?: Subject[] })[]>(
    []
  );
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  
  // 在籍状況フィルター（デフォルトは在籍中のみ表示）
  const [showInactive, setShowInactive] = useState(false);
  
  // 学年フィルター
  const [selectedGrade, setSelectedGrade] = useState<number | 'all'>('all');

  const ITEMS_PER_PAGE = 100;
  const [currentPage, setCurrentPage] = useState(1);

  // タブ切り替え
  type TabType = 'roster' | 'report_card' | 'regular_test' | 'mock';
  const [activeTab, setActiveTab] = useState<TabType>(() => {
    if (isTeacher) return 'roster';
    const tab = searchParams.get('tab');
    if (tab === 'report_card' || tab === 'regular_test' || tab === 'mock') return tab;
    return 'roster';
  });

  // モーダル関連
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [isScoresModalOpen, setIsScoresModalOpen] = useState(false);
  const [isBulkGradeUpdateModalOpen, setIsBulkGradeUpdateModalOpen] = useState(false);
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [scheduleModalStudent, setScheduleModalStudent] = useState<Student | null>(null);
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCsvImportModalOpen, setIsCsvImportModalOpen] = useState(false);
  const [isMockPasteModalOpen, setIsMockPasteModalOpen] = useState(false);
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
  const moveSchoolOptions = useMemo(
    () => masterSchools.filter((s) => !s.is_demo),
    [masterSchools]
  );

  // TaskProgressWidget へ渡す配列を安定化（毎レンダリングで新規配列を渡すと
  // 子コンポーネントが不要に再レンダリングされるため）
  const taskProgressSchoolIds = useMemo(() => getSelectedSchoolIds(), [getSelectedSchoolIds]);
  const taskProgressSchools = useMemo(
    () => moveSchoolOptions.map((s) => ({ id: s.id, name: s.name })),
    [moveSchoolOptions]
  );

  // エラーメッセージ
  const [errorMessage, setErrorMessage] = useState('');

  const [existingStudentCodes, setExistingStudentCodes] = useState<Set<string>>(new Set());

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const reloadRosterPage = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    if (!silent) setIsLoading(true);
    setErrorMessage('');
    try {
      const schoolIds = getSelectedSchoolIds();
      if (schoolIds.length === 0) {
        setRosterRows([]);
        setRosterTotalCount(0);
        if (!silent) setIsLoading(false);
        return;
      }
      const { rows, totalCount } = await getStudentsPage({
        searchQuery: debouncedSearch,
        schoolIds,
        activeOnly: !showInactive,
        grade: selectedGrade,
        offset: (currentPage - 1) * ITEMS_PER_PAGE,
        limit: ITEMS_PER_PAGE,
      });
      setRosterRows(rows);
      setRosterTotalCount(totalCount);
    } catch (error) {
      console.error('Error fetching roster:', error);
      setErrorMessage(getUserErrorMessage(error, '生徒一覧の取得に失敗しました'));
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, [getSelectedSchoolIds, debouncedSearch, showInactive, selectedGrade, currentPage]);

  const reloadScoresStudents = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    if (!silent) setIsLoading(true);
    setErrorMessage('');
    try {
      const schoolIds = getSelectedSchoolIds();
      if (schoolIds.length === 0) {
        setStudentsForScores([]);
        if (!silent) setIsLoading(false);
        return;
      }
      const data = await getStudents(debouncedSearch, schoolIds);
      setStudentsForScores(data);
    } catch (error) {
      console.error('Error fetching students for scores:', error);
      setErrorMessage(getUserErrorMessage(error, '生徒一覧の取得に失敗しました'));
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, [getSelectedSchoolIds, debouncedSearch]);

  const refreshCodes = useCallback(() => {
    const schoolIds = getSelectedSchoolIds();
    if (schoolIds.length === 0) {
      setExistingStudentCodes(new Set());
      return;
    }
    getStudentCodesInSchools(schoolIds)
      .then(setExistingStudentCodes)
      .catch(() => setExistingStudentCodes(new Set()));
  }, [getSelectedSchoolIds]);

  useEffect(() => {
    refreshCodes();
  }, [refreshCodes, selectedSchoolId]);

  const syncListsAfterMutation = useCallback(async () => {
    // silent: ローディング表示を出さずに再取得することでスクロール位置を保持
    if (activeTab === 'roster') {
      await reloadRosterPage({ silent: true });
    } else {
      await reloadScoresStudents({ silent: true });
    }
    refreshCodes();
  }, [activeTab, reloadRosterPage, reloadScoresStudents, refreshCodes]);

  // 検索のデバウンス後 & 名簿用フィルタ・ページ変更で再取得
  useEffect(() => {
    if (selectedSchoolId === null || activeTab !== 'roster') return;
    void reloadRosterPage();
  }, [
    selectedSchoolId,
    activeTab,
    debouncedSearch,
    currentPage,
    showInactive,
    selectedGrade,
    reloadRosterPage,
  ]);

  useEffect(() => {
    if (selectedSchoolId === null || activeTab === 'roster') return;
    void reloadScoresStudents();
  }, [selectedSchoolId, activeTab, debouncedSearch, reloadScoresStudents]);

  // URLパラメータ ?edit=studentId で編集モーダルを自動起動（1 editId につき 1 回のみ）
  const handledEditIdRef = useRef<string | null>(null);
  useEffect(() => {
    const editId = searchParams.get('edit');
    if (!editId) {
      handledEditIdRef.current = null;
      return;
    }
    if (handledEditIdRef.current === editId) return;
    handledEditIdRef.current = editId;

    void (async () => {
      const student = await getStudent(editId, getSelectedSchoolIds());
      if (student) {
        setSelectedStudent(student);
        setIsEditModalOpen(true);
        router.replace('/students', { scroll: false });
      }
    })();
  }, [searchParams, router, getSelectedSchoolIds]);

  // 成績タブ用（クライアント側で在籍・学年フィルタ）
  const filteredStudents = useMemo(() => {
    let filtered = studentsForScores;

    if (!showInactive) {
      filtered = filtered.filter((student) => student.status === 'active');
    }

    if (selectedGrade !== 'all') {
      filtered = filtered.filter((student) => student.grade === selectedGrade);
    }

    return filtered;
  }, [studentsForScores, showInactive, selectedGrade]);

  // フィルタ・検索変更時は名簿のページを先頭へ
  useEffect(() => {
    setCurrentPage(1);
  }, [showInactive, selectedGrade, searchQuery]);

  const rosterTotalPages = Math.max(1, Math.ceil(rosterTotalCount / ITEMS_PER_PAGE));

  // エクスポートメニュー外クリックで閉じる（開いている間だけリスナーを貼る）
  useEffect(() => {
    if (!exportMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setExportMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [exportMenuOpen]);

  // CSVエクスポート: ページングは無視するが、画面の在籍/学年フィルタは適用する
  const runExport = useCallback(
    async (
      errorLabel: string,
      build: (
        students: (Student & { subjects?: Subject[] })[],
        schoolIds: string[]
      ) => Promise<{ csv: string; filename: string }> | { csv: string; filename: string }
    ) => {
      setIsExporting(true);
      setExportMenuOpen(false);
      try {
        const schoolIds = getSelectedSchoolIds();
        const all = await getStudents(searchQuery, schoolIds);
        const filtered = all.filter((s) => {
          if (!showInactive && s.status !== 'active') return false;
          if (selectedGrade !== 'all' && s.grade !== selectedGrade) return false;
          return true;
        });
        const { csv, filename } = await build(filtered, schoolIds);
        downloadCSV(csv, filename);
      } catch (err) {
        setErrorMessage(getUserErrorMessage(err, errorLabel));
      } finally {
        setIsExporting(false);
      }
    },
    [searchQuery, getSelectedSchoolIds, showInactive, selectedGrade]
  );

  const handleExportStudents = useCallback(
    () =>
      runExport('生徒一覧のエクスポートに失敗しました', (students) => {
        const date = new Date().toISOString().slice(0, 10);
        return { csv: generateStudentCSV(students), filename: `生徒一覧_${date}.csv` };
      }),
    [runExport]
  );

  const handleExportAssessments = useCallback(
    () =>
      runExport('成績データのエクスポートに失敗しました', async (students, schoolIds) => {
        const map = await listAssessmentsBySchool(schoolIds);
        const date = new Date().toISOString().slice(0, 10);
        return { csv: generateAssessmentCSV(students, map), filename: `成績一覧_${date}.csv` };
      }),
    [runExport]
  );

  const handleExportInterviews = useCallback(
    () =>
      runExport('面談記録のエクスポートに失敗しました', async (students, schoolIds) => {
        const map = await getInterviewsBySchool(schoolIds);
        const date = new Date().toISOString().slice(0, 10);
        return { csv: generateInterviewCSV(students, map), filename: `面談記録_${date}.csv` };
      }),
    [runExport]
  );

  // 新規登録モーダルを開く
  const handleOpenCreateModal = useCallback(() => {
    setIsCreateModalOpen(true);
  }, []);

  // 編集モーダルを開く（詳細モーダルから開く場合は詳細を閉じて前面に表示）
  const handleOpenEditModal = useCallback((student: Student) => {
    setSelectedStudent(student);
    setIsDetailModalOpen(false);
    setIsEditModalOpen(true);
  }, []);

  // 削除ダイアログを開く
  const handleOpenDeleteDialog = useCallback((student: Student) => {
    setSelectedStudent(student);
    setIsDeleteDialogOpen(true);
  }, []);

  // 新規登録
  const handleCreate = useCallback(async (
    data: StudentInsert | StudentUpdate
  ) => {
    setIsSubmitting(true);
    setErrorMessage('');
    try {
      const created = await createStudent(data as StudentInsert);
      setIsCreateModalOpen(false);
      await syncListsAfterMutation();
      setSelectedStudent(created);
      setIsDetailModalOpen(true);
    } catch (error) {
      setErrorMessage(
        getUserErrorMessage(error, '生徒の登録に失敗しました')
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [syncListsAfterMutation]);

  // 更新
  const handleUpdate = useCallback(async (
    data: StudentInsert | StudentUpdate
  ) => {
    if (!selectedStudent) return;

    setIsSubmitting(true);
    setErrorMessage('');
    try {
      const update = data as StudentUpdate;
      await updateStudent(selectedStudent.id, update);
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
      await syncListsAfterMutation();
    } catch (error) {
      console.error('Error updating student:', error);
      setErrorMessage(
        getUserErrorMessage(error, '生徒情報の更新に失敗しました')
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [selectedStudent, showInactive, success, syncListsAfterMutation]);

  // 詳細モーダルを開く
  const handleOpenDetailModal = useCallback((student: Student) => {
    setSelectedStudent(student);
    setIsDetailModalOpen(true);
  }, []);

  // 進行表を新しいタブで開く
  const handleOpenProgress = useCallback((student: Student) => {
    window.open(`/students/${student.id}/progress`, '_blank', 'noopener,noreferrer');
  }, []);

  // 面談記録を新しいタブで開く
  const handleOpenInterviews = useCallback((student: Student) => {
    window.open(`/students/${student.id}/interviews`, '_blank', 'noopener,noreferrer');
  }, []);

  // 成績推移ページを新しいタブで開く
  const handleOpenScores = useCallback((student: Student) => {
    window.open(`/students/${student.id}/scores`, '_blank', 'noopener,noreferrer');
  }, []);

  // 通塾日程モーダルを直接開く（その生徒の授業設定）
  const handleOpenSchedule = useCallback((student: Student) => {
    setScheduleModalStudent(student);
    setIsScheduleModalOpen(true);
    setIsDetailModalOpen(false);
    setSelectedStudent(null);
  }, []);

  // 一括削除
  const handleBulkDelete = useCallback(async () => {
    if (selectedIds.size === 0) return;
    setIsSubmitting(true);
    setErrorMessage('');
    try {
      await bulkDeleteStudents(Array.from(selectedIds));
      setIsBulkDeleteDialogOpen(false);
      setSelectedIds(new Set());
      await syncListsAfterMutation();
    } catch (error) {
      console.error('Error bulk deleting students:', error);
      setErrorMessage(
        getUserErrorMessage(error, '一括削除に失敗しました')
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [selectedIds, syncListsAfterMutation]);

  // 選択した生徒を教室移動
  const handleMoveSelected = useCallback(async () => {
    if (selectedIds.size === 0 || !moveTargetSchoolId) return;
    setIsSubmitting(true);
    setErrorMessage('');
    try {
      const count = await moveStudentsToSchool(Array.from(selectedIds), moveTargetSchoolId);
      setIsMoveSelectedModalOpen(false);
      setMoveTargetSchoolId('');
      setSelectedIds(new Set());
      if (count > 0) {
        await syncListsAfterMutation();
      }
    } catch (error) {
      console.error('Error moving students:', error);
      setErrorMessage(
        getUserErrorMessage(error, '教室移動に失敗しました')
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [selectedIds, moveTargetSchoolId, syncListsAfterMutation]);

  const handleOpenMoveSelectedModal = () => {
    setIsMoveSelectedModalOpen(true);
  };

  // 削除（論理削除、詳細モーダルから呼ばれる場合もある）
  const handleDelete = useCallback(async () => {
    if (!selectedStudent) return;

    setIsSubmitting(true);
    setErrorMessage('');
    try {
      await deleteStudent(selectedStudent.id);
      setIsDeleteDialogOpen(false);
      setSelectedStudent(null);
      await syncListsAfterMutation();
    } catch (error) {
      console.error('Error deleting student:', error);
      setErrorMessage(
        getUserErrorMessage(error, '生徒の削除に失敗しました')
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [selectedStudent, syncListsAfterMutation]);

  // 権限チェック中
  if (permissionLoading) {
    return (
      <AdminLayout>
        <Loading className="min-h-[60vh]" />
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
              <AlertCircle className="w-5 h-5 text-danger" />
              <p className="text-sm text-danger">{errorMessage}</p>
            </div>
          </div>
        )}

        {/* 出勤簿未提出アラート（講師向け） */}
        {isTeacher && <AttendanceUnsubmittedAlert />}

        {/* 外部ツール（Grow・らくプリ等）クイックリンク + コンテキストヘルプ：
            ヘルプアイコン単体で1行使うのは縦余白が無駄なため、クイックリンクと横並びにする */}
        <div className="mb-4 flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <QuickLinksBar />
          </div>
          <ContextHelp
            searchQuery="生徒"
            topics={[
              {
                title: '生徒を新規登録する',
                description: '生徒情報を手動で追加します。',
                steps: [
                  '「新規登録」ボタンをクリック',
                  'フォームに氏名・学年・所属教室を入力',
                  '「保存」をクリックして登録完了',
                ],
              },
              {
                title: '生徒の詳細を確認・編集する',
                description: '成績や面談記録など生徒の全情報を確認できます。',
                steps: [
                  '一覧から生徒名をクリック',
                  '詳細モーダルが開き、タブで情報を切替',
                  '「編集」で情報を変更、「保存」で確定',
                ],
              },
              {
                title: '生徒を検索・フィルタする',
                description: '名前や学年で素早く絞り込みます。',
                steps: [
                  '検索バーに氏名・フリガナ・コードを入力',
                  '学年フィルタや在籍状況で絞り込み',
                ],
              },
            ]}
          />
        </div>

        {/* 業務進捗ウィジェット（教室長以上のみ） */}
        {!isTeacher && <TaskProgressWidget schoolIds={taskProgressSchoolIds} schoolId={selectedSchoolId || undefined} schools={taskProgressSchools} />}

        {/* 講師: 連絡掲示板 ↔ アラート を横並び / 管理側: 従来のレイアウト */}
        {isTeacher ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            <BulletinBoard />
            <AlertBoard />
          </div>
        ) : (
          <>
            <div className="mb-4">
              <BulletinBoard />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
              <AlertBoard />
              <NotificationFeed
              onStudentClick={({ studentId, studentName, schoolId }) => {
                void (async () => {
                  const pools = [...rosterRows, ...studentsForScores];
                  let student: Student | undefined = studentId
                    ? pools.find((s) => s.id === studentId)
                    : undefined;
                  if (!student && studentName) {
                    const normalize = (s: string) => s.replace(/[\s\u3000]+/g, '');
                    const normalizedInput = normalize(studentName);
                    student = pools.find((s) => {
                      const normalizedFull = normalize(`${s.last_name}${s.first_name}`);
                      return normalizedFull === normalizedInput && (!schoolId || s.school_id === schoolId);
                    });
                    if (!student) {
                      student = pools.find((s) => {
                        const normalizedFull = normalize(`${s.last_name}${s.first_name}`);
                        return normalizedFull === normalizedInput;
                      });
                    }
                  }
                  if (!student && studentId) {
                    const loaded = await getStudent(studentId, getSelectedSchoolIds());
                    if (loaded) student = loaded;
                  }
                  if (student) handleOpenDetailModal(student);
                })();
              }}
            />
            </div>
          </>
        )}

        {/* タブナビゲーション */}
        <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 mb-6">
        <div className="flex items-center gap-0 border-b border-border min-w-max sm:min-w-0">
          {([
            { key: 'roster' as TabType, label: '生徒名簿' },
            ...(!isTeacher ? [
              { key: 'report_card' as TabType, label: '内申集計' },
              { key: 'regular_test' as TabType, label: 'テスト点数集計' },
              { key: 'mock' as TabType, label: '模試結果集計' },
            ] : []),
          ] as const).map((tab) => (
            <button
              key={tab.key}
              onClick={() => {
                setActiveTab(tab.key);
                router.replace(`/students${tab.key === 'roster' ? '' : `?tab=${tab.key}`}`, { scroll: false });
              }}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-[color,border-color] duration-150 ease-out whitespace-nowrap ${
                activeTab === tab.key
                  ? 'border-ink text-ink'
                  : 'border-transparent text-text-muted hover:text-text-body hover:border-border-strong'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        </div>

        {/* 成績一覧タブ（講師には非表示） */}
        {activeTab !== 'roster' && !isTeacher && (
          <div>
            {/* 学年フィルター + 模試一括取り込みボタン */}
            <div className="flex items-center gap-3 mb-4">
              <select
                value={selectedGrade}
                onChange={(e) => setSelectedGrade(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                className="px-4 py-2 border border-border-strong rounded-lg text-sm bg-surface-raised text-text-heading focus:ring-2 focus:ring-ink/30 focus:border-ink"
              >
                <option value="all">全学年</option>
                {Array.from({ length: 13 }, (_, i) => i + 1).map((grade) => (
                  <option key={grade} value={grade}>
                    {GRADE_LABELS[grade] || `学年${grade}`}
                  </option>
                ))}
              </select>
              {activeTab === 'mock' && !isTeacher && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsMockPasteModalOpen(true)}
                >
                  <ClipboardPaste className="w-4 h-4 mr-1.5" />
                  模試結果の一括取り込み
                </Button>
              )}
            </div>
            <ScoreListView
              category={activeTab}
              students={filteredStudents}
              schoolIds={getSelectedSchoolIds()}
            />
          </div>
        )}

        {/* ===== 生徒名簿タブ（既存） ===== */}
        {activeTab === 'roster' && <>
        {/* ツールバー */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          {/* 左側: 検索 + フィルターボタン */}
          <div className="flex flex-col sm:flex-row gap-3">
            {/* 検索 */}
            <div className="w-full sm:w-72">
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Search className="w-5 h-5 text-text-faint" />
                </div>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="氏名・フリガナ・コードで検索..."
                  className="w-full pl-10 pr-4 py-2 border border-border-strong rounded-lg text-sm bg-surface-raised text-text-heading focus:ring-2 focus:ring-ink/30 focus:border-ink placeholder:text-text-faint"
                />
              </div>
            </div>

            {/* 学年フィルター */}
            <select
              value={selectedGrade}
              onChange={(e) => setSelectedGrade(e.target.value === 'all' ? 'all' : Number(e.target.value))}
              className="px-4 py-2 border border-border-strong rounded-lg text-sm bg-surface-raised text-text-heading focus:ring-2 focus:ring-ink/30 focus:border-ink"
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
                  void (async () => {
                    const next = !showInactive;
                    setShowInactive(next);
                    if (next) {
                      const schoolIds = getSelectedSchoolIds();
                      const inactiveCount = await countNonActiveStudents(searchQuery, schoolIds, {
                        grade: selectedGrade,
                      });
                      if (inactiveCount === 0) {
                        success('現在、休会・退会の生徒はいません');
                      }
                    }
                  })();
                }}
                className={`
                  inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-[background-color,color,border-color] duration-150 ease-out active:scale-[0.97]
                  ${
                    showInactive
                      ? 'bg-ink text-white hover:bg-ink/90 border border-ink'
                      : 'bg-surface-raised text-text-body border border-border-strong hover:bg-surface-hover'
                  }
                `}
              >
              {showInactive ? (
                <>
                  <Eye className="w-4 h-4" />
                  全員表示中
                </>
              ) : (
                <>
                  <EyeOff className="w-4 h-4" />
                  休会・退会を表示
                </>
              )}
              </button>
            )}
          </div>

          {/* CSV / 新規登録ボタン（講師には非表示） */}
          {!isTeacher && (
            <div className="flex flex-wrap items-center gap-2">
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
                  <div className="absolute right-0 top-full mt-1 bg-surface-raised rounded-lg shadow-lg border border-border z-50 min-w-[140px] overflow-hidden origin-top-right animate-[popover-enter_150ms_cubic-bezier(0.23,1,0.32,1)]">
                    {[
                      { label: '生徒一覧', onClick: handleExportStudents },
                      { label: '成績', onClick: handleExportAssessments },
                      { label: '面談記録', onClick: handleExportInterviews },
                    ].map((item) => (
                      <button
                        key={item.label}
                        onClick={item.onClick}
                        className="w-full text-left px-4 py-2 text-sm text-text-heading hover:bg-surface-hover transition-[background-color] duration-150 ease-out"
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
              <Link
                href="/transcriptions"
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-text-body border border-border-default rounded-lg hover:bg-surface-hover transition-[background-color] duration-150 ease-out"
              >
                <Mic className="w-3.5 h-3.5" />
                面談記録追加
              </Link>
              <Button onClick={handleOpenCreateModal}>
                <Plus className="w-4 h-4 mr-2" />
                新規登録
              </Button>
            </div>
          )}
        </div>

        {/* 一括操作バー */}
        {!isTeacher && selectedIds.size > 0 && (
          <div className="mb-4 flex items-center gap-3 p-3 bg-ink/5 border border-ink/20 rounded-lg slide-in-bar">
            <span className="text-sm font-medium text-ink">
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
              className="ml-auto text-sm text-text-muted hover:text-text-body transition-[color] duration-150 ease-out"
            >
              選択解除
            </button>
          </div>
        )}

        {/* 生徒一覧テーブル */}
        <StudentTable
          students={rosterRows}
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

        {/* ページネーション */}
        {rosterTotalPages > 1 && (
          <div className="flex items-center justify-between mt-4 px-2">
            <span className="text-sm text-text-muted">
              {rosterTotalCount}件中 {(currentPage - 1) * ITEMS_PER_PAGE + 1}〜
              {Math.min(currentPage * ITEMS_PER_PAGE, rosterTotalCount)}件を表示
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setCurrentPage(1)}
                disabled={currentPage === 1}
                className="px-2 py-1 text-sm rounded border border-border disabled:opacity-40 hover:bg-surface-hover transition-[background-color] duration-150 ease-out active:scale-[0.97]"
              >
                «
              </button>
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-3 py-1 text-sm rounded border border-border disabled:opacity-40 hover:bg-surface-hover transition-[background-color] duration-150 ease-out active:scale-[0.97]"
              >
                ‹ 前
              </button>
              <span className="px-3 py-1 text-sm text-ink font-medium tabular-nums">
                {currentPage} / {rosterTotalPages}
              </span>
              <button
                onClick={() => setCurrentPage((p) => Math.min(rosterTotalPages, p + 1))}
                disabled={currentPage === rosterTotalPages}
                className="px-3 py-1 text-sm rounded border border-border disabled:opacity-40 hover:bg-surface-hover transition-[background-color] duration-150 ease-out active:scale-[0.97]"
              >
                次 ›
              </button>
              <button
                onClick={() => setCurrentPage(rosterTotalPages)}
                disabled={currentPage === rosterTotalPages}
                className="px-2 py-1 text-sm rounded border border-border disabled:opacity-40 hover:bg-surface-hover transition-[background-color] duration-150 ease-out active:scale-[0.97]"
              >
                »
              </button>
            </div>
          </div>
        )}
        </>}

      {/* CSVインポートモーダル */}
      <StudentCsvImportModalDynamic
        isOpen={isCsvImportModalOpen}
        onClose={() => setIsCsvImportModalOpen(false)}
        schoolId={getSelectedSchoolIds()[0] ?? ''}
        onImportComplete={() => void syncListsAfterMutation()}
        existingStudentCodes={existingStudentCodes}
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
          schools={masterSchools.filter((s) => !s.is_demo)}
          defaultSchoolId={selectedSchoolId !== 'all' ? (selectedSchoolId ?? '') : (masterSchools.find((s) => !s.is_demo)?.id ?? '')}
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
        onDelete={
          !isTeacher
            ? async (student) => {
                await deleteStudent(student.id);
                setSelectedStudent(null);
                setIsDetailModalOpen(false);
                await syncListsAfterMutation();
              }
            : undefined
        }
      />

      {/* 通塾日程モーダル（D&Dマトリクスで直接編集） */}
      <Modal
        isOpen={isScheduleModalOpen}
        onClose={() => {
          setIsScheduleModalOpen(false);
          setScheduleModalStudent(null);
        }}
        title={scheduleModalStudent ? `${scheduleModalStudent.last_name} ${scheduleModalStudent.first_name} の通塾日程` : '通塾日程'}
        size="2xl"
      >
        {scheduleModalStudent && (
          <AttendanceMatrix
            studentId={scheduleModalStudent.id}
            schoolId={scheduleModalStudent.school_id ?? ''}
            studentGrade={scheduleModalStudent.grade}
            canEdit={!isTeacher}
            onPatternChange={() => void syncListsAfterMutation()}
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
            <div className="flex-shrink-0 w-10 h-10 rounded-full bg-danger/20 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-danger" />
            </div>
            <div>
              <p className="text-text-heading">
                選択した <span className="font-bold">{selectedIds.size}名</span> の生徒を削除してもよろしいですか？
              </p>
              <p className="mt-3 text-sm text-text-body">
                削除後もデータは保持されますが、一覧には表示されなくなります。
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t border-border">
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
          <p className="text-sm text-text-body">
            選択した <span className="font-bold">{selectedIds.size}名</span> の生徒を移動します。
          </p>
          <div>
            <label className="block text-sm font-medium text-text-heading mb-1">
              移動先の教室
            </label>
            <select
              value={moveTargetSchoolId}
              onChange={(e) => setMoveTargetSchoolId(e.target.value)}
              className="w-full px-3 py-2 border border-border-strong rounded-lg text-sm bg-surface-raised text-text-heading focus:ring-2 focus:ring-ink/30 focus:border-ink"
            >
              <option value="">教室を選択...</option>
              {moveSchoolOptions.map((school) => (
                <option key={school.id} value={school.id}>
                  {school.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t border-border">
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
      <BulkGradeUpdateModalDynamic
        isOpen={isBulkGradeUpdateModalOpen}
        onClose={() => setIsBulkGradeUpdateModalOpen(false)}
        onSuccess={() => void syncListsAfterMutation()}
        schoolIds={getSelectedSchoolIds()}
      />

      {/* 模試結果一括取り込みモーダル */}
      <MockPasteImportModalDynamic
        isOpen={isMockPasteModalOpen}
        onClose={() => setIsMockPasteModalOpen(false)}
        students={studentsForScores}
        onImportComplete={() => void syncListsAfterMutation()}
      />
    </AdminLayout>
  );
}
