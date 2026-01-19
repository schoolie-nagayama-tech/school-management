'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AdminLayout } from '@/components/layouts';
import { Button, Select } from '@/components/ui';
import { getStudent } from '@/lib/api/students';
import { getStudentTextbooks } from '@/lib/api/progress';
import { getStudentProgress, convertToDisplayRows } from '@/lib/api/progress';
import ParentProgressTable from '@/components/students/ParentProgressTable';
import { useAuth } from '@/contexts/AuthContext';
import { useRequirePermission } from '@/hooks/usePermissions';
import AccessDenied from '@/components/AccessDenied';
import type { Student, StudentTextbookWithDetails, ProgressRowDisplay } from '@/types/database';

export default function StudentProgressPage() {
  // 権限チェック
  const { hasPermission, isLoading: permissionLoading } = useRequirePermission(
    (p) => p.canAccessProgress
  );
  const { getSelectedSchoolIds, selectedSchoolId } = useAuth();
  const params = useParams();
  const router = useRouter();
  const studentId = params?.studentId as string;

  const [student, setStudent] = useState<Student | null>(null);
  const [textbooks, setTextbooks] = useState<StudentTextbookWithDetails[]>([]);
  const [selectedTextbookId, setSelectedTextbookId] = useState<string>('');
  const [displayRows, setDisplayRows] = useState<ProgressRowDisplay[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  // 生徒情報とテキスト一覧を取得
  const fetchStudentAndTextbooks = useCallback(async () => {
    if (!studentId) return;

    setIsLoading(true);
    setErrorMessage('');
    try {
      const schoolIds = getSelectedSchoolIds();
      const [studentData, textbooksData] = await Promise.all([
        getStudent(studentId, schoolIds),
        getStudentTextbooks(studentId),
      ]);

      if (!studentData) {
        setErrorMessage('生徒が見つかりません');
        return;
      }

      setStudent(studentData);
      setTextbooks(textbooksData);

      // 最初のテキストを選択
      if (textbooksData.length > 0 && !selectedTextbookId) {
        setSelectedTextbookId(textbooksData[0].id);
      }
    } catch (error) {
      console.error('Error fetching student and textbooks:', error);
      setErrorMessage(
        error instanceof Error ? error.message : 'データの取得に失敗しました'
      );
    } finally {
      setIsLoading(false);
    }
  }, [studentId, getSelectedSchoolIds, selectedTextbookId]);

  // 進行表データを取得
  const fetchProgress = useCallback(async () => {
    if (!selectedTextbookId) return;

    setIsLoading(true);
    setErrorMessage('');
    try {
      const progressData = await getStudentProgress(selectedTextbookId);
      // progressDataはCurriculumItemWithProgress[]なので、curriculumItemとprogressに分離
      const items = progressData.map(item => ({
        id: item.id,
        textbook_id: item.textbook_id,
        item_number: item.item_number,
        title: item.title,
        item_type: item.item_type,
        sort_order: item.sort_order,
        created_at: item.created_at,
      }));
      // StudentProgressWithDetailsからStudentProgressに変換（lessonsは含まれるが型としてはStudentProgressとして扱う）
      const progressList = progressData
        .map(item => item.progress)
        .filter((p): p is NonNullable<typeof p> => p !== null && p !== undefined)
        .map(p => ({
          id: p.id,
          student_textbook_id: p.student_textbook_id,
          curriculum_item_id: p.curriculum_item_id,
          proposal_count: p.proposal_count,
          application_count: p.application_count,
          exam_range_exam_type: p.exam_range_exam_type,
          school_progress_date: p.school_progress_date,
          handover: p.handover,
          group_number: p.group_number,
          created_at: p.created_at,
          updated_at: p.updated_at,
        })) as any; // lessonsは含まれるが型チェックを回避
      const rows = convertToDisplayRows(items, progressList);
      // lessonsを再度マッピング（ParentProgressTableで使用するため）
      const rowsWithLessons = rows.map(row => {
        const progressWithDetails = progressData.find(
          item => item.id === row.curriculumItem.id
        )?.progress;
        return {
          ...row,
          progress: progressWithDetails || row.progress,
        };
      });
      setDisplayRows(rowsWithLessons);
    } catch (error) {
      console.error('Error fetching progress:', error);
      setErrorMessage(
        error instanceof Error ? error.message : '進行表の取得に失敗しました'
      );
    } finally {
      setIsLoading(false);
    }
  }, [selectedTextbookId]);

  // 初回読み込み
  useEffect(() => {
    if (selectedSchoolId !== null) {
      fetchStudentAndTextbooks();
    }
  }, [fetchStudentAndTextbooks, selectedSchoolId]);

  // テキスト選択時
  useEffect(() => {
    if (selectedTextbookId) {
      fetchProgress();
    }
  }, [selectedTextbookId, fetchProgress]);

  // 権限チェック中
  if (permissionLoading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <div className="w-12 h-12 border-4 border-[#ff8e3c] border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-[#2a2a2a]">読み込み中...</p>
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

  const selectedTextbook = textbooks.find(t => t.id === selectedTextbookId);
  const studentName = student ? `${student.last_name} ${student.first_name}` : '';
  const textbookName = selectedTextbook?.textbook?.name || '';

  return (
    <AdminLayout headerTitle="学習進行表">
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
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[#0d0d0d]">
          {studentName ? `${studentName} の進行表` : '学習進行表'}
        </h1>
        <Button onClick={() => router.push('/students')} variant="secondary">
          生徒一覧に戻る
        </Button>
      </div>

      {/* テキスト選択 */}
      {textbooks.length > 0 && (
        <div className="mb-6">
          <label className="block text-sm font-medium text-[#0d0d0d] mb-2">
            テキストを選択
          </label>
          <Select
            value={selectedTextbookId}
            onChange={(e) => setSelectedTextbookId(e.target.value)}
            className="max-w-md"
            options={textbooks.map((textbook) => ({
              value: textbook.id,
              label: textbook.textbook?.name || '不明なテキスト',
            }))}
          />
        </div>
      )}

      {/* 進行表 */}
      {isLoading ? (
        <div className="flex items-center justify-center min-h-[40vh]">
          <div className="text-center">
            <div className="w-12 h-12 border-4 border-[#ff8e3c] border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-[#2a2a2a]">読み込み中...</p>
          </div>
        </div>
      ) : textbooks.length === 0 ? (
        <div className="bg-[#fffffe] rounded-xl border border-[#0d0d0d] p-8 text-center">
          <p className="text-[#2a2a2a] mb-4">この生徒にはテキストが紐付けられていません。</p>
          <Button onClick={() => router.push(`/students/${studentId}`)}>
            生徒詳細に戻る
          </Button>
        </div>
      ) : displayRows.length === 0 ? (
        <div className="bg-[#fffffe] rounded-xl border border-[#0d0d0d] p-8 text-center">
          <p className="text-[#2a2a2a] mb-4">進行表データがありません。</p>
        </div>
      ) : (
        <div className="bg-[#fffffe] rounded-xl border border-[#0d0d0d] p-6">
          <ParentProgressTable
            displayRows={displayRows}
            studentName={studentName}
            textbookName={textbookName}
            showProposalCount={true}
            showApplicationCount={true}
            showExamRange={true}
            showSchoolProgress={true}
            showLesson1={true}
            showLesson2={true}
            showLesson3={true}
            showHandover={true}
          />
        </div>
      )}
    </AdminLayout>
  );
}
