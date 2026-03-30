'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { listAssessmentsBySchool } from '@/lib/api/assessments';
import { updateScore } from '@/lib/api/assessments';
import { transformToScoreList } from '@/lib/utils/scoreListTransform';
import type { ScoreListCategory } from '@/lib/utils/scoreListTransform';
import type { AssessmentWithScores, Student, Subject } from '@/types/database';
import type { NaishinType } from '@/lib/utils/convertedNaishin';
import { useAuth } from '@/contexts/AuthContext';
import { ScoreListTable } from './ScoreListTable';

// ── Props ──

interface ScoreListViewProps {
  category: ScoreListCategory;
  students: (Student & { subjects?: Subject[] })[];
  schoolIds: string[];
}

// ── コンポーネント ──

export function ScoreListView({ category, students, schoolIds }: ScoreListViewProps) {
  const { permissions } = useAuth();
  const canEdit = !!permissions?.canEditScores;

  // データ
  const [assessmentsByStudent, setAssessmentsByStudent] = useState<Map<string, AssessmentWithScores[]>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 内申切り替え
  const [naishinType, setNaishinType] = useState<NaishinType>('tokyo');

  // インライン編集
  const [editingCell, setEditingCell] = useState<{ assessmentId: string; subject: string } | null>(null);
  const [cellValue, setCellValue] = useState('');

  // ページネーション
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 50;

  // データ取得
  const fetchData = useCallback(async () => {
    if (schoolIds.length === 0) {
      setAssessmentsByStudent(new Map());
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const data = await listAssessmentsBySchool(schoolIds, category);
      setAssessmentsByStudent(data);
    } catch (e) {
      console.error('Error fetching score list:', e);
      setError('成績データの取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [schoolIds, category]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ページリセット
  useEffect(() => {
    setCurrentPage(1);
  }, [category, students.length]);

  // データ変換
  const scoreListStudents = useMemo(
    () => transformToScoreList(students, assessmentsByStudent, category, naishinType),
    [students, assessmentsByStudent, category, naishinType]
  );

  // ページネーション
  const totalPages = Math.max(1, Math.ceil(scoreListStudents.length / ITEMS_PER_PAGE));
  const paginatedStudents = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return scoreListStudents.slice(start, start + ITEMS_PER_PAGE);
  }, [scoreListStudents, currentPage]);

  // ── インライン編集ハンドラ ──

  const handleCellClick = useCallback(
    (assessmentId: string, subject: string, value: number | null) => {
      if (!canEdit) return;
      setEditingCell({ assessmentId, subject });
      setCellValue(value != null ? String(value) : '');
    },
    [canEdit]
  );

  const handleCellChange = useCallback((value: string) => {
    setCellValue(value);
  }, []);

  const handleCellBlur = useCallback(
    async (assessmentId: string, subject: string) => {
      setEditingCell(null);
      const trimmed = cellValue.trim();
      const newValue = trimmed === '' ? null : Number(trimmed);

      if (trimmed !== '' && isNaN(newValue as number)) return;

      try {
        await updateScore(assessmentId, subject, newValue);
        // ローカルで即座に更新
        setAssessmentsByStudent((prev) => {
          const next = new Map(prev);
          const entries = Array.from(next.entries());
          for (const [sid, assessments] of entries) {
            const idx = assessments.findIndex((a: AssessmentWithScores) => a.id === assessmentId);
            if (idx !== -1) {
              const assessment = { ...assessments[idx] };
              const scoreIdx = assessment.scores.findIndex((s) => s.subject === subject);
              if (scoreIdx !== -1) {
                assessment.scores = [...assessment.scores];
                assessment.scores[scoreIdx] = { ...assessment.scores[scoreIdx], value: newValue };
              } else if (newValue != null) {
                assessment.scores = [
                  ...assessment.scores,
                  { id: '', assessment_id: assessmentId, subject, value: newValue, created_at: '' },
                ];
              }
              const newAssessments = [...assessments];
              newAssessments[idx] = assessment;
              next.set(sid, newAssessments);
              break;
            }
          }
          return next;
        });
      } catch (e) {
        console.error('Error updating score:', e);
      }
    },
    [cellValue]
  );

  const handleCancelEdit = useCallback(() => {
    setEditingCell(null);
  }, []);

  // ── レンダリング ──

  if (isLoading) {
    return (
      <div className="py-12 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-[#1e3a5f] border-t-transparent rounded-full animate-spin" />
        <span className="ml-2 text-sm text-gray-500">成績データを読み込み中...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-8 text-center text-sm text-red-500">{error}</div>
    );
  }

  return (
    <div>
      {/* ツールバー */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-gray-500">
          {scoreListStudents.length}名の成績データ
        </span>
        <div className="flex items-center gap-3">
          {/* 内申切り替え（内申タブのみ） */}
          {category === 'report_card' && (
            <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
              {(['tokyo', 'kanagawa'] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => setNaishinType(type)}
                  className={`px-3 py-1 text-xs rounded-md transition-colors ${
                    naishinType === type
                      ? 'bg-white text-[#1e3a5f] font-medium shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {type === 'tokyo' ? '都立' : '神奈川'}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* テーブル */}
      <ScoreListTable
        students={paginatedStudents}
        category={category}
        canEdit={canEdit}
        editingCell={editingCell}
        cellValue={cellValue}
        onCellClick={handleCellClick}
        onCellChange={handleCellChange}
        onCellBlur={handleCellBlur}
        onCancelEdit={handleCancelEdit}
        naishinType={category === 'report_card' ? naishinType : undefined}
      />

      {/* ページネーション */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 px-2">
          <span className="text-sm text-gray-500">
            {scoreListStudents.length}名中{' '}
            {(currentPage - 1) * ITEMS_PER_PAGE + 1}〜
            {Math.min(currentPage * ITEMS_PER_PAGE, scoreListStudents.length)}名を表示
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setCurrentPage(1)}
              disabled={currentPage === 1}
              className="px-2 py-1 text-sm rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-50"
            >
              «
            </button>
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1 text-sm rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-50"
            >
              ‹ 前
            </button>
            <span className="px-3 py-1 text-sm text-[#1e3a5f] font-medium">
              {currentPage} / {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="px-3 py-1 text-sm rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-50"
            >
              次 ›
            </button>
            <button
              onClick={() => setCurrentPage(totalPages)}
              disabled={currentPage === totalPages}
              className="px-2 py-1 text-sm rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-50"
            >
              »
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
