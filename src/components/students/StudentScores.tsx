'use client';

import { useState, useEffect, useCallback } from 'react';
import type { Student, AssessmentWithScores } from '@/types/database';
import {
  listAssessments,
  createAssessmentRow,
  updateScore,
  deleteAssessmentRow,
} from '@/lib/api/assessments';
import {
  SUBJECT_CODES,
  SUBJECT_LABELS,
  ASSESSMENT_CATEGORY_LABELS,
  ASSESSMENT_NAME_OPTIONS,
  ASSESSMENT_NAME_LABELS,
  GRADE_LABELS,
} from '@/types/database';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { useAuth } from '@/contexts/AuthContext';
import { useConfirm } from '@/hooks/useConfirm';

interface StudentScoresProps {
  student: Student;
  isOpen: boolean;
  onClose: () => void;
}

type AssessmentCategory = 'regular_test' | 'report_card' | 'mock';

// 共通9科
const COMMON_9_SUBJECTS = [
  SUBJECT_CODES.ENGLISH,
  SUBJECT_CODES.MATH,
  SUBJECT_CODES.JAPANESE,
  SUBJECT_CODES.SOCIAL,
  SUBJECT_CODES.SCIENCE,
  SUBJECT_CODES.MUSIC,
  SUBJECT_CODES.ART,
  SUBJECT_CODES.TECH_HOME,
  SUBJECT_CODES.PE,
] as const;

// 5科（英数国社理）
const FIVE_SUBJECTS = [
  SUBJECT_CODES.ENGLISH,
  SUBJECT_CODES.MATH,
  SUBJECT_CODES.JAPANESE,
  SUBJECT_CODES.SOCIAL,
  SUBJECT_CODES.SCIENCE,
] as const;

// mock用の科目
const MOCK_SUBJECTS = [
  SUBJECT_CODES.ENGLISH,
  SUBJECT_CODES.MATH,
  SUBJECT_CODES.JAPANESE,
  SUBJECT_CODES.SOCIAL,
  SUBJECT_CODES.SCIENCE,
  SUBJECT_CODES.CONV_5,
  SUBJECT_CODES.CONV_4,
  SUBJECT_CODES.CONV_TOTAL,
] as const;

