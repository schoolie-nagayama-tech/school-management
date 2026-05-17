'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Link from 'next/link';
import { AlertCircle, ArrowUpDown, CheckSquare, ChevronRight, Copy, FileText, Plus, Search, Square, X } from 'lucide-react';
import { AdminLayout } from '@/components/layouts';
import { Button, Loading, InlineLoading } from '@/components/ui';
import { getSeasonalCourses, createSeasonalCourse, deployCourseToSchools } from '@/lib/api/seasonalCourses';
import { useAuth } from '@/contexts/AuthContext';
import { useRequirePermission } from '@/hooks/usePermissions';
import AccessDenied from '@/components/AccessDenied';
import type { SeasonalCourseWithDetails, SeasonType } from '@/types/database';
import { SEASON_LABELS, GRADE_LABELS } from '@/types/database';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';
import { useLocalSchoolId } from '@/hooks/useLocalSchoolId';
import { SchoolSwitcher } from '@/components/SchoolSwitcher';

type SortKey = 'season' | 'name' | 'application' | 'grade';

const SEASON_ORDER: Record<SeasonType, number> = { spring: 0, summer: 1, winter: 2 };
const SEASON_COLORS: Record<SeasonType, string> = {
  spring: 'bg-pink-100 text-pink-700',
  summer: 'bg-sky-100 text-sky-700',
  winter: 'bg-slate-100 text-slate-600',
};

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'season', label: '季節' },
  { key: 'name', label: '名前' },
  { key: 'grade', label: '学年' },
  { key: 'application', label: '適用数' },
];

const GRADE_GROUPS = [
  { label: '小学', grades: [1, 2, 3, 4, 5, 6] },
  { label: '中学', grades: [7, 8, 9] },
  { label: '高校', grades: [10, 11, 12] },
  { label: '既卒', grades: [13] },
];

