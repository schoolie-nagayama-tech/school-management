'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AdminLayout } from '@/components/layouts';
import { Button, ToastContainer } from '@/components/ui';
import { ScoreChart, type ChartDataPoint } from '@/components/scores/ScoreChart';
import { ScoreTable } from '@/components/scores/ScoreTable';
import {
  listAssessments,
  createAssessmentRow,
  updateScore,
  deleteAssessmentRow,
} from '@/lib/api/assessments';
import { getStudent } from '@/lib/api/students';
import type { Student, AssessmentWithScores } from '@/types/database';
import {
  ASSESSMENT_NAME_LABELS,
  ASSESSMENT_NAME_OPTIONS,
  GRADE_LABELS,
} from '@/types/database';
import { useToast } from '@/hooks/useToast';
import { useRequirePermission } from '@/hooks/usePermissions';
import { useAuth } from '@/contexts/AuthContext';
import AccessDenied from '@/components/AccessDenied';
import { exportProgressToPDF } from '@/lib/utils/pdfExport';

type Category = 'regular_test' | 'report_card' | 'mock';

const CATEGORY_LABELS: Record<Category, string> = {
  regular_test: '定期テスト',
  report_card: '内申',
  mock: '模試',
};

function convertToChartData(assessments: AssessmentWithScores[]): ChartDataPoint[] {
  const sorted = [...assessments].sort((a, b) => {
    if (a.grade !== b.grade) return a.grade - b.grade;
    const aMonth = a.exam_month || '';
    const bMonth = b.exam_month || '';
    if (aMonth !== bMonth) return aMonth.localeCompare(bMonth);
    return (a.name_code || '').localeCompare(b.name_code || '');
  });

  return sorted.map((assessment) => {
    const scores: Record<string, number | null> = {};
    assessment.scores.forEach((score) => {
      if (['english', 'math', 'japanese', 'science', 'social'].includes(score.subject)) {
        scores[score.subject] = score.value;
      }
    });
    const gradeLabel = GRADE_LABELS[assessment.grade] ?? `学年${assessment.grade}`;
    const nameLabel = ASSESSMENT_NAME_LABELS[assessment.name_code] || assessment.name_code;
    return {
      label: `${gradeLabel} ${nameLabel}`,
      english: scores.english ?? null,
      math: scores.math ?? null,
      japanese: scores.japanese ?? null,
      science: scores.science ?? null,
      social: scores.social ?? null,
    };
  });
}

