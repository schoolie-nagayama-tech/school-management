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

const NAV_GRADES = [
  { key: 7, label: '中1' },
  { key: 8, label: '中2' },
  { key: 9, label: '中3' },
  { key: 10, label: '高1' },
  { key: 11, label: '高2' },
  { key: 12, label: '高3' },
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
  const [sortKey, setSortKey] = useState<SortKey>('grade');
  const [sortAsc, setSortAsc] = useState(true);

  // 選択状態
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isDeploying, setIsDeploying] = useState(false);

  // スクロール
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollRatio, setScrollRatio] = useState(0);
  const [showScrollNav, setShowScrollNav] = useState(false);
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());

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
      setShowScrollNav(scrollHeight > clientHeight);
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

  // 学年ナビゲーション: どの学年が存在するか
  const presentGrades = useMemo(() => {
    const grades = new Set<number>();
    filteredSorted.forEach((c) => c.target_grades.forEach((g) => grades.add(g)));
    return grades;
  }, [filteredSorted]);

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

  // 学年ジャンプ
  const scrollToGrade = (grade: number) => {
    const course = filteredSorted.find((c) => c.target_grades.includes(grade));
    if (course) {
      const el = itemRefs.current.get(course.id);
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
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

      {/* ヘッダー + 検索・フィルタ・ソート（1行にまとめ） */}
      <div className="mb-3 flex items-center gap-3 flex-wrap">
        <h1 className="text-lg font-bold text-text-heading shrink-0">講習一覧</h1>

        {!isLoading && courses.length > 0 && (
          <>
            {/* 検索 */}
            <div className="relative flex-1 min-w-[160px] max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-faint" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="検索..."
                className="w-full pl-8 pr-7 py-1.5 text-xs border border-border rounded-lg bg-surface focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary transition-colors"
              />
              {query && (
                <button
                  onClick={() => setQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-text-faint hover:text-text-muted"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* 季節 */}
            <div className="flex items-center gap-0.5">
              {(Object.entries(SEASON_LABELS) as [SeasonType, string][]).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setFilterSeason(filterSeason === value ? '' : value)}
                  className={`px-2 py-1 text-[11px] rounded transition-colors ${
                    filterSeason === value
                      ? SEASON_COLORS[value] + ' font-bold'
                      : 'text-text-muted hover:bg-surface-hover'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* 学年 */}
            <div className="flex items-center gap-0.5">
              {GRADE_GROUPS.map((g) => (
                <button
                  key={g.label}
                  onClick={() => setFilterGradeGroup(filterGradeGroup === g.label ? '' : g.label)}
                  className={`px-2 py-1 text-[11px] rounded transition-colors ${
                    filterGradeGroup === g.label
                      ? 'bg-primary/10 text-primary font-bold'
                      : 'text-text-muted hover:bg-surface-hover'
                  }`}
                >
                  {g.label}
                </button>
              ))}
            </div>

            {/* ソート */}
            <div className="flex items-center gap-0.5">
              <ArrowUpDown className="w-3 h-3 text-text-faint" />
              {SORT_OPTIONS.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => handleSort(key)}
                  className={`px-1.5 py-1 text-[11px] rounded transition-colors ${
                    sortKey === key
                      ? 'text-text-heading font-bold'
                      : 'text-text-faint hover:text-text-muted'
                  }`}
                >
                  {label}{sortKey === key && (sortAsc ? '↑' : '↓')}
                </button>
              ))}
            </div>

            {hasActiveFilter && (
              <button
                onClick={clearFilters}
                className="text-[11px] text-text-faint hover:text-text-muted flex items-center gap-0.5"
              >
                <X className="w-3 h-3" />
              </button>
            )}

            {/* 件数 */}
            <span className="text-[11px] text-text-faint tabular-nums">
              {filteredSorted.length === courses.length
                ? `${courses.length}件`
                : `${filteredSorted.length}/${courses.length}`}
            </span>
          </>
        )}

        <div className="flex-1" />

        {/* アクション */}
        <div className="flex items-center gap-2 shrink-0">
          <Link
            href="/courses/proposals"
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium text-text-body border border-border rounded-lg hover:bg-surface-hover transition-colors"
          >
            <FileText className="w-3 h-3" />
            提案書
          </Link>
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium bg-ink text-text-on-primary rounded-lg hover:brightness-[0.85] transition-[filter] duration-150"
          >
            <Plus className="w-3 h-3" />
            新規作成
          </button>
        </div>
      </div>

      {/* 一括操作バー */}
      {!isLoading && courses.length > 0 && canDeploy && (
        <div
          className={`mb-2 flex items-center gap-3 px-3 py-1.5 rounded-lg border transition-all duration-200 ${
            hasSelection
              ? 'bg-info/5 border-info/20 shadow-sm'
              : 'bg-surface-raised border-border-subtle'
          }`}
        >
          <button
            onClick={toggleSelectAll}
            className="text-xs text-text-muted hover:text-text-heading transition-colors flex items-center gap-1.5"
          >
            {selected.size === filteredSorted.length && filteredSorted.length > 0
              ? <CheckSquare className="w-3.5 h-3.5 text-info" />
              : <Square className="w-3.5 h-3.5" />
            }
            {hasSelection ? `${selected.size}件選択` : '一括選択'}
          </button>
          {hasSelection ? (
            <>
              <button
                onClick={() => setSelected(new Set())}
                className="text-[11px] text-text-faint hover:text-text-muted"
              >
                解除
              </button>
              <div className="flex-1" />
              <button
                onClick={handleDeploy}
                disabled={isDeploying}
                className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-bold bg-info text-white rounded-lg hover:bg-info/90 active:scale-[0.97] transition-[colors,transform] duration-150 disabled:opacity-50"
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
          ) : (
            <>
              <div className="flex-1" />
              <span className="text-[11px] text-text-faint">
                チェックして全教室に展開
              </span>
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
        <div className="flex gap-3">
          {/* メインリスト */}
          <div
            ref={listRef}
            className="flex-1 overflow-y-auto rounded-xl border border-border-default bg-surface-raised"
            style={{ maxHeight: 'calc(100vh - 130px)', scrollbarWidth: 'none' }}
          >
            <div className="divide-y divide-border-subtle">
              {filteredSorted.map((course) => {
                const isChecked = selected.has(course.id);
                return (
                  <div
                    key={course.id}
                    ref={(el) => { if (el) itemRefs.current.set(course.id, el); }}
                    className={`group flex items-start gap-3 transition-colors duration-100 ${
                      isChecked
                        ? 'bg-info/5'
                        : 'hover:bg-surface-hover/50'
                    }`}
                  >
                    {/* チェックボックス */}
                    {canDeploy && (
                      <button
                        onClick={() => toggleSelect(course.id)}
                        className="pl-4 pt-4 text-text-faint hover:text-text-heading transition-colors shrink-0"
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
                      className={`flex-1 flex items-start gap-3 py-3.5 ${canDeploy ? 'pr-4' : 'px-4'} min-w-0`}
                    >
                      {/* 左: 季節バッジ */}
                      <span className={`shrink-0 mt-0.5 px-2 py-0.5 text-[11px] font-bold rounded ${SEASON_COLORS[course.season]}`}>
                        {SEASON_LABELS[course.season]}
                      </span>

                      {/* 中央: 名前 + 説明 */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm text-text-heading truncate">
                            {course.name}
                          </span>
                          <span className="shrink-0 text-xs text-text-faint tabular-nums">
                            {course.total_koma > 0 && `${course.total_koma}コマ`}
                          </span>
                        </div>
                        {/* 学年 + コメント */}
                        <div className="mt-0.5 flex items-center gap-2 text-xs text-text-muted">
                          <span>
                            {course.target_grades.length > 0
                              ? course.target_grades.map((g) => GRADE_LABELS[g]).join(' ')
                              : '学年未設定'}
                          </span>
                          <span className="text-text-faint">|</span>
                          <span className="tabular-nums">適用 {course.application_count || 0}件</span>
                        </div>
                        {course.comment && (
                          <p className="mt-1 text-xs text-text-muted/70 line-clamp-1">
                            {course.comment}
                          </p>
                        )}
                      </div>

                      <ChevronRight className="w-4 h-4 text-text-faint shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </Link>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 縦スクロールナビ（学年メモリ付き） */}
          {showScrollNav && (
            <div className="shrink-0 w-12 flex flex-col items-center py-2 select-none" style={{ maxHeight: 'calc(100vh - 130px)' }}>
              {/* スクロール位置トラック */}
              <div className="relative flex-1 w-1 bg-border/40 rounded-full">
                {/* 現在位置インジケータ */}
                <div
                  className="absolute left-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-primary shadow-sm transition-[top] duration-100"
                  style={{ top: `calc(${scrollRatio * 100}% - 6px)` }}
                />
              </div>

              {/* 学年ジャンプボタン */}
              <div className="mt-3 flex flex-col gap-0.5 items-center">
                {NAV_GRADES.map(({ key, label }) => {
                  const exists = presentGrades.has(key);
                  return (
                    <button
                      key={key}
                      onClick={() => scrollToGrade(key)}
                      disabled={!exists}
                      className={`w-full px-1 py-0.5 text-[10px] leading-tight rounded transition-colors ${
                        exists
                          ? 'text-text-muted hover:bg-primary/10 hover:text-primary font-medium'
                          : 'text-text-faint/30 cursor-default'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
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