export default function CoursesPage() {
  const { hasPermission, isLoading: permissionLoading } = useRequirePermission(
    (p) => p.canAccessCourses
  );
  const { getSelectedSchoolIds, schoolIds } = useAuth();
  const { localSchoolId, setLocalSchoolId, isAllSelected, availableSchools } = useLocalSchoolId();

  const [courses, setCourses] = useState<SeasonalCourseWithDetails[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 検索・フィルタ
  const [query, setQuery] = useState('');
  const [filterSeason, setFilterSeason] = useState<SeasonType | ''>('');
  const [filterGradeGroup, setFilterGradeGroup] = useState('');

  // ソート
  const [sortKey, setSortKey] = useState<SortKey>('season');
  const [sortAsc, setSortAsc] = useState(true);

  // 選択状態
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isDeploying, setIsDeploying] = useState(false);

  // スクロールバー
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollRatio, setScrollRatio] = useState(0);
  const [thumbRatio, setThumbRatio] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartY = useRef(0);
  const dragStartScroll = useRef(0);
  const trackRef = useRef<HTMLDivElement>(null);

  // 新規作成フォーム
  const [newCourseName, setNewCourseName] = useState('');
  const [newCourseSeason, setNewCourseSeason] = useState<SeasonType>('spring');
  const [newCourseGrades, setNewCourseGrades] = useState<number[]>([]);
  const [newCourseTotalKoma, setNewCourseTotalKoma] = useState<number | ''>('');
  const [newCourseComment, setNewCourseComment] = useState('');
  const [applyToAllSchools, setApplyToAllSchools] = useState(false);

  const fetchCourses = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage('');
    try {
      if (!localSchoolId) {
        setCourses([]);
        return;
      }
      const data = await getSeasonalCourses(localSchoolId);
      setCourses(data);
    } catch (error) {
      console.error('Error fetching courses:', error);
      setErrorMessage(getUserErrorMessage(error, '講習一覧の取得に失敗しました'));
    } finally {
      setIsLoading(false);
    }
  }, [localSchoolId]);

  useEffect(() => {
    if (localSchoolId) {
      fetchCourses();
    }
  }, [fetchCourses, localSchoolId]);

  useEffect(() => {
    setSelected(new Set());
  }, [localSchoolId]);

  // スクロール監視
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const update = () => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      const maxScroll = scrollHeight - clientHeight;
      setScrollRatio(maxScroll > 0 ? scrollTop / maxScroll : 0);
      setThumbRatio(scrollHeight > 0 ? clientHeight / scrollHeight : 1);
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, [courses, query, filterSeason, filterGradeGroup, sortKey, sortAsc]);

  // ドラッグでスクロール
  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: MouseEvent) => {
      const track = trackRef.current;
      const el = listRef.current;
      if (!track || !el) return;
      const trackH = track.clientHeight;
      const dy = e.clientY - dragStartY.current;
      const maxScroll = el.scrollHeight - el.clientHeight;
      const scrollDelta = (dy / (trackH * (1 - thumbRatio))) * maxScroll;
      el.scrollTop = Math.max(0, Math.min(maxScroll, dragStartScroll.current + scrollDelta));
    };
    const onUp = () => setIsDragging(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isDragging, thumbRatio]);

  const handleThumbDown = (e: React.MouseEvent) => {
    e.preventDefault();
    dragStartY.current = e.clientY;
    dragStartScroll.current = listRef.current?.scrollTop ?? 0;
    setIsDragging(true);
  };

  const handleTrackClick = (e: React.MouseEvent) => {
    const track = trackRef.current;
    const el = listRef.current;
    if (!track || !el || e.target !== track) return;
    const rect = track.getBoundingClientRect();
    const clickRatio = (e.clientY - rect.top) / rect.height;
    const maxScroll = el.scrollHeight - el.clientHeight;
    el.scrollTop = clickRatio * maxScroll;
  };

  // フィルタ・検索・ソート
  const filteredSorted = useMemo(() => {
    let list = courses;

    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.comment?.toLowerCase().includes(q) ||
          SEASON_LABELS[c.season].includes(q) ||
          c.target_grades.some((g) => GRADE_LABELS[g]?.includes(q))
      );
    }

    if (filterSeason) {
      list = list.filter((c) => c.season === filterSeason);
    }

    if (filterGradeGroup) {
      const group = GRADE_GROUPS.find((g) => g.label === filterGradeGroup);
      if (group) {
        list = list.filter((c) =>
          c.target_grades.some((g) => group.grades.includes(g))
        );
      }
    }

    return [...list].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'season':
          cmp = SEASON_ORDER[a.season] - SEASON_ORDER[b.season];
          break;
        case 'name':
          cmp = a.name.localeCompare(b.name, 'ja');
          break;
        case 'application':
          cmp = (a.application_count || 0) - (b.application_count || 0);
          break;
        case 'grade':
          cmp = (a.target_grades[0] ?? 99) - (b.target_grades[0] ?? 99);
          break;
      }
      return sortAsc ? cmp : -cmp;
    });
  }, [courses, query, filterSeason, filterGradeGroup, sortKey, sortAsc]);

  const hasActiveFilter = query || filterSeason || filterGradeGroup;

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === filteredSorted.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filteredSorted.map((c) => c.id)));
    }
  };

  const handleDeploy = async () => {
    if (selected.size === 0) return;
    const count = selected.size;
    const targetCount = schoolIds.length - 1;
    if (targetCount <= 0) {
      setErrorMessage('展開先の教室がありません');
      return;
    }
    if (!window.confirm(
      `選択した${count}件の講習を他の${targetCount}教室に展開します。\n\n同名・同季節の講習が既にある教室はスキップされます。よろしいですか？`
    )) return;

    setIsDeploying(true);
    setErrorMessage('');
    try {
      let totalCreated = 0;
      let totalSkipped = 0;
      for (const courseId of Array.from(selected)) {
        const { created, skipped } = await deployCourseToSchools(courseId, schoolIds);
        totalCreated += created;
        totalSkipped += skipped;
      }
      setSelected(new Set());
      alert(`${totalCreated}件を作成しました。${totalSkipped}件はスキップされました。`);
      await fetchCourses();
    } catch (error) {
      console.error('Error deploying courses:', error);
      setErrorMessage(getUserErrorMessage(error, '展開に失敗しました'));
    } finally {
      setIsDeploying(false);
    }
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  const clearFilters = () => {
    setQuery('');
    setFilterSeason('');
    setFilterGradeGroup('');
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCourseName.trim()) {
      setErrorMessage('コース名を入力してください');
      return;
    }
    setIsSubmitting(true);
    setErrorMessage('');
    try {
      const targetSchoolIds = applyToAllSchools ? schoolIds : getSelectedSchoolIds();
      if (targetSchoolIds.length === 0) {
        setErrorMessage('教室が選択されていません');
        return;
      }
      const courseData = {
        name: newCourseName.trim(),
        season: newCourseSeason,
        target_grades: newCourseGrades,
        total_koma: newCourseTotalKoma === '' ? undefined : Number(newCourseTotalKoma),
        comment: newCourseComment.trim() || undefined,
      };
      await Promise.all(
        targetSchoolIds.map((schoolId) => createSeasonalCourse(schoolId, courseData))
      );
      setIsCreateModalOpen(false);
      setNewCourseName('');
      setNewCourseSeason('spring');
      setNewCourseGrades([]);
      setNewCourseTotalKoma('');
      setNewCourseComment('');
      setApplyToAllSchools(false);
      await fetchCourses();
    } catch (error) {
      console.error('Error creating course:', error);
      setErrorMessage(getUserErrorMessage(error, '講習の作成に失敗しました'));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (permissionLoading) {
    return (
      <AdminLayout>
        <Loading className="min-h-[60vh]" />
      </AdminLayout>
    );
  }

  if (!hasPermission) {
    return (
      <AdminLayout>
        <AccessDenied />
      </AdminLayout>
    );
  }

  const hasSelection = selected.size > 0;
  const canDeploy = schoolIds.length > 1;
  const showScrollbar = thumbRatio < 1;

  return (
    <AdminLayout headerTitle="講習管理">
      {isAllSelected && (
        <SchoolSwitcher
          schools={availableSchools}
          selectedSchoolId={localSchoolId}
          onChange={setLocalSchoolId}
        />
      )}

      {errorMessage && (
        <div className="mb-4 p-3 bg-danger/10 border border-danger rounded-lg">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-danger shrink-0" />
            <p className="text-sm text-danger">{errorMessage}</p>
          </div>
        </div>
      )}

      {/* ヘッダー */}
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-text-heading">講習一覧</h1>
        <div className="flex items-center gap-2">
          <Link
            href="/courses/proposals"
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-text-body bg-surface-raised border border-border rounded-lg hover:bg-surface-hover transition-colors"
          >
            <FileText className="w-4 h-4" />
            提案書
          </Link>
          <Button onClick={() => setIsCreateModalOpen(true)}>
            <Plus className="w-4 h-4 mr-1" />
            新規作成
          </Button>
        </div>
      </div>

      {/* 検索 + フィルタ + ソート */}
      {!isLoading && courses.length > 0 && (
        <div className="mb-3 space-y-2">
          {/* 検索バー */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-faint" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="講習名・学年・季節で検索..."
              className="w-full pl-9 pr-8 py-2 text-sm border border-border rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-text-faint hover:text-text-muted"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* フィルタ + ソート行 */}
          <div className="flex items-center gap-3 flex-wrap">
            {/* 季節フィルタ */}
            <div className="flex items-center gap-1">
              {(Object.entries(SEASON_LABELS) as [SeasonType, string][]).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setFilterSeason(filterSeason === value ? '' : value)}
                  className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                    filterSeason === value
                      ? SEASON_COLORS[value] + ' font-bold'
                      : 'text-text-muted hover:bg-surface-hover'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="w-px h-4 bg-border" />

            {/* 学年グループフィルタ */}
            <div className="flex items-center gap-1">
              {GRADE_GROUPS.map((g) => (
                <button
                  key={g.label}
                  onClick={() => setFilterGradeGroup(filterGradeGroup === g.label ? '' : g.label)}
                  className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                    filterGradeGroup === g.label
                      ? 'bg-primary/10 text-primary font-bold'
                      : 'text-text-muted hover:bg-surface-hover'
                  }`}
                >
                  {g.label}
                </button>
              ))}
            </div>

            <div className="w-px h-4 bg-border" />

            {/* ソート */}
            <div className="flex items-center gap-1">
              <ArrowUpDown className="w-3 h-3 text-text-faint" />
              {SORT_OPTIONS.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => handleSort(key)}
                  className={`px-2 py-1 text-xs rounded-md transition-colors ${
                    sortKey === key
                      ? 'bg-text-heading/8 text-text-heading font-bold'
                      : 'text-text-faint hover:bg-surface-hover hover:text-text-muted'
                  }`}
                >
                  {label}
                  {sortKey === key && (
                    <span className="ml-0.5 text-[10px]">{sortAsc ? '↑' : '↓'}</span>
                  )}
                </button>
              ))}
            </div>

            {hasActiveFilter && (
              <>
                <div className="flex-1" />
                <button
                  onClick={clearFilters}
                  className="text-xs text-text-faint hover:text-text-muted flex items-center gap-0.5"
                >
                  <X className="w-3 h-3" />
                  フィルタ解除
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* 件数表示 + 一括操作 */}
      {!isLoading && courses.length > 0 && (
        <div className={`mb-2 flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-colors duration-150 ${
          hasSelection ? 'bg-info/5 border-info/30' : 'bg-transparent border-transparent'
        }`}>
          <span className="text-xs text-text-faint">
            {filteredSorted.length === courses.length
              ? `${courses.length}件`
              : `${filteredSorted.length} / ${courses.length}件`}
          </span>
          {canDeploy && (
            <>
              <div className="w-px h-3 bg-border" />
              <button
                onClick={toggleSelectAll}
                className="text-xs text-text-muted hover:text-text-heading transition-colors flex items-center gap-1"
              >
                {selected.size === filteredSorted.length && filteredSorted.length > 0
                  ? <CheckSquare className="w-3 h-3 text-info" />
                  : <Square className="w-3 h-3" />
                }
                {hasSelection ? `${selected.size}件選択` : '一括選択'}
              </button>
              {hasSelection && (
                <>
                  <button
                    onClick={() => setSelected(new Set())}
                    className="text-xs text-text-faint hover:text-text-muted"
                  >
                    解除
                  </button>
                  <div className="flex-1" />
                  <button
                    onClick={handleDeploy}
                    disabled={isDeploying}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold bg-info text-white rounded-md hover:bg-info/90 active:scale-[0.97] transition-[colors,transform] duration-150 disabled:opacity-50"
                  >
                    {isDeploying ? (
                      <InlineLoading size="sm" label="展開中..." />
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        全教室に展開
                      </>
                    )}
                  </button>
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* リスト */}
      {isLoading ? (
        <Loading className="min-h-[40vh]" />
      ) : courses.length === 0 ? (
        <div className="bg-surface-raised rounded-xl border border-border p-8 text-center">
          <p className="text-text-body mb-4">講習が登録されていません。</p>
          <Button onClick={() => setIsCreateModalOpen(true)}>
            最初の講習を作成
          </Button>
        </div>
      ) : filteredSorted.length === 0 ? (
        <div className="bg-surface-raised rounded-xl border border-border p-8 text-center">
          <p className="text-sm text-text-muted mb-3">該当する講習が見つかりません</p>
          <button
            onClick={clearFilters}
            className="text-sm text-primary hover:underline"
          >
            フィルタを解除
          </button>
        </div>
      ) : (
        <div className="relative flex">
          {/* スクロールエリア */}
          <div
            ref={listRef}
            className="flex-1 overflow-y-auto pr-1"
            style={{ maxHeight: 'calc(100vh - 320px)', scrollbarWidth: 'none' }}
          >
            <div className="space-y-px">
              {filteredSorted.map((course) => {
                const isChecked = selected.has(course.id);
                return (
                  <div
                    key={course.id}
                    className={`group flex items-center gap-3 rounded-lg border transition-all duration-100 ${
                      isChecked
                        ? 'bg-info/5 border-info/20'
                        : 'bg-surface-raised border-transparent hover:border-border hover:bg-surface-hover/50'
                    }`}
                  >
                    {/* チェックボックス */}
                    {canDeploy && (
                      <button
                        onClick={() => toggleSelect(course.id)}
                        className="pl-3 py-3 text-text-faint hover:text-text-heading transition-colors shrink-0"
                      >
                        {isChecked
                          ? <CheckSquare className="w-4 h-4 text-info" />
                          : <Square className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" />
                        }
                      </button>
                    )}

                    {/* コンテンツ */}
                    <Link
                      href={`/courses/${course.id}`}
                      className={`flex-1 flex items-center gap-3 py-3 ${canDeploy ? 'pr-3' : 'px-3'} min-w-0`}
                    >
                      {/* 季節バッジ */}
                      <span className={`shrink-0 px-2 py-0.5 text-[11px] font-bold rounded ${SEASON_COLORS[course.season]}`}>
                        {SEASON_LABELS[course.season]}
                      </span>

                      {/* 名前 */}
                      <span className="font-medium text-sm text-text-heading truncate min-w-0 flex-1">
                        {course.name}
                      </span>

                      {/* メタ情報 */}
                      <div className="hidden sm:flex items-center gap-3 shrink-0 text-xs text-text-muted">
                        <span>
                          {course.target_grades.length > 0
                            ? course.target_grades.map((g) => GRADE_LABELS[g]).join(' ')
                            : '学年未設定'}
                        </span>
                        {course.total_koma > 0 && (
                          <span>{course.total_koma}コマ</span>
                        )}
                        <span className="tabular-nums">
                          適用 {course.application_count || 0}
                        </span>
                      </div>

                      <ChevronRight className="w-4 h-4 text-text-faint shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </Link>
                  </div>
                );
              })}
            </div>
          </div>

          {/* カスタムスクロールバー */}
          {showScrollbar && (
            <div
              ref={trackRef}
              onClick={handleTrackClick}
              className="ml-1.5 w-5 shrink-0 relative rounded-full bg-surface-hover/50 cursor-pointer select-none"
              style={{ maxHeight: 'calc(100vh - 320px)' }}
            >
              {/* サム */}
              <div
                onMouseDown={handleThumbDown}
                className={`absolute left-0 w-full rounded-full transition-colors ${
                  isDragging ? 'bg-primary/40' : 'bg-primary/20 hover:bg-primary/30'
                }`}
                style={{
                  height: `${Math.max(thumbRatio * 100, 10)}%`,
                  top: `${scrollRatio * (100 - Math.max(thumbRatio * 100, 10))}%`,
                }}
              >
                {/* 位置インジケータ */}
                <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-[9px] font-bold text-primary/60 leading-none">
                    {Math.round(scrollRatio * 100)}%
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 新規作成モーダル */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-surface-raised rounded-xl border border-border p-6 max-w-md w-full max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold text-text-heading mb-4">新規講習を作成</h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-heading mb-1">
                  コース名 <span className="text-danger">*</span>
                </label>
                <input
                  type="text"
                  value={newCourseName}
                  onChange={(e) => setNewCourseName(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="例: 春期講習 中1数学"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-heading mb-1">
                  季節 <span className="text-danger">*</span>
                </label>
                <select
                  value={newCourseSeason}
                  onChange={(e) => setNewCourseSeason(e.target.value as SeasonType)}
                  className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  {Object.entries(SEASON_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-text-heading mb-1">
                  対象学年
                </label>
                <div className="space-y-2 max-h-48 overflow-y-auto border border-border rounded-lg p-2">
                  {Object.entries(GRADE_LABELS).map(([gradeStr, label]) => {
                    const grade = Number(gradeStr);
                    return (
                      <label key={grade} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={newCourseGrades.includes(grade)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setNewCourseGrades([...newCourseGrades, grade]);
                            } else {
                              setNewCourseGrades(newCourseGrades.filter((g) => g !== grade));
                            }
                          }}
                          className="rounded border-border"
                        />
                        <span className="text-sm text-text-heading">{label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-text-heading mb-1">
                  合計コマ数
                </label>
                <input
                  type="number"
                  value={newCourseTotalKoma}
                  onChange={(e) =>
                    setNewCourseTotalKoma(e.target.value === '' ? '' : Number(e.target.value))
                  }
                  min="1"
                  className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="例: 10"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-heading mb-1">
                  コメント
                </label>
                <textarea
                  value={newCourseComment}
                  onChange={(e) => setNewCourseComment(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="講習に関するメモ"
                />
              </div>
              {schoolIds.length > 1 && (
                <div>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={applyToAllSchools}
                      onChange={(e) => setApplyToAllSchools(e.target.checked)}
                      className="rounded border-border"
                    />
                    <span className="text-sm font-medium text-text-heading">
                      すべての教室に適用（{schoolIds.length}教室）
                    </span>
                  </label>
                  <p className="text-xs text-text-body mt-1 ml-6">
                    チェックを入れると、担当しているすべての教室に同じ講習が作成されます
                  </p>
                </div>
              )}
              <div className="flex gap-3 pt-4">
                <Button
                  type="button"
                  onClick={() => {
                    setIsCreateModalOpen(false);
                    setNewCourseName('');
                    setNewCourseSeason('spring');
                    setNewCourseGrades([]);
                    setNewCourseTotalKoma('');
                    setNewCourseComment('');
                    setApplyToAllSchools(false);
                  }}
                  variant="secondary"
                  className="flex-1"
                >
                  キャンセル
                </Button>
                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1"
                >
                  {isSubmitting ? '作成中...' : '作成'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