export default function StudentScoresPage() {
  const params = useParams();
  const studentId = params.studentId as string;
  const { hasPermission, isLoading: permissionLoading } = useRequirePermission((p) => p.canAccessStudents);
  const { permissions, getSelectedSchoolIds } = useAuth();
  const canEditScores = !!permissions?.canEditScores;
  const { toasts, removeToast, success, error: toastError } = useToast();

  const [student, setStudent] = useState<Student | null>(null);
  const [assessmentsByCategory, setAssessmentsByCategory] = useState<Record<Category, AssessmentWithScores[]>>({
    regular_test: [],
    report_card: [],
    mock: [],
  });
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [showGraph, setShowGraph] = useState(true);
  const [showMockGraph, setShowMockGraph] = useState(true);
  const [editingCell, setEditingCell] = useState<{ assessmentId: string; subject: string } | null>(null);
  const [cellValue, setCellValue] = useState('');
  const [addingRowCategory, setAddingRowCategory] = useState<Category | null>(null);
  const [newRowNameCode, setNewRowNameCode] = useState('');
  const [newRowGrade, setNewRowGrade] = useState(8);
  const [newRowMonth, setNewRowMonth] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);

  const fetchStudent = useCallback(async () => {
    if (!studentId) return;
    try {
      const schoolIds = getSelectedSchoolIds();
      const s = await getStudent(studentId, schoolIds.length > 0 ? schoolIds : undefined);
      setStudent(s);
      if (s?.grade) setNewRowGrade(s.grade);
    } catch (e) {
      console.error(e);
      setErrorMessage('生徒の取得に失敗しました');
    }
  }, [studentId, getSelectedSchoolIds]);

  const fetchAllAssessments = useCallback(async () => {
    if (!studentId) return;
    setIsLoading(true);
    setErrorMessage('');
    try {
      const [regular, report, mock] = await Promise.all([
        listAssessments(studentId, 'regular_test'),
        listAssessments(studentId, 'report_card'),
        listAssessments(studentId, 'mock'),
      ]);
      setAssessmentsByCategory({
        regular_test: regular,
        report_card: report,
        mock,
      });
    } catch (e) {
      console.error(e);
      setErrorMessage('成績データの取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [studentId]);

  useEffect(() => {
    fetchStudent();
  }, [fetchStudent]);

  useEffect(() => {
    fetchAllAssessments();
  }, [fetchAllAssessments]);

  const chartDataRegular = useMemo(
    () => convertToChartData(assessmentsByCategory.regular_test),
    [assessmentsByCategory.regular_test]
  );
  const chartDataMock = useMemo(
    () => convertToChartData(assessmentsByCategory.mock),
    [assessmentsByCategory.mock]
  );

  const handleCellClick = (assessmentId: string, subject: string, value: number | null) => {
    setEditingCell({ assessmentId, subject });
    setCellValue(value !== null ? String(value) : '');
  };

  const handleCellBlur = async (assessmentId: string, subject: string) => {
    if (!editingCell) return;
    const numValue = cellValue.trim() === '' ? null : parseFloat(cellValue);
    if (cellValue.trim() !== '' && (numValue === null || isNaN(numValue))) {
      setEditingCell(null);
      return;
    }
    try {
      await updateScore(assessmentId, subject, numValue);
      await fetchAllAssessments();
      success('スコアを更新しました');
    } catch (e) {
      console.error(e);
      toastError('スコアの更新に失敗しました');
    }
    setEditingCell(null);
  };

  const handleAddRow = async () => {
    if (!addingRowCategory || !newRowNameCode || !studentId) {
      toastError('テスト名を選択してください');
      return;
    }
    setIsSubmitting(true);
    try {
      await createAssessmentRow(studentId, addingRowCategory, newRowNameCode, newRowGrade, newRowMonth || null);
      setNewRowNameCode('');
      setNewRowMonth('');
      setAddingRowCategory(null);
      if (student?.grade) setNewRowGrade(student.grade);
      await fetchAllAssessments();
      success('行を追加しました');
    } catch (e) {
      console.error(e);
      toastError('行の追加に失敗しました');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteRow = async (assessmentId: string) => {
    if (!confirm('この行を削除してもよろしいですか？')) return;
    try {
      await deleteAssessmentRow(assessmentId);
      await fetchAllAssessments();
      success('行を削除しました');
    } catch (e) {
      console.error(e);
      toastError('行の削除に失敗しました');
    }
  };

  const handleExportPdf = async () => {
    const el = document.getElementById('scores-pdf-content');
    if (!el || !student) return;
    setIsExportingPdf(true);
    try {
      const filename = `成績表_${student.last_name}${student.first_name}.pdf`;
      await exportProgressToPDF('scores-pdf-content', filename, {
        fitToPage: true,
        orientation: 'landscape',
      });
      success('PDFをダウンロードしました');
    } catch (e) {
      console.error(e);
      toastError('PDFの出力に失敗しました');
    } finally {
      setIsExportingPdf(false);
    }
  };

  if (permissionLoading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <p className="text-[var(--paragraph)]">読み込み中...</p>
        </div>
      </AdminLayout>
    );
  }

  if (!hasPermission) {
    return (
      <AdminLayout>
        <AccessDenied message="成績の閲覧・編集権限がありません" />
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      <div className="space-y-6 bg-white">
        {/* 操作バー（PDFには含めない） */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Link
            href="/students"
            className="text-sm text-[var(--paragraph)] hover:text-[var(--primary)]"
          >
            ← 生徒一覧に戻る
          </Link>
          <Button
            variant="primary"
            size="sm"
            onClick={handleExportPdf}
            disabled={isExportingPdf || !student}
          >
            {isExportingPdf ? 'PDF出力中...' : 'PDF出力'}
          </Button>
        </div>

        <div id="scores-pdf-content" className="space-y-6">
          {/* 成績表ヘッダー（PDFに含む） */}
          <h1 className="text-2xl font-bold text-[var(--headline)]">
            成績表
            {student && (
              <span className="text-base font-normal text-[var(--paragraph)] ml-2">
                {student.last_name} {student.first_name}
                {student.grade != null && `（${GRADE_LABELS[student.grade] ?? student.grade}）`}
              </span>
            )}
          </h1>

          {errorMessage && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
              {errorMessage}
            </div>
          )}

          {/* グラフ（定期テスト・プレゼン用） */}
          {showGraph && chartDataRegular.length > 0 && (
            <section className="bg-[var(--surface)] rounded-xl border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-[var(--headline)]">定期テスト 成績推移</h2>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowGraph(!showGraph)}
                >
                  グラフを非表示
                </Button>
              </div>
              <ScoreChart data={chartDataRegular} category="regular_test" />
            </section>
          )}
          {!showGraph && (
            <div className="flex justify-end">
              <Button variant="secondary" size="sm" onClick={() => setShowGraph(true)}>
                グラフを表示
              </Button>
            </div>
          )}

          {/* 模試 偏差値の推移グラフ */}
          {showMockGraph && chartDataMock.length > 0 && (
            <section className="bg-[var(--surface)] rounded-xl border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-[var(--headline)]">模試 偏差値の推移</h2>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowMockGraph(false)}
                >
                  グラフを非表示
                </Button>
              </div>
              <ScoreChart data={chartDataMock} category="mock" />
            </section>
          )}
          {!showMockGraph && chartDataMock.length > 0 && (
            <div className="flex justify-end">
              <Button variant="secondary" size="sm" onClick={() => setShowMockGraph(true)}>
                模試グラフを表示
              </Button>
            </div>
          )}

          {/* 3カテゴリを1ページに表示（プレゼン向け・縦並びで見やすく） */}
          <div className="space-y-8">
            {(Object.keys(CATEGORY_LABELS) as Category[]).map((category) => (
              <section
                key={category}
                className="flex flex-col rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm print:break-inside-avoid"
              >
                <div className="bg-[var(--surface)] border-b border-gray-200 px-4 py-3">
                  <h2 className="text-lg font-semibold text-[var(--headline)]">
                    {CATEGORY_LABELS[category]}
                  </h2>
                </div>
                <div className="p-4 flex-1 min-w-0">
                  {isLoading ? (
                    <div className="py-8 text-center text-sm text-[var(--paragraph)]">読み込み中...</div>
                  ) : (
                    <>
                      <div className="mb-3 flex justify-end">
                        {!addingRowCategory && canEditScores && (
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => {
                              setAddingRowCategory(category);
                              setNewRowNameCode('');
                              setNewRowMonth('');
                              if (student?.grade) setNewRowGrade(student.grade);
                            }}
                          >
                            ＋ 行を追加
                          </Button>
                        )}
                      </div>

                      {addingRowCategory === category && (
                        <div className="mb-4 p-3 bg-[var(--surface)] rounded-lg border border-gray-200">
                          <div className="flex flex-wrap items-end gap-3">
                            <div className="min-w-[120px]">
                              <label className="block text-xs font-medium text-[var(--headline)] mb-1">テスト名</label>
                              <select
                                value={newRowNameCode}
                                onChange={(e) => setNewRowNameCode(e.target.value)}
                                className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm bg-white"
                              >
                                <option value="">選択</option>
                                {ASSESSMENT_NAME_OPTIONS[category].map((opt) => (
                                  <option key={opt.code} value={opt.code}>{opt.label}</option>
                                ))}
                              </select>
                            </div>
                            <div className="min-w-[80px]">
                              <label className="block text-xs font-medium text-[var(--headline)] mb-1">学年</label>
                              <select
                                value={newRowGrade}
                                onChange={(e) => setNewRowGrade(parseInt(e.target.value, 10))}
                                className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm bg-white"
                              >
                                {[7, 8, 9, 10, 11, 12].map((g) => (
                                  <option key={g} value={g}>{GRADE_LABELS[g]}</option>
                                ))}
                              </select>
                            </div>
                            {category !== 'report_card' && (
                              <div className="min-w-[140px]">
                                <label className="block text-xs font-medium text-[var(--headline)] mb-1">年月</label>
                                <input
                                  type="month"
                                  value={newRowMonth}
                                  onChange={(e) => setNewRowMonth(e.target.value)}
                                  className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm bg-white"
                                />
                              </div>
                            )}
                            <div className="flex gap-2 shrink-0">
                              <Button
                                variant="primary"
                                size="sm"
                                onClick={handleAddRow}
                                disabled={!newRowNameCode || isSubmitting}
                              >
                                追加
                              </Button>
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => {
                                  setAddingRowCategory(null);
                                  setNewRowNameCode('');
                                  setNewRowMonth('');
                                }}
                              >
                                キャンセル
                              </Button>
                            </div>
                          </div>
                        </div>
                      )}

                      <ScoreTable
                        category={category}
                        assessments={assessmentsByCategory[category]}
                        editingCell={editingCell}
                        cellValue={cellValue}
                        onCellClick={handleCellClick}
                        onCellBlur={handleCellBlur}
                        onCellChange={setCellValue}
                        onCancelEdit={() => setEditingCell(null)}
                        onDelete={handleDeleteRow}
                        canEdit={canEditScores}
                      />
                    </>
                  )}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
