'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Search, X, SlidersHorizontal, ArrowUpDown, Save } from 'lucide-react';
import { InlineLoading } from '@/components/ui';
import { listAssessmentsBySchool } from '@/lib/api/assessments';
import { updateScore } from '@/lib/api/assessments';
import { transformToScoreList } from '@/lib/utils/scoreListTransform';
import type { ScoreListCategory, ScoreListStudent } from '@/lib/utils/scoreListTransform';
import { ASSESSMENT_NAME_OPTIONS, GRADE_LABELS } from '@/types/database';
import type { AssessmentWithScores, Student, Subject } from '@/types/database';
import type { NaishinType } from '@/lib/utils/convertedNaishin';
import { useAuth } from '@/contexts/AuthContext';
import { useMasterData } from '@/contexts/MasterDataContext';
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
  { value: 'default', label: '学年 → あいうえお' },
  { value: 'name_asc', label: 'あいうえお順' },
  { value: 'grade_desc', label: '学年（高 → 低）' },
  { value: 'fiveSum_desc', label: '最新5科合計（高 → 低）' },
  { value: 'fiveSum_asc', label: '最新5科合計（低 → 高）' },
];

const NAISHIN_SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'naishin_desc', label: '最新換算内申（高 → 低）' },
  { value: 'naishin_asc', label: '最新換算内申（低 → 高）' },
];

const HENSA_SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'hensa5_desc', label: '最新5科偏差値（高 → 低）' },
  { value: 'hensa5_asc', label: '最新5科偏差値（低 → 高）' },
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
        `${a.lastNameKana}${a.firstNameKana}`.localeCompare(
          `${b.lastNameKana}${b.firstNameKana}`,
          'ja'
        )
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

// ── Pending change key ──