export function StudentScores({ student, isOpen, onClose }: StudentScoresProps) {
  const { permissions } = useAuth();
  const { confirm, ConfirmDialog } = useConfirm();
  const [assessments, setAssessments] = useState<{
    regular_test: AssessmentWithScores[];
    report_card: AssessmentWithScores[];
    mock: AssessmentWithScores[];
  }>({
    regular_test: [],
    report_card: [],
    mock: [],
  });
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [editingCell, setEditingCell] = useState<{
    assessmentId: string;
    subject: string;
  } | null>(null);
  const [cellValue, setCellValue] = useState('');
  const [newRowNameCode, setNewRowNameCode] = useState('');
  const [newRowGrade, setNewRowGrade] = useState<number>(student.grade || 1);
  const [newRowMonth, setNewRowMonth] = useState('');
  const [addingRowCategory, setAddingRowCategory] = useState<AssessmentCategory | null>(null);

  // 成績データを取得
  const fetchAssessments = useCallback(async () => {
    if (!student.id) return;

    setIsLoading(true);
    setErrorMessage('');
    try {
      const [regularTest, reportCard, mock] = await Promise.all([
        listAssessments(student.id, 'regular_test'),
        listAssessments(student.id, 'report_card'),
        listAssessments(student.id, 'mock'),
      ]);

      setAssessments({
        regular_test: regularTest,
        report_card: reportCard,
        mock,
      });
    } catch (error) {
      console.error('Error fetching assessments:', error);
      setErrorMessage(
        error instanceof Error ? error.message : '成績データの取得に失敗しました'
      );
    } finally {
      setIsLoading(false);
    }
  }, [student.id]);

  useEffect(() => {
    if (isOpen && student.id) {
      fetchAssessments();
    }
  }, [isOpen, student.id, fetchAssessments]);

  // セル編集開始
  const handleCellClick = (assessmentId: string, subject: string, currentValue: number | null) => {
    setEditingCell({ assessmentId, subject });
    setCellValue(currentValue?.toString() || '');
  };

  // セル編集確定（onBlur）
  const handleCellBlur = async (assessmentId: string, subject: string) => {
    if (!editingCell) return;

    const numValue = cellValue.trim() === '' ? null : parseFloat(cellValue);
    if (cellValue.trim() !== '' && isNaN(numValue!)) {
      // 数値でない場合は元に戻す
      setEditingCell(null);
      return;
    }

    try {
      await updateScore(assessmentId, subject, numValue);
      await fetchAssessments();
    } catch (error) {
      console.error('Error updating score:', error);
      setErrorMessage(
        error instanceof Error ? error.message : 'スコアの更新に失敗しました'
      );
    } finally {
      setEditingCell(null);
    }
  };

  // 行追加
  const handleAddRow = async (category: AssessmentCategory) => {
    if (!newRowNameCode) {
      setErrorMessage('テスト名/内申名/模試名を選択してください');
      return;
    }
    if (!newRowGrade || newRowGrade < 1 || newRowGrade > 13) {
      setErrorMessage('学年を選択してください');
      return;
    }

    try {
      await createAssessmentRow(
        student.id,
        category,
        newRowNameCode,
        newRowGrade,
        newRowMonth || null
      );
      setNewRowNameCode('');
      setNewRowGrade(student.grade || 1);
      setNewRowMonth('');
      setAddingRowCategory(null);
      await fetchAssessments();
    } catch (error) {
      console.error('Error creating assessment row:', error);
      setErrorMessage(
        error instanceof Error ? error.message : '行の追加に失敗しました'
      );
    }
  };

  // 行削除
  const handleDeleteRow = async (assessmentId: string) => {
    if (!(await confirm({ title: '削除確認', description: 'この行を削除してもよろしいですか？', confirmLabel: '削除', variant: 'danger' }))) {
      return;
    }

    try {
      await deleteAssessmentRow(assessmentId);
      await fetchAssessments();
    } catch (error) {
      console.error('Error deleting assessment row:', error);
      setErrorMessage(
        error instanceof Error ? error.message : '行の削除に失敗しました'
      );
    }
  };

  // 計算列の値を取得
  const getCalculatedValue = (
    assessment: AssessmentWithScores,
    type: 'five_sum' | 'nine_sum' | 'three_avg' | 'five_avg'
  ): string => {
    const scores = assessment.scores || [];
    const scoreMap = new Map(scores.map((s) => [s.subject, s.value]));

    if (type === 'five_sum') {
      const values = FIVE_SUBJECTS.map((subj) => scoreMap.get(subj)).filter(
        (v): v is number => v !== null && v !== undefined
      );
      if (values.length === 0) return '-';
      return values.reduce((sum, v) => sum + v, 0).toString();
    }

    if (type === 'nine_sum') {
      const values = COMMON_9_SUBJECTS.map((subj) => scoreMap.get(subj)).filter(
        (v): v is number => v !== null && v !== undefined
      );
      if (values.length === 0) return '-';
      return values.reduce((sum, v) => sum + v, 0).toString();
    }

    if (type === 'three_avg') {
      const threeSubjects = [
        SUBJECT_CODES.ENGLISH,
        SUBJECT_CODES.MATH,
        SUBJECT_CODES.JAPANESE,
      ];
      const values = threeSubjects
        .map((subj) => scoreMap.get(subj))
        .filter((v): v is number => v !== null && v !== undefined);
      if (values.length === 0) return '-';
      const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
      return avg.toFixed(1);
    }

    if (type === 'five_avg') {
      const values = FIVE_SUBJECTS.map((subj) => scoreMap.get(subj)).filter(
        (v): v is number => v !== null && v !== undefined
      );
      if (values.length === 0) return '-';
      const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
      return avg.toFixed(1);
    }

    return '-';
  };

  // セクションをレンダリング
  const renderSection = (category: AssessmentCategory, assessments: AssessmentWithScores[]) => {
    const subjects =
      category === 'mock' ? MOCK_SUBJECTS : COMMON_9_SUBJECTS;
    const isAdding = addingRowCategory === category;

    return (
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-[#1f2937]">
            {ASSESSMENT_CATEGORY_LABELS[category]}
          </h3>
          {!isAdding && permissions?.canEditScores && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setAddingRowCategory(category);
                setNewRowNameCode('');
                setNewRowGrade(student.grade || 1);
                setNewRowMonth('');
              }}
            >
              + 行追加
            </Button>
          )}
        </div>

        {isAdding && (
          <div className="mb-4 p-4 bg-[#f3f4f6] rounded-lg border border-[#e5e7eb]">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
              <div className="md:col-span-1">
                <label className="block text-sm font-medium text-[#1f2937] mb-1">
                  {category === 'regular_test'
                    ? 'テスト名'
                    : category === 'report_card'
                    ? '内申名'
                    : '模試名'}
                  <span className="text-[#ef4444] ml-1">*</span>
                </label>
                <select
                  value={newRowNameCode}
                  onChange={(e) => setNewRowNameCode(e.target.value)}
                  className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm bg-white text-[#4b5563] focus:ring-2 focus:ring-[#3b82f6] focus:border-[#3b82f6]"
                  autoFocus
                >
                  <option value="">選択してください</option>
                  {ASSESSMENT_NAME_OPTIONS[category].map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-1">
                <label className="block text-sm font-medium text-[#1f2937] mb-1">
                  学年
                  <span className="text-[#ef4444] ml-1">*</span>
                </label>
                <select
                  value={newRowGrade}
                  onChange={(e) => setNewRowGrade(parseInt(e.target.value))}
                  className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm bg-white text-[#4b5563] focus:ring-2 focus:ring-[#3b82f6] focus:border-[#3b82f6]"
                >
                  {Array.from({ length: 13 }, (_, i) => i + 1).map((grade) => (
                    <option key={grade} value={grade}>
                      {GRADE_LABELS[grade]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-1">
                <label className="block text-sm font-medium text-[#1f2937] mb-1">
                  年月
                </label>
                <input
                  type="month"
                  value={newRowMonth}
                  onChange={(e) => setNewRowMonth(e.target.value)}
                  className="w-full px-3 py-2 border border-[#e5e7eb] rounded-lg text-sm bg-white text-[#4b5563] focus:ring-2 focus:ring-[#3b82f6] focus:border-[#3b82f6]"
                />
              </div>
              <div className="md:col-span-1 flex gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => handleAddRow(category)}
                  disabled={!newRowNameCode || !newRowGrade}
                >
                  追加
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setAddingRowCategory(null);
                    setNewRowNameCode('');
                    setNewRowGrade(student.grade || 1);
                    setNewRowMonth('');
                  }}
                >
                  キャンセル
                </Button>
              </div>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full border-collapse border border-[#e5e7eb] bg-white">
            <thead>
              <tr className="bg-[#f3f4f6]">
                <th className="border border-[#e5e7eb] px-3 py-2 text-left text-sm font-semibold text-[#1f2937] sticky left-0 z-10 bg-[#f3f4f6]">
                  {category === 'regular_test'
                    ? 'テスト名'
                    : category === 'report_card'
                    ? '内申名'
                    : '模試名'}
                </th>
                <th className="border border-[#e5e7eb] px-3 py-2 text-left text-sm font-semibold text-[#1f2937]">
                  学年
                </th>
                <th className="border border-[#e5e7eb] px-3 py-2 text-left text-sm font-semibold text-[#1f2937]">
                  年月
                </th>
                {subjects.map((subj) => (
                  <th
                    key={subj}
                    className="border border-[#e5e7eb] px-3 py-2 text-center text-sm font-semibold text-[#1f2937] min-w-[80px]"
                  >
                    {SUBJECT_LABELS[subj]}
                  </th>
                ))}
                {category === 'mock' ? (
                  <>
                    <th className="border border-[#e5e7eb] px-3 py-2 text-center text-sm font-semibold text-[#1f2937]">
                      3科平均
                    </th>
                    <th className="border border-[#e5e7eb] px-3 py-2 text-center text-sm font-semibold text-[#1f2937]">
                      5科平均
                    </th>
                  </>
                ) : (
                  <>
                    <th className="border border-[#e5e7eb] px-3 py-2 text-center text-sm font-semibold text-[#1f2937]">
                      5科合計
                    </th>
                    <th className="border border-[#e5e7eb] px-3 py-2 text-center text-sm font-semibold text-[#1f2937]">
                      9科合計
                    </th>
                  </>
                )}
                <th className="border border-[#e5e7eb] px-3 py-2 text-center text-sm font-semibold text-[#1f2937]">
                  操作
                </th>
              </tr>
            </thead>
            <tbody>
              {assessments.length === 0 ? (
                <tr>
                  <td
                    colSpan={
                      subjects.length + (category === 'mock' ? 6 : 6)
                    }
                    className="border border-[#e5e7eb] px-3 py-4 text-center text-[#4b5563]"
                  >
                    データがありません
                  </td>
                </tr>
              ) : (
                assessments.map((assessment) => (
                  <tr key={assessment.id} className="hover:bg-[#f3f4f6]">
                    <td className="border border-[#e5e7eb] px-3 py-2 text-sm text-[#1f2937] sticky left-0 z-10 bg-white">
                      {ASSESSMENT_NAME_LABELS[assessment.name_code] || assessment.name_code}
                    </td>
                    <td className="border border-[#e5e7eb] px-3 py-2 text-sm text-[#4b5563]">
                      {GRADE_LABELS[assessment.grade] || assessment.grade}
                    </td>
                    <td className="border border-[#e5e7eb] px-3 py-2 text-sm text-[#4b5563]">
                      {assessment.exam_month
                        ? `${new Date(assessment.exam_month).getFullYear()}-${String(new Date(assessment.exam_month).getMonth() + 1).padStart(2, '0')}`
                        : '-'}
                    </td>
                    {subjects.map((subj) => {
                      const score = assessment.scores.find((s) => s.subject === subj);
                      const value = score?.value ?? null;
                      const isEditing =
                        editingCell?.assessmentId === assessment.id &&
                        editingCell?.subject === subj;

                      return (
                        <td
                          key={subj}
                          className="border border-[#e5e7eb] px-3 py-2 text-center"
                        >
                          {isEditing ? (
                            <input
                              type="text"
                              value={cellValue}
                              onChange={(e) => setCellValue(e.target.value)}
                              onBlur={() => handleCellBlur(assessment.id, subj)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  handleCellBlur(assessment.id, subj);
                                } else if (e.key === 'Escape') {
                                  setEditingCell(null);
                                }
                              }}
                              className="w-full px-2 py-1 text-center border border-[#e5e7eb] rounded focus:outline-none focus:ring-2 focus:ring-[#3b82f6]"
                              autoFocus
                            />
                          ) : (
                            <div
                              className="px-2 py-1 cursor-pointer hover:bg-[#f3f4f6] rounded min-h-[32px] flex items-center justify-center"
                              onClick={() => handleCellClick(assessment.id, subj, value)}
                            >
                              {value !== null ? value.toString() : '-'}
                            </div>
                          )}
                        </td>
                      );
                    })}
                    {category === 'mock' ? (
                      <>
                        <td className="border border-[#e5e7eb] px-3 py-2 text-center text-sm text-[#4b5563] font-medium">
                          {getCalculatedValue(assessment, 'three_avg')}
                        </td>
                        <td className="border border-[#e5e7eb] px-3 py-2 text-center text-sm text-[#4b5563] font-medium">
                          {getCalculatedValue(assessment, 'five_avg')}
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="border border-[#e5e7eb] px-3 py-2 text-center text-sm text-[#4b5563] font-medium">
                          {getCalculatedValue(assessment, 'five_sum')}
                        </td>
                        <td className="border border-[#e5e7eb] px-3 py-2 text-center text-sm text-[#4b5563] font-medium">
                          {getCalculatedValue(assessment, 'nine_sum')}
                        </td>
                      </>
                    )}
                    {permissions?.canEditScores && (
                      <td className="border border-[#e5e7eb] px-3 py-2 text-center">
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => handleDeleteRow(assessment.id)}
                        >
                          削除
                        </Button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`成績管理 - ${student.last_name} ${student.first_name}`} size="xl">
      {errorMessage && (
        <div className="mb-4 p-3 bg-[#ef4444]/10 border border-[#ef4444] rounded-lg text-sm text-[#ef4444]">
          {errorMessage}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <span className="text-[#4b5563]">読み込み中...</span>
        </div>
      ) : (
        <div>
          {renderSection('regular_test', assessments.regular_test)}
          {renderSection('report_card', assessments.report_card)}
          {renderSection('mock', assessments.mock)}
        </div>
      )}
      {ConfirmDialog}
    </Modal>
  );
}
