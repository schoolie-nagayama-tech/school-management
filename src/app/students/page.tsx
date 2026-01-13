'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Button, Modal } from '@/components/ui';
import {
  StudentForm,
  StudentTable,
  DeleteConfirmDialog,
  StudentDetailModal,
  StudentScores,
  InterviewListModal,
} from '@/components/students';
import { TaskAlert } from '@/components/students/TaskAlert';
import { SubjectSettings } from '@/components/settings';
import { AppHeader } from '@/components/layout';
import { SoudanAlert } from '@/components/soudan/SoudanAlert';
import {
  getStudents,
  createStudent,
  updateStudent,
  deleteStudent,
} from '@/lib/api/students';
import type { Student, StudentInsert, StudentUpdate, Subject } from '@/types/database';

export default function StudentsPage() {
  
  // 状態管理
  const [students, setStudents] = useState<(Student & { subjects?: Subject[] })[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  
  // 在籍状況フィルター（デフォルトは在籍中のみ表示）
  const [showInactive, setShowInactive] = useState(false);

  // モーダル関連
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [isScoresModalOpen, setIsScoresModalOpen] = useState(false);
  const [isInterviewsModalOpen, setIsInterviewsModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // エラーメッセージ
  const [errorMessage, setErrorMessage] = useState('');

  // 生徒一覧を取得
  const fetchStudents = useCallback(async (query?: string) => {
    setIsLoading(true);
    setErrorMessage('');
    try {
      const data = await getStudents(query);
      setStudents(data);
    } catch (error) {
      console.error('Error fetching students:', error);
      setErrorMessage(
        error instanceof Error ? error.message : '生徒一覧の取得に失敗しました'
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  // フィルター済みの生徒一覧
  const filteredStudents = useMemo(() => {
    if (showInactive) {
      // 全員表示
      return students;
    }
    // 在籍中のみ表示
    return students.filter((student) => student.status === 'active');
  }, [students, showInactive]);

  // 非表示の生徒数（休塾・退塾）
  const inactiveCount = useMemo(() => {
    return students.filter((student) => student.status !== 'active').length;
  }, [students]);

  // 初回読み込み
  useEffect(() => {
    fetchStudents();
  }, [fetchStudents]);

  // 検索（デバウンス処理）
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchStudents(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, fetchStudents]);

  // 新規登録モーダルを開く
  const handleOpenCreateModal = () => {
    setIsCreateModalOpen(true);
  };

  // 編集モーダルを開く
  const handleOpenEditModal = (student: Student) => {
    // まずselectedStudentを設定
    setSelectedStudent(student);
    // 詳細モーダルが開いている場合は閉じる
    if (isDetailModalOpen) {
      setIsDetailModalOpen(false);
    }
    // 編集モーダルを開く（selectedStudentが設定された後に開く）
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
        error instanceof Error ? error.message : '生徒の登録に失敗しました'
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
      await updateStudent(selectedStudent.id, data as StudentUpdate, subjectIds);
      setIsEditModalOpen(false);
      setSelectedStudent(null);
      await fetchStudents(searchQuery);
    } catch (error) {
      console.error('Error updating student:', error);
      setErrorMessage(
        error instanceof Error ? error.message : '生徒情報の更新に失敗しました'
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

  // 成績モーダルを開く
  const handleOpenScoresModal = (student: Student) => {
    setSelectedStudent(student);
    setIsScoresModalOpen(true);
  };

  // 面談記録モーダルを開く
  const handleOpenInterviewsModal = (student: Student) => {
    setSelectedStudent(student);
    setIsInterviewsModalOpen(true);
  };

  // タスクアラートから生徒をクリックした時
  const handleTaskClick = (studentId: string) => {
    const student = students.find(s => s.id === studentId);
    if (student) {
      handleOpenInterviewsModal(student);
    }
  };

  // 削除
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
        error instanceof Error ? error.message : '生徒の削除に失敗しました'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#eff0f3]">
      <AppHeader title="生徒管理" onSettingsClick={() => setIsSettingsModalOpen(true)} />

      {/* メインコンテンツ */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* お客様相談アラート */}
        <SoudanAlert />
        
        {/* タスクアラート */}
        <TaskAlert onTaskClick={handleTaskClick} />

        {/* エラーメッセージ */}
        {errorMessage && (
          <div className="mb-6 p-4 bg-[#d9376e]/10 border border-[#d9376e] rounded-lg">
            <div className="flex items-center gap-2">
              <svg
                className="w-5 h-5 text-[#d9376e]"
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
              <p className="text-sm text-[#d9376e]">{errorMessage}</p>
            </div>
          </div>
        )}

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
                  className="w-full pl-10 pr-4 py-2 border border-[#0d0d0d] rounded-lg text-sm bg-[#fffffe] text-[#2a2a2a] focus:ring-2 focus:ring-[#ff8e3c] focus:border-[#ff8e3c]"
                />
              </div>
            </div>

            {/* 休塾・退塾表示ボタン */}
            <button
              onClick={() => setShowInactive(!showInactive)}
              className={`
                inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors
                ${
                  showInactive
                    ? 'bg-[#ff8e3c]/20 text-[#0d0d0d] hover:bg-[#ff8e3c]/30'
                    : 'bg-[#eff0f3] text-[#2a2a2a] hover:bg-[#fffffe]'
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
                  休塾・退塾を表示
                  {inactiveCount > 0 && (
                    <span className="bg-[#0d0d0d] text-[#fffffe] px-1.5 py-0.5 rounded text-xs">
                      {inactiveCount}
                    </span>
                  )}
                </>
              )}
            </button>
          </div>

          {/* 新規登録ボタン */}
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

        {/* 生徒一覧テーブル */}
        <StudentTable
          students={filteredStudents}
          onEdit={handleOpenEditModal}
          onDelete={handleOpenDeleteDialog}
          onRowClick={handleOpenDetailModal}
          onScores={handleOpenScoresModal}
          onInterviews={handleOpenInterviewsModal}
          isLoading={isLoading}
        />
      </main>

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
          // 編集モーダルが開いていない場合のみselectedStudentをクリア
          if (!isEditModalOpen) {
            setSelectedStudent(null);
          }
        }}
        onEdit={handleOpenEditModal}
      />

      {/* 成績モーダル */}
      {selectedStudent && (
        <StudentScores
          student={selectedStudent}
          isOpen={isScoresModalOpen}
          onClose={() => {
            setIsScoresModalOpen(false);
            // 他のモーダルが開いていない場合のみselectedStudentをクリア
            if (!isDetailModalOpen && !isEditModalOpen && !isInterviewsModalOpen) {
              setSelectedStudent(null);
            }
          }}
        />
      )}

      {/* 面談記録モーダル */}
      {selectedStudent && (
        <InterviewListModal
          student={selectedStudent}
          schoolId={process.env.NEXT_PUBLIC_DEFAULT_SCHOOL_ID!}
          isOpen={isInterviewsModalOpen}
          onClose={() => {
            setIsInterviewsModalOpen(false);
            // 他のモーダルが開いていない場合のみselectedStudentをクリア
            if (!isDetailModalOpen && !isEditModalOpen && !isScoresModalOpen) {
              setSelectedStudent(null);
            }
          }}
        />
      )}

      {/* 科目設定モーダル */}
      <SubjectSettings
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
      />
    </div>
  );
}