function changeKey(assessmentId: string, subject: string) {
  return `${assessmentId}:${subject}`;
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
  const { schools } = useMasterData();
  const canEdit = !!permissions?.canEditScores;

  // 複数教室が選択されているときだけ教室名サブテキストを表示
  const schoolNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of schools) map.set(s.id, s.name);
    return map;
  }, [schools]);
  const showClassroomSubtitle = schoolIds.length > 1;

  // データ
  const [assessmentsByStudent, setAssessmentsByStudent] = useState<
    Map<string, AssessmentWithScores[]>
  >(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 内申切り替え
  const [naishinType, setNaishinType] = useState<NaishinType>('tokyo');

  // フィルター & ソート
  const [searchQuery, setSearchQuery] = useState('');
  const [nameCodeFilter, setNameCodeFilter] = useState<string>('all');
  const [gradeFilter, setGradeFilter] = useState<string>('all');
  const [sortKey, setSortKey] = useState<SortKey>('default');

  // インライン編集
  const [editingCell, setEditingCell] = useState<{ assessmentId: string; subject: string } | null>(
    null
  );
  const [cellValue, setCellValue] = useState('');

  // 未保存の変更を追跡
  const [pendingChanges, setPendingChanges] = useState<
    Map<string, { assessmentId: string; subject: string; value: number | null }>
  >(new Map());
  const [isSaving, setIsSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{ success: number; failed: number } | null>(null);
  const saveResultTimer = useRef<ReturnType<typeof setTimeout>>();

  const isDirty = pendingChanges.size > 0;

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
      setPendingChanges(new Map());
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
  }, [category, students.length, searchQuery, nameCodeFilter, gradeFilter, sortKey]);

  // カテゴリ変更時、無効なソート・フィルターをリセット
  useEffect(() => {
    if (category !== 'report_card' && (sortKey === 'naishin_desc' || sortKey === 'naishin_asc')) {
      setSortKey('default');
    }
    if (category !== 'mock' && (sortKey === 'hensa5_desc' || sortKey === 'hensa5_asc')) {
      setSortKey('default');
    }
    setNameCodeFilter('all');
    setGradeFilter('all');
  }, [category, sortKey]);

  // テスト名フィルター + テスト学年フィルター適用済み assessments
  const filteredAssessments = useMemo(() => {
    const hasNameFilter = nameCodeFilter !== 'all';
    const hasGradeFilter = gradeFilter !== 'all';
    if (!hasNameFilter && !hasGradeFilter) return assessmentsByStudent;

    const gradeNum = hasGradeFilter ? Number(gradeFilter) : null;
    const next = new Map<string, AssessmentWithScores[]>();
    const entries = Array.from(assessmentsByStudent.entries());
    for (const [sid, list] of entries) {
      const matched = list.filter((a) => {
        if (hasNameFilter && a.name_code !== nameCodeFilter) return false;
        if (gradeNum != null && a.grade !== gradeNum) return false;
        return true;
      });
      if (matched.length > 0) next.set(sid, matched);
    }
    return next;
  }, [assessmentsByStudent, nameCodeFilter, gradeFilter]);

  // テスト学年フィルターの選択肢（実データから収集）
  const availableGrades = useMemo(() => {
    const grades = new Set<number>();
    const entries = Array.from(assessmentsByStudent.entries());
    for (const [, list] of entries) {
      for (const a of list) {
        if (a.grade) grades.add(a.grade);
      }
    }
    return Array.from(grades).sort((a, b) => a - b);
  }, [assessmentsByStudent]);

  // データ変換
  const baseStudents = useMemo(
    () => transformToScoreList(students, filteredAssessments, category, naishinType),
    [students, filteredAssessments, category, naishinType]
  );

  // フィルター（名前・フリガナ）→ ソート
  const scoreListStudents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = q
      ? baseStudents.filter((s) => {
          const hay =
            `${s.lastName}${s.firstName}${s.lastNameKana}${s.firstNameKana}${s.schoolName ?? ''}`.toLowerCase();
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

  // テスト名フィルターの選択肢（カテゴリ依存）
  const nameCodeOptions = useMemo(() => ASSESSMENT_NAME_OPTIONS[category], [category]);

  // 元データ総数（絞り込み前）
  const totalBeforeFilter = useMemo(() => {
    const base = transformToScoreList(students, assessmentsByStudent, category, naishinType);
    return base.length;
  }, [students, assessmentsByStudent, category, naishinType]);

  const hasActiveFilter =
    searchQuery.trim() !== '' || nameCodeFilter !== 'all' || gradeFilter !== 'all';

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

  /** セルの編集確定 — ローカルのみ更新、API呼び出しはしない */
  const handleCellBlur = useCallback(
    (assessmentId: string, subject: string) => {
      setEditingCell(null);
      const trimmed = cellValue.trim();
      const newValue = trimmed === '' ? null : Number(trimmed);

      if (trimmed !== '' && isNaN(newValue as number)) return;

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

      // 未保存変更として記録
      setPendingChanges((prev) => {
        const next = new Map(prev);
        next.set(changeKey(assessmentId, subject), { assessmentId, subject, value: newValue });
        return next;
      });

      // 保存結果をクリア
      setSaveResult(null);
    },
    [cellValue]
  );

  const handleCancelEdit = useCallback(() => {
    setEditingCell(null);
  }, []);

  // ── 一括保存 ──

  const handleSave = useCallback(async () => {
    if (pendingChanges.size === 0) return;
    setIsSaving(true);
    setSaveResult(null);

    let success = 0;
    let failed = 0;

    const changes = Array.from(pendingChanges.values());
    for (const { assessmentId, subject, value } of changes) {
      try {
        await updateScore(assessmentId, subject, value);
        success++;
      } catch (e) {
        console.error('Save failed:', assessmentId, subject, e);
        failed++;
      }
    }

    if (failed === 0) {
      setPendingChanges(new Map());
    }

    setSaveResult({ success, failed });
    setIsSaving(false);

    // 結果表示を3秒後にクリア
    if (saveResultTimer.current) clearTimeout(saveResultTimer.current);
    saveResultTimer.current = setTimeout(() => setSaveResult(null), 3000);
  }, [pendingChanges]);

  // クリーンアップ
  useEffect(
    () => () => {
      if (saveResultTimer.current) clearTimeout(saveResultTimer.current);
    },
    []
  );

  // ── レンダリング ──

  if (isLoading) {
    return (
      <div className="py-12">
        <InlineLoading label="成績データを読み込み中..." />
      </div>
    );
  }

  if (error) {
    return <div className="py-8 text-center text-sm text-danger">{error}</div>;
  }

  return (
    <div>
      {/* ツールバー（1行・必要に応じて横スクロール） */}
      <div className="mb-3 flex items-center gap-3 overflow-x-auto pb-1">
        {/* 絞り込み */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-1 text-text-faint shrink-0" title="絞り込み">
            <SlidersHorizontal className="w-3.5 h-3.5" />
          </div>

          {/* 氏名・フリガナ */}
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none">
              <Search className="w-3.5 h-3.5 text-text-faint" />
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="氏名・フリガナ・学校名"
              aria-label="氏名・フリガナ・学校名で絞り込み"
              className="w-56 pl-7 pr-7 py-1.5 border border-border rounded-md text-xs bg-surface-raised text-text-heading focus:outline-none focus:ring-2 focus:ring-ink/30 focus:border-ink placeholder:text-text-faint"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute inset-y-0 right-0 pr-2 flex items-center text-text-faint hover:text-text-muted transition-colors duration-150"
                aria-label="検索をクリア"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* テスト名 */}
          <select
            value={nameCodeFilter}
            onChange={(e) => setNameCodeFilter(e.target.value)}
            aria-label="テスト名で絞り込み"
            className={`px-2.5 py-1.5 border rounded-md text-xs bg-surface-raised focus:outline-none focus:ring-2 focus:ring-ink/30 focus:border-ink ${
              nameCodeFilter === 'all'
                ? 'border-border text-text-heading'
                : 'border-ink text-ink font-medium'
            }`}
          >
            <option value="all">すべてのテスト</option>
            {nameCodeOptions.map((opt) => (
              <option key={opt.code} value={opt.code}>
                {opt.label}
              </option>
            ))}
          </select>

          {/* テスト学年 */}
          {availableGrades.length > 1 && (
            <select
              value={gradeFilter}
              onChange={(e) => setGradeFilter(e.target.value)}
              aria-label="テスト時の学年で絞り込み"
              className={`px-2.5 py-1.5 border rounded-md text-xs bg-surface-raised focus:outline-none focus:ring-2 focus:ring-ink/30 focus:border-ink ${
                gradeFilter === 'all'
                  ? 'border-border text-text-heading'
                  : 'border-ink text-ink font-medium'
              }`}
            >
              <option value="all">すべての学年</option>
              {availableGrades.map((g) => (
                <option key={g} value={g}>
                  {GRADE_LABELS[g] ?? `学年${g}`}
                </option>
              ))}
            </select>
          )}

          {hasActiveFilter && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setNameCodeFilter('all');
                setGradeFilter('all');
              }}
              className="text-[11px] text-text-muted hover:text-ink underline underline-offset-2 transition-colors duration-150 whitespace-nowrap"
            >
              クリア
            </button>
          )}
        </div>

        {/* 区切り */}
        <div className="h-5 w-px bg-border shrink-0" />

        {/* 並び替え */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-1 text-text-faint shrink-0" title="並び替え">
            <ArrowUpDown className="w-3.5 h-3.5" />
          </div>
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            aria-label="並び替え"
            className="px-2.5 py-1.5 border border-border rounded-md text-xs bg-surface-raised text-text-heading focus:outline-none focus:ring-2 focus:ring-ink/30 focus:border-ink"
          >
            {sortOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* 件数 & 表示設定（右端） */}
        <div className="ml-auto flex items-center gap-3 shrink-0 pl-2">
          <span className="text-xs text-text-muted">
            {hasActiveFilter ? (
              <>
                <span className="font-medium text-text-heading">{scoreListStudents.length}</span>
                <span className="text-text-faint"> / {totalBeforeFilter}</span>
                <span> 名</span>
              </>
            ) : (
              <>
                <span className="font-medium text-text-heading">{scoreListStudents.length}</span>
                <span> 名</span>
              </>
            )}
          </span>

          {/* 内申切り替え（内申タブのみ） */}
          {category === 'report_card' && (
            <div
              className="flex items-center gap-1 bg-surface-hover rounded-md p-0.5"
              role="radiogroup"
              aria-label="内申タイプ"
            >
              {(['tokyo', 'kanagawa'] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => setNaishinType(type)}
                  role="radio"
                  aria-checked={naishinType === type}
                  className={`px-2.5 py-0.5 text-xs rounded transition-[background-color,color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97] ${
                    naishinType === type
                      ? 'bg-surface-raised text-ink font-medium shadow-sm'
                      : 'text-text-muted hover:text-text-body'
                  }`}
                >
                  {type === 'tokyo' ? '都立' : '神奈川'}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 保存バー */}
      {canEdit && (isDirty || saveResult) && (
        <div
          className={`mb-3 flex items-center gap-3 px-4 py-2.5 rounded-lg border ${
            saveResult
              ? saveResult.failed > 0
                ? 'bg-warning-subtle border-warning/30'
                : 'bg-success-subtle border-success/30'
              : 'bg-info-subtle border-info/30'
          }`}
        >
          {saveResult ? (
            <span
              className={`text-xs font-medium ${saveResult.failed > 0 ? 'text-warning' : 'text-success'}`}
            >
              {saveResult.success}件保存しました
              {saveResult.failed > 0 && `（${saveResult.failed}件失敗）`}
            </span>
          ) : (
            <>
              <span className="text-xs font-medium text-info">
                {pendingChanges.size}件の未保存の変更があります
              </span>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-info text-white text-xs font-medium rounded-md hover:bg-info/90 disabled:opacity-50 transition-[background-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97]"
              >
                <Save className="w-3.5 h-3.5" />
                {isSaving ? '保存中...' : '保存'}
              </button>
            </>
          )}
        </div>
      )}

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
        classroomNameById={showClassroomSubtitle ? schoolNameById : undefined}
      />

      {/* ページネーション */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 px-2">
          <span className="text-sm text-text-muted">
            {scoreListStudents.length}名中 {(currentPage - 1) * ITEMS_PER_PAGE + 1}〜
            {Math.min(currentPage * ITEMS_PER_PAGE, scoreListStudents.length)}名を表示
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setCurrentPage(1)}
              disabled={currentPage === 1}
              className="px-2 py-1 text-sm rounded border border-border disabled:opacity-40 hover:bg-surface-hover transition-[background-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97]"
            >
              «
            </button>
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1 text-sm rounded border border-border disabled:opacity-40 hover:bg-surface-hover transition-[background-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97]"
            >
              ‹ 前
            </button>
            <span className="px-3 py-1 text-sm text-ink font-medium">
              {currentPage} / {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="px-3 py-1 text-sm rounded border border-border disabled:opacity-40 hover:bg-surface-hover transition-[background-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97]"
            >
              次 ›
            </button>
            <button
              onClick={() => setCurrentPage(totalPages)}
              disabled={currentPage === totalPages}
              className="px-2 py-1 text-sm rounded border border-border disabled:opacity-40 hover:bg-surface-hover transition-[background-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97]"
            >
              »
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
