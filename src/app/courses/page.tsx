'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  AlertCircle,
  Archive,
  ArrowUpDown,
  CheckSquare,
  ChevronRight,
  Copy,
  FileText,
  FilterX,
  Plus,
  RotateCcw,
  Search,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { ContextHelp } from '@/components/help/ContextHelp';
import { AdminLayout } from '@/components/layouts';
import { Loading, InlineLoading, ToastContainer } from '@/components/ui';
import { useConfirm } from '@/hooks/useConfirm';
import { useToast } from '@/hooks/useToast';
import {
  getCachedSeasonalCourses,
  deployCourseToSchools,
  deleteSeasonalCourse,
  restoreSeasonalCourse,
  archiveSeasonalCourses,
} from '@/lib/api/seasonalCourses';
import { useAuth } from '@/contexts/AuthContext';
import { useRequirePermission } from '@/hooks/usePermissions';
import AccessDenied from '@/components/AccessDenied';
import type { SeasonalCourseListItem, SeasonType } from '@/types/database';
import { SEASON_LABELS, GRADE_LABELS } from '@/types/database';
import { SEASON_COLORS, SEASON_ORDER } from '@/components/course-shared/seasonBadge';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';
import { useLocalSchoolId } from '@/hooks/useLocalSchoolId';
import { SchoolSwitcher } from '@/components/SchoolSwitcher';

type SortKey = 'season' | 'name' | 'application' | 'grade';

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'season', label: '季節' },
  { key: 'name', label: '名前' },
  { key: 'grade', label: '学年' },
  { key: 'application', label: '適用数' },
];

const SUBJECT_BADGE_COLORS: Record<string, { bg: string; text: string }> = {
  英語: { bg: 'bg-blue-50', text: 'text-blue-700' },
  数学: { bg: 'bg-red-50', text: 'text-red-700' },
  算数: { bg: 'bg-red-50', text: 'text-red-700' },
  国語: { bg: 'bg-green-50', text: 'text-green-700' },
  理科: { bg: 'bg-amber-50', text: 'text-amber-700' },
  社会: { bg: 'bg-purple-50', text: 'text-purple-700' },
};
const DEFAULT_BADGE_COLOR = { bg: 'bg-gray-100', text: 'text-gray-600' };

