'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Search, X } from 'lucide-react';
import { listAssessmentsBySchool } from '@/lib/api/assessments';
import { updateScore } from '@/lib/api/assessments';
import { transformToScoreList } from '@/lib/utils/scoreListTransform';
import type { ScoreListCategory, ScoreListStudent } from '@/lib/utils/scoreListTransform';
import type { AssessmentWithScores, Student, Subject } from '@/types/database';
import type { NaishinType } from '@/lib/utils/convertedNaishin';
import { useAuth } from '@/contexts/AuthContext';
import { ScoreListTable } from './ScoreListTable';

// ── ソート定義 ──

type SortKey =
  | 'default'
  | 'name_asc'
  | 'grade_desc'
  | 'fiveSum_desc'
  | 'fiveSum_asc'
  | 'naishin_desc'
  | 'naishin_asc'
  | 'hensa5_desc'
  | 'hensa5_asc';

const BASE_SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'default', label: '既定（学年→あいうえお）' },
  { value: 'name_asc', label: '名前（あいうえお順）' },
  { value: 'grade_desc', label: '学年（高学年→低学年）' },
  { value: 'fiveSum_desc', label: '最新5科合計（高い順）' },
  { value: 'fiveSum_asc', label: '最新5科合計（低い順）' },
];

const NAISHIN_SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'naishin_desc', label: '最新換算内申（高い順）' },
  { value: 'naishin_asc', label: '最新換算内申（低い順）' },
];

const HENSA_SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'hensa5_desc', label: '最新5科偏差値（高い順）' },
  { value: 'hensa5_asc', label: '最新5科偏差値（低い順）' },
];

function lastRow(s: ScoreListStudent) {
  return s.rows.length > 0 ? s.rows[s.rows.length - 1] : null;
}

function compareNumDesc(a: number | null, b: number | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return b - a;
}

function compareNumAsc(a: number | null, b: number | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a - b;
}

function sortStudents(students: ScoreListStudent[], key: SortKey): ScoreListStudent[] {
  if (key === 'default') return students;
  const arr = [...students];
  switch (key) {
    case 'name_asc':
      arr.sort((a, b) =>
        `${a.lastNameKana}${a.firstNameKana}`.localeCompare(`${b.lastNameKana}${b.firstNameKana}`, 'ja')
      );
      break;
    case 'grade_desc':
      arr.sort((a, b) => b.grade - a.grade);
      break;
    case 'fiveSum_desc':
      arr.sort((a, b) => compareNumDesc(lastRow(a)?.fiveSum ?? null, lastRow(b)?.fiveSum ?? null));
      break;
    case 'fiveSum_asc':
      arr.sort((a, b) => compareNumAsc(lastRow(a)?.fiveSum ?? null, lastRow(b)?.fiveSum ?? null));
      break;
    case 'naishin_desc':
      arr.sort((a, b) =>
        compareNumDesc(lastRow(a)?.convertedNaishin ?? null, lastRow(b)?.convertedNaishin ?? null)
      );
      break;
    case 'naishin_asc':
      arr.sort((a, b) =>
        compareNumAsc(lastRow(a)?.convertedNaishin ?? null, lastRow(b)?.convertedNaishin ?? null)
      );
      break;
    case 'hensa5_desc':
      arr.sort((a, b) => compareNumDesc(lastRow(a)?.hensa5 ?? null, lastRow(b)?.hensa5 ?? null));
      break;
    case 'hensa5_asc':
      arr.sort((a, b) => compareNumAsc(lastRow(a)?.hensa5 ?? null, lastRow(b)?.hensa5 ?? null));
      break;
  }
  return arr;
}

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

  // フィルター & ソート
  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('default');

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
  }, [category, students.length, searchQuery, sortKey]);

  // カテゴリ変更時、無効なソートをリセット
  useEffect(() => {
    if (category !== 'report_card' && (sortKey === 'naishin_desc' || sortKey === 'naishin_asc')) {
      setSortKey('default');
    }
    if (category !== 'mock' && (sortKey === 'hensa5_desc' || sortKey === 'hensa5_asc')) {
      setSortKey('default');
    }
  }, [category, sortKey]);

  // データ変換
  const baseStudents = useMemo(
    () => transformToScoreList(students, assessmentsByStudent, category, naishinType),
    [students, assessmentsByStudent, category, naishinType]
  );

  // フィルター（名前・フリガナ・コード）→ ソート
  const scoreListStudents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = q
      ? baseStudents.filter((s) => {
          const hay = `${s.lastName}${s.firstName}${s.lastNameKana}${s.firstNameKana}`.toLowerCase();
          return hay.includes(q);
        })
      : baseStudents;
    return sortStudents(filtered, sortKey);
  }, [baseStudents, searchQuery, sortKey]);

  // ページネーション
  const totalPages = Math.max(1, Math.ceil(scoreListStudents.length / ITEMS_PER_PAGE));
  const paginatedStudents = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return scoreListStudents.slice(start, start + ITEMS_PER_PAGE);
  }, [scoreListStudents, currentPage]);

  // ソートオプション（カテゴリに応じて）
  const sortOptions = useMemo(() => {
    const opts = [...BASE_SORT_OPTIONS];
    if (category === 'report_card') opts.push(...NAISHIN_SORT_OPTIONS);
    if (category === 'mock') opts.push(...HENSA_SORT_OPTIONS);
    return opts;
  }, [category]);

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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* 名前・フリガナ検索 */}
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none">
              <Search className="w-4 h-4 text-gray-400" />
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="氏名・フリガナで検索..."
              className="w-56 pl-8 pr-8 py-1.5 border border-gray-300 rounded-lg text-xs bg-white text-[#1a1a1a] focus:ring-2 focus:ring-[#1e3a5f]/30 focus:border-[#1e3a5f] placeholder:text-gray-400"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute inset-y-0 right-0 pr-2 flex items-center text-gray-400 hover:text-gray-600"
                aria-label="検索をクリア"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* ソート */}
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-xs bg-white text-[#1a1a1a] focus:ring-2 focus:ring-[#1e3a5f]/30 focus:border-[#1e3a5f]"
          >
            {sortOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          <span className="text-xs text-gray-500">{scoreListStudents.length}名</span>
        </div>

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