export default function CoursesPage() {
  const { hasPermission, isLoading: permissionLoading } = useRequirePermission(
    (p) => p.canAccessCourses
  );
  const { schoolIds } = useAuth();
  const { localSchoolId, setLocalSchoolId, isAllSelected, availableSchools } = useLocalSchoolId();
  const searchParams = useSearchParams();
  const router = useRouter();

  // 確認とトーストは詳細ページ（/courses/[courseId]）と同じ作法に揃える。
  // エラーは画面上部のバナーに出し続ける（展開ガードのように「直してから戻ってくる」案内は消えると困るため）。
  const { confirm, ConfirmDialog } = useConfirm();
  const { toasts, removeToast, success } = useToast();

  const [courses, setCourses] = useState<SeasonalCourseListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  // 有効 / アーカイブの切替（URLパラメータから初期化）。
  // このシステムの「削除」は is_active=false の論理削除なので、消したものは必ずここから戻せる。
  const [showArchived, setShowArchived] = useState(() => searchParams.get('archived') === '1');

  // 検索・フィルタ（URLパラメータから初期化）
  const [query, setQuery] = useState(() => searchParams.get('q') || '');
  const [filterSeason, setFilterSeason] = useState<SeasonType | ''>(
    () => (searchParams.get('season') as SeasonType) || ''
  );
  const [filterGrade, setFilterGrade] = useState<number | ''>(() => {
    const g = searchParams.get('grade');
    return g ? Number(g) : '';
  });
  const [filterSubject, setFilterSubject] = useState(() => searchParams.get('subject') || '');
  // 単元が未設定＝中身が空のテンプレだけを抜き出す。整理（一括アーカイブ）の入口。
  const [filterEmpty, setFilterEmpty] = useState(() => searchParams.get('empty') === '1');

  // ソート（URLパラメータから初期化）
  const [sortKey, setSortKey] = useState<SortKey>(
    () => (searchParams.get('sort') as SortKey) || 'grade'
  );
  const [sortAsc, setSortAsc] = useState(() => searchParams.get('asc') !== '0');

  // 選択状態
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isDeploying, setIsDeploying] = useState(false);
  const [isBulkRunning, setIsBulkRunning] = useState(false);

  const [rowActionId, setRowActionId] = useState<string | null>(null);

  const fetchCourses = useCallback(
    async (skipCache = false) => {
      setIsLoading(true);
      setErrorMessage('');
      try {
        if (!localSchoolId) {
          setCourses([]);
          return;
        }
        if (skipCache) getCachedSeasonalCourses.invalidate();
        // 有効／アーカイブは同じ関数の is_active 違い。キャッシュキーは引数を含むので混ざらない。
        const data = await getCachedSeasonalCourses(localSchoolId, !showArchived);
        setCourses(data);
      } catch (error) {
        console.error('Error fetching courses:', error);
        setErrorMessage(getUserErrorMessage(error, '講習一覧の取得に失敗しました'));
      } finally {
        setIsLoading(false);
      }
    },
    [localSchoolId, showArchived]
  );

  useEffect(() => {
    if (localSchoolId) {
      fetchCourses();
    }
  }, [fetchCourses, localSchoolId]);

  // 教室や表示モードを切り替えたら選択は持ち越さない（見えていない行を操作しないため）
  useEffect(() => {
    setSelected(new Set());
  }, [localSchoolId, showArchived]);

  // フィルタ・ソート状態をURLパラメータに同期
  const isInitialMount = useRef(true);
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (filterSeason) params.set('season', filterSeason);
    if (filterGrade) params.set('grade', String(filterGrade));
    if (filterSubject) params.set('subject', filterSubject);
    if (filterEmpty) params.set('empty', '1');
    if (showArchived) params.set('archived', '1');
    if (sortKey !== 'grade') params.set('sort', sortKey);
    if (!sortAsc) params.set('asc', '0');
    const qs = params.toString();
    router.replace(qs ? `/courses?${qs}` : '/courses', { scroll: false });
  }, [
    query,
    filterSeason,
    filterGrade,
    filterSubject,
    filterEmpty,
    showArchived,
    sortKey,
    sortAsc,
    router,
  ]);

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

    if (filterGrade) {
      list = list.filter((c) => c.target_grades.includes(filterGrade));
    }

    if (filterSubject) {
      list = list.filter((c) => c.textbooks?.some((t) => t.textbook?.subject === filterSubject));
    }

    if (filterEmpty) {
      list = list.filter((c) => c.curriculum_count === 0);
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
  }, [courses, query, filterSeason, filterGrade, filterSubject, filterEmpty, sortKey, sortAsc]);

  // フィルタ用: データに存在する学年と科目を抽出
  const availableGrades = useMemo(() => {
    const grades = new Set<number>();
    courses.forEach((c) => c.target_grades.forEach((g) => grades.add(g)));
    return Array.from(grades).sort((a, b) => a - b);
  }, [courses]);

  const availableSubjects = useMemo(() => {
    const subjects = new Set<string>();
    courses.forEach((c) => {
      c.textbooks?.forEach((t) => {
        if (t.textbook?.subject) subjects.add(t.textbook.subject);
      });
    });
    return Array.from(subjects).sort();
  }, [courses]);

  const hasActiveFilter = query || filterSeason || filterGrade || filterSubject || filterEmpty;

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

    // 中身が空のまま展開させない。
    // 展開は教材も単元もコピーするので、単元を入れる前に展開すると各教室に空の複製が増えるだけになる。
    // 2026-09の冬期でこれが起き、他教室に空のコースが268件でき本番データの整理が必要になった。
    const emptyCourses = filteredSorted.filter(
      (c) => selected.has(c.id) && c.curriculum_count === 0
    );
    if (emptyCourses.length > 0) {
      const names = emptyCourses
        .slice(0, 3)
        .map((c) => `「${c.name}」`)
        .join('、');
      const more = emptyCourses.length > 3 ? ` ほか${emptyCourses.length - 3}件` : '';
      setErrorMessage(
        `単元が未設定の講習は展開できません（${names}${more}）。先に単元とコマ数を設定してから展開してください。`
      );
      return;
    }

    if (
      !(await confirm({
        title: '全教室に展開',
        description: `選択した${count}件の講習を他の${targetCount}教室に展開します。同名・同季節の講習が既にある教室はスキップされます。`,
        confirmLabel: '展開する',
      }))
    )
      return;

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
      success(`${totalCreated}件を作成しました。${totalSkipped}件はスキップされました。`);
      await fetchCourses(true);
    } catch (error) {
      console.error('Error deploying courses:', error);
      setErrorMessage(getUserErrorMessage(error, '展開に失敗しました'));
    } finally {
      setIsDeploying(false);
    }
  };

  // 選択した講習を一括でアーカイブする。空テンプレの整理が主な用途。
  const handleBulkArchive = async () => {
    if (selected.size === 0) return;
    const count = selected.size;
    if (
      !(await confirm({
        title: '講習をアーカイブ',
        description: `選択した${count}件をアーカイブしますか？ アーカイブ表示から元に戻せます。`,
        confirmLabel: 'アーカイブ',
        variant: 'danger',
      }))
    )
      return;

    setIsBulkRunning(true);
    setErrorMessage('');
    try {
      await archiveSeasonalCourses(Array.from(selected));
      getCachedSeasonalCourses.invalidate();
      setSelected(new Set());
      success(`${count}件をアーカイブしました`);
      await fetchCourses(true);
    } catch (error) {
      console.error('Error archiving courses:', error);
      setErrorMessage(getUserErrorMessage(error, 'アーカイブに失敗しました'));
    } finally {
      setIsBulkRunning(false);
    }
  };

  // アーカイブ表示での一括操作。まとめて有効に戻す。
  const handleBulkRestore = async () => {
    if (selected.size === 0) return;
    const count = selected.size;
    if (
      !(await confirm({
        title: '講習を元に戻す',
        description: `選択した${count}件を有効な講習に戻しますか？`,
        confirmLabel: '戻す',
      }))
    )
      return;

    setIsBulkRunning(true);
    setErrorMessage('');
    try {
      // 一括restore用のAPIは持たない（戻す操作は件数が少なく、失敗時にどれが戻ったか
      // 分かるほうが運用しやすい）。順に実行する。
      for (const courseId of Array.from(selected)) {
        await restoreSeasonalCourse(courseId);
      }
      getCachedSeasonalCourses.invalidate();
      setSelected(new Set());
      success(`${count}件を元に戻しました`);
      await fetchCourses(true);
    } catch (error) {
      console.error('Error restoring courses:', error);
      setErrorMessage(getUserErrorMessage(error, '元に戻す操作に失敗しました'));
    } finally {
      setIsBulkRunning(false);
    }
  };

  // 行の「アーカイブ」。DB上は is_active=false の論理削除なので、文言も「削除」ではなく
  // 「アーカイブ」で統一する（完全削除の手段はこの画面には用意しない）。
  const handleArchive = async (courseId: string, courseName: string) => {
    if (
      !(await confirm({
        title: '講習をアーカイブ',
        description: `「${courseName}」をアーカイブしますか？ アーカイブ表示から元に戻せます。`,
        confirmLabel: 'アーカイブ',
        variant: 'danger',
      }))
    )
      return;
    setRowActionId(courseId);
    try {
      await deleteSeasonalCourse(courseId);
      getCachedSeasonalCourses.invalidate();
      setCourses((prev) => prev.filter((c) => c.id !== courseId));
      success(`「${courseName}」をアーカイブしました`);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(courseId);
        return next;
      });
    } catch (error) {
      setErrorMessage(getUserErrorMessage(error, 'アーカイブに失敗しました'));
    } finally {
      setRowActionId(null);
    }
  };

  // 行の「戻す」。アーカイブ表示でのみ出す。
  const handleRestore = async (courseId: string, courseName: string) => {
    setRowActionId(courseId);
    try {
      await restoreSeasonalCourse(courseId);
      getCachedSeasonalCourses.invalidate();
      setCourses((prev) => prev.filter((c) => c.id !== courseId));
      success(`「${courseName}」を元に戻しました`);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(courseId);
        return next;
      });
    } catch (error) {
      setErrorMessage(getUserErrorMessage(error, '元に戻す操作に失敗しました'));
    } finally {
      setRowActionId(null);
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
    setFilterGrade('');
    setFilterSubject('');
    setFilterEmpty(false);
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
      <ToastContainer toasts={toasts} onRemove={removeToast} />
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
        <ContextHelp
          searchQuery="講習"
          topics={[
            {
              title: '講習を新規作成する',
              description: '季節講習のコースを登録します。編集画面で最後まで作ってから保存します。',
              steps: [
                '右上の「新規作成」ボタンをクリック',
                'テキストを選ぶ（お気に入りは星印で上に固定できます）',
                '講習名・季節・対象学年を入力し、単元をクリックしてコマ数を入れる',
                '下部の「保存」をクリック（ここで初めて講習が登録されます）',
              ],
            },
            {
              title: '講習を全教室に展開する',
              description: '作成した講習を各教室に一括配信します。',
              steps: [
                '展開したい講習にチェックを入れる',
                '一括操作バーの「全教室に展開」をクリック',
                '対象教室を確認して展開を実行',
              ],
            },
            {
              title: '講習をアーカイブする・元に戻す',
              description: '使わない講習を一覧から外します。完全には消えず、いつでも戻せます。',
              steps: [
                '行の右端のアイコン、または一括操作バーの「アーカイブ」を実行',
                '戻したいときは一覧上部の「アーカイブ」表示に切り替える',
                '対象の行の「戻す」をクリック',
              ],
            },
          ]}
        />

        {/* 有効 / アーカイブの切替。既定は有効。 */}
        <div className="flex items-center gap-0.5 rounded-lg border border-border-subtle p-0.5">
          {[
            { value: false, label: '有効' },
            { value: true, label: 'アーカイブ' },
          ].map(({ value, label }) => (
            <button
              key={label}
              onClick={() => setShowArchived(value)}
              className={`px-2 py-1 text-[11px] rounded transition-colors ${
                showArchived === value
                  ? 'bg-surface-hover text-text-heading font-bold'
                  : 'text-text-muted hover:bg-surface-hover'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

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
            {availableGrades.length > 0 && (
              <div className="flex items-center gap-0.5">
                {availableGrades.map((g) => (
                  <button
                    key={g}
                    onClick={() => setFilterGrade(filterGrade === g ? '' : g)}
                    className={`px-2 py-1 text-[11px] rounded transition-colors ${
                      filterGrade === g
                        ? 'bg-primary/10 text-primary font-bold'
                        : 'text-text-muted hover:bg-surface-hover'
                    }`}
                  >
                    {GRADE_LABELS[g] || `${g}`}
                  </button>
                ))}
              </div>
            )}

            {/* 科目 */}
            {availableSubjects.length > 0 && (
              <div className="flex items-center gap-0.5">
                {availableSubjects.map((s) => (
                  <button
                    key={s}
                    onClick={() => setFilterSubject(filterSubject === s ? '' : s)}
                    className={`px-2 py-1 text-[11px] rounded transition-colors ${
                      filterSubject === s
                        ? 'bg-emerald-100 text-emerald-700 font-bold'
                        : 'text-text-muted hover:bg-surface-hover'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            {/* 未設定のみ（単元が空のテンプレを洗い出す） */}
            <button
              onClick={() => setFilterEmpty(!filterEmpty)}
              className={`px-2 py-1 text-[11px] rounded transition-colors ${
                filterEmpty
                  ? 'bg-amber-100 text-amber-700 font-bold'
                  : 'text-text-muted hover:bg-surface-hover'
              }`}
              title="単元とコマ数が未設定の講習だけを表示します"
            >
              未設定のみ
            </button>

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
                  {label}
                  {sortKey === key && (sortAsc ? '↑' : '↓')}
                </button>
              ))}
            </div>

            {hasActiveFilter && (
              <button
                onClick={clearFilters}
                className="text-[11px] text-text-muted hover:text-text-heading flex items-center gap-1"
              >
                <FilterX className="w-3 h-3" />
                絞り込み解除
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
          {/* 新規作成はモーダルではなくエディタ（/courses/new）へ直行する。
              作ってから中身を入れる2段構えが、単元ゼロの空テンプレを量産する原因だった。 */}
          <Link
            href="/courses/new"
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium bg-ink text-text-on-primary rounded-lg hover:brightness-[0.85] transition-[filter,transform] duration-150 ease-out active:scale-[0.97]"
          >
            <Plus className="w-3 h-3" />
            新規作成
          </Link>
        </div>
      </div>

      {/* 一括操作バー。
          展開は複数教室のときだけだが、アーカイブや戻す操作は単一教室でも必要なので
          バー自体は常に出し、ボタンだけを出し分ける。 */}
      {!isLoading && courses.length > 0 && (
        <div
          className={`mb-2 flex items-center gap-3 px-3 py-1.5 rounded-lg border transition-[background-color,border-color,box-shadow] duration-200 ease-out ${
            hasSelection
              ? 'bg-info/5 border-info/20 shadow-sm'
              : 'bg-surface-raised border-border-subtle'
          }`}
        >
          <button
            onClick={toggleSelectAll}
            className="text-xs text-text-muted hover:text-text-heading transition-colors flex items-center gap-1.5"
          >
            {selected.size === filteredSorted.length && filteredSorted.length > 0 ? (
              <CheckSquare className="w-3.5 h-3.5 text-info" />
            ) : (
              <Square className="w-3.5 h-3.5" />
            )}
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
              {showArchived ? (
                <button
                  onClick={handleBulkRestore}
                  disabled={isBulkRunning}
                  className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-bold border border-border rounded-lg text-text-body hover:bg-surface-hover active:scale-[0.97] transition-[background-color,transform] duration-150 ease-out disabled:opacity-50"
                >
                  {isBulkRunning ? (
                    <InlineLoading size="sm" label="戻しています..." />
                  ) : (
                    <>
                      <RotateCcw className="w-3 h-3" />
                      戻す
                    </>
                  )}
                </button>
              ) : (
                <button
                  onClick={handleBulkArchive}
                  disabled={isBulkRunning}
                  className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-bold border border-border rounded-lg text-text-body hover:bg-surface-hover hover:text-danger active:scale-[0.97] transition-[background-color,color,transform] duration-150 ease-out disabled:opacity-50"
                >
                  {isBulkRunning ? (
                    <InlineLoading size="sm" label="アーカイブ中..." />
                  ) : (
                    <>
                      <Archive className="w-3 h-3" />
                      アーカイブ
                    </>
                  )}
                </button>
              )}
              {canDeploy && !showArchived && (
                <button
                  onClick={handleDeploy}
                  disabled={isDeploying}
                  className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-bold bg-info text-white rounded-lg hover:bg-info/90 active:scale-[0.97] transition-[background-color,transform] duration-150 ease-out disabled:opacity-50"
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
              )}
            </>
          ) : (
            <>
              <div className="flex-1" />
              <span className="text-[11px] text-text-faint">
                {showArchived
                  ? 'チェックしてまとめて戻す'
                  : canDeploy
                    ? 'チェックして全教室に展開・アーカイブ'
                    : 'チェックしてまとめてアーカイブ'}
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
          {showArchived ? (
            <p className="text-text-body">アーカイブされた講習はありません。</p>
          ) : (
            <>
              <p className="text-text-body mb-4">講習が登録されていません。</p>
              <Link
                href="/courses/new"
                className="inline-flex items-center gap-1 px-4 py-2 text-sm font-medium bg-ink text-text-on-primary rounded-lg hover:brightness-[0.85] transition-[filter,transform] duration-150 ease-out active:scale-[0.97]"
              >
                <Plus className="w-4 h-4" />
                最初の講習を作成
              </Link>
            </>
          )}
        </div>
      ) : filteredSorted.length === 0 ? (
        <div className="bg-surface-raised rounded-xl border border-border p-8 text-center">
          <p className="text-sm text-text-muted mb-3">該当する講習が見つかりません</p>
          <button onClick={clearFilters} className="text-sm text-primary hover:underline">
            絞り込みを解除
          </button>
        </div>
      ) : (
        <div className="max-h-[calc(100vh-130px)] overflow-y-auto rounded-xl border border-border-default bg-surface-raised">
          <div className="divide-y divide-border-subtle">
            {filteredSorted.map((course) => {
              const isChecked = selected.has(course.id);
              return (
                <div
                  key={course.id}
                  className={`group flex items-start gap-3 transition-colors duration-100 ${
                    isChecked ? 'bg-info/5' : 'hover:bg-surface-hover/50'
                  }`}
                >
                  {/* チェックボックス（単一教室でも一括アーカイブに使うので常に出す） */}
                  <button
                    onClick={() => toggleSelect(course.id)}
                    className="pl-4 pt-4 text-text-faint hover:text-text-heading transition-colors shrink-0"
                    aria-label={`「${course.name}」を選択`}
                  >
                    {isChecked ? (
                      <CheckSquare className="w-4 h-4 text-info" />
                    ) : (
                      <Square className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" />
                    )}
                  </button>

                  {/* コンテンツ */}
                  <Link
                    href={`/courses/${course.id}`}
                    className="flex-1 flex items-center gap-3 py-3 pr-4 min-w-0"
                  >
                    <div className="flex-1 min-w-0">
                      {/* 1行目: 季節 + 教科 + 講習名 */}
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span
                          className={`shrink-0 px-2 py-0.5 text-[11px] font-bold rounded ${SEASON_COLORS[course.season]}`}
                        >
                          {SEASON_LABELS[course.season]}
                        </span>
                        {(() => {
                          const subjects = Array.from(
                            new Set(
                              (course.textbooks
                                ?.map((t) => t.textbook?.subject)
                                .filter(Boolean) as string[]) ?? []
                            )
                          );
                          return subjects.map((s) => {
                            const c = SUBJECT_BADGE_COLORS[s] ?? DEFAULT_BADGE_COLOR;
                            return (
                              <span
                                key={s}
                                className={`inline-flex px-1.5 py-0.5 text-[10px] font-bold rounded shrink-0 ${c.bg} ${c.text}`}
                              >
                                {s}
                              </span>
                            );
                          });
                        })()}
                        <span className="font-medium text-sm text-text-heading truncate">
                          {course.name}
                        </span>
                      </div>
                      {/* 2行目: 学年 + コマ + 適用 + テキスト名 */}
                      <div className="mt-1 flex items-center gap-1.5 flex-wrap text-xs">
                        {course.target_grades.length > 0 &&
                          course.target_grades.map((g) => (
                            <span
                              key={g}
                              className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 text-[10px] font-medium"
                            >
                              {GRADE_LABELS[g]}
                            </span>
                          ))}
                        {course.total_koma > 0 && (
                          <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-medium tabular-nums">
                            {course.total_koma}コマ
                          </span>
                        )}
                        {/* 単元が未設定＝雛形として未完成。展開も適用もできないので目立たせる */}
                        {course.curriculum_count === 0 && (
                          <span
                            className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-[10px] font-medium"
                            title="単元とコマ数が未設定です。このままでは他教室に展開できません"
                          >
                            未設定
                          </span>
                        )}
                        {(course.application_count || 0) > 0 && (
                          <span
                            className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 text-[10px] font-medium tabular-nums"
                            title="この講習を適用した生徒数"
                          >
                            適用 {course.application_count}名
                          </span>
                        )}
                        {course.textbooks && course.textbooks.length > 0 && (
                          <span className="text-text-muted truncate">
                            {course.textbooks
                              .map((t) => t.textbook?.name)
                              .filter(Boolean)
                              .join('、')}
                          </span>
                        )}
                      </div>
                      {course.comment && (
                        <p className="mt-0.5 text-xs text-text-muted/70 line-clamp-1">
                          {course.comment}
                        </p>
                      )}
                    </div>

                    <ChevronRight className="w-4 h-4 text-text-faint shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </Link>

                  {showArchived ? (
                    <button
                      onClick={() => handleRestore(course.id, course.name)}
                      disabled={rowActionId === course.id}
                      className="mr-3 mt-3 inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-text-muted border border-border rounded-lg hover:bg-surface-hover hover:text-text-heading transition-colors duration-150 ease-out shrink-0 disabled:opacity-50"
                      title="有効な講習に戻す"
                      aria-label={`「${course.name}」を元に戻す`}
                    >
                      <RotateCcw className="w-3 h-3" />
                      戻す
                    </button>
                  ) : (
                    <button
                      onClick={() => handleArchive(course.id, course.name)}
                      disabled={rowActionId === course.id}
                      // ホバーでしか出ないとタッチ端末から押せないので常時表示にする。
                      // 誤爆しないよう既定は淡色で、ホバー・フォーカス時だけ危険色にする。
                      className="pr-3 pt-3.5 text-text-faint/60 hover:text-danger focus-visible:text-danger transition-colors duration-150 ease-out shrink-0 disabled:opacity-50"
                      title="講習をアーカイブ"
                      aria-label={`「${course.name}」をアーカイブ`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {ConfirmDialog}
    </AdminLayout>
  );
}
