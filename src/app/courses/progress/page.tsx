'use client';

import { useState, useEffect, useCallback, useMemo, useRef, type CSSProperties } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { Printer, Trash2, AlertTriangle, Lock, History } from 'lucide-react';
import { AdminLayout } from '@/components/layouts';
import { Loading, InlineLoading } from '@/components/ui';
import { StudentDetailModal } from '@/components/students';
import { ContextHelp } from '@/components/help/ContextHelp';
import { CourseProgressReport, AllSchoolsReport } from '@/components/course-progress';

// 重いテーブル本体・ダッシュボードは初期バンドルに含めず、データ取得と並行して遅延ロード
const CourseProgressDashboard = dynamic(
  () => import('@/components/course-progress').then((m) => m.CourseProgressDashboard),
  { ssr: false, loading: () => <div className="h-32 rounded-xl bg-gray-50 animate-pulse" /> }
);
const CourseProgressTable = dynamic(
  () => import('@/components/course-progress').then((m) => m.CourseProgressTable),
  { ssr: false, loading: () => <div className="h-96 rounded-xl bg-gray-50 animate-pulse" /> }
);
const AllSchoolsOverview = dynamic(
  () => import('@/components/course-progress').then((m) => m.AllSchoolsOverview),
  { ssr: false, loading: () => <div className="h-44 rounded-xl bg-gray-50 animate-pulse" /> }
);
import { SeasonYearSelector } from '@/components/course-shared/SeasonYearSelector';
import { TemplateApplyDialog } from '@/components/course-shared/TemplateApplyDialog';
import { supabase } from '@/lib/supabase';
import {
  batchFetchCoursePrepApi,
  batchFetchCoursePrepApiMulti,
  callCoursePrepApi,
  invalidateCoursePrepCache,
} from '@/lib/api/coursePrepApi';
import { computeSchoolKpis } from '@/lib/coursePrepKpis';
import type { SchoolOverviewRow } from '@/components/course-progress';
import {
  upsertCoursePrepPeriod,
  updateStudentProgress,
  updateStudentProgressNumber,
  updateStudentProgressDate,
  createCourseProgressItem,
  updateCourseProgressItem,
  deleteCourseProgressItem,
  hideCourseProgressItem,
  unhideCourseProgressItem,
  getProgressTableSummary,
  deleteProgressTable,
  saveCoursePrepSnapshot,
  getCoursePrepSnapshot,
  type AutoValues,
  type ProgressTableSummary,
} from '@/lib/api/courseProgress';
import {
  getTemplates,
  initializeProgressFromTemplate,
  saveCurrentAsTemplate,
  deleteTemplate,
} from '@/lib/api/courseTemplates';
import type {
  Student,
  CourseProgressItem,
  StudentCourseProgress,
  CoursePrepPeriod,
  CourseTemplate,
  ScheduleTaskWithMarkers,
  ApplicationStatus,
  SeasonType,
  ApplicationColumnType,
  CoursePrepSnapshot,
  CoursePrepSnapshotMeta,
} from '@/types/database';
import { PROGRESS_COLUMN_GROUPS, SEASON_LABELS } from '@/types/database';
import { useRequirePermission, useCanEdit } from '@/hooks/usePermissions';
import AccessDenied from '@/components/AccessDenied';
import { useAuth } from '@/contexts/AuthContext';
import { getUserErrorMessage } from '@/lib/utils/errorMessages';
import { HelpTooltip } from '@/components/ui/Tooltip';
import { loadSavedSeasonYear, saveSavedSeasonYear } from '@/lib/utils/coursePrepStorage';
import { useLocalSchoolId } from '@/hooks/useLocalSchoolId';
import { SchoolSwitcher } from '@/components/SchoolSwitcher';
import { formatGradeLabel } from '@/lib/utils/gradeLabel';

/** 確定保存の日時を「2026年9月4日」の形にする（時刻までは要らない） */
function formatSnapshotDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

export default function CourseProgressPage() {
  const { hasPermission, isLoading: permissionLoading } = useRequirePermission(
    (p) => p.canAccessCourses
  );
  const canEdit = useCanEdit('canEditApplications');
  const { selectedSchoolId, profile } = useAuth();
  const { localSchoolId, setLocalSchoolId, isAllSelected, availableSchools } = useLocalSchoolId();
  const isOwnerOrAbove = profile?.role === 'owner' || profile?.role === 'admin';
  const isManagerOrAbove = isOwnerOrAbove || profile?.role === 'manager';

  // 期・年選択（localStorageから復元、工程表と共有）
  const [season, setSeasonRaw] = useState<SeasonType>(() => loadSavedSeasonYear().season);
  const [year, setYearRaw] = useState(() => loadSavedSeasonYear().year);

  const setSeason = useCallback(
    (s: SeasonType) => {
      setSeasonRaw(s);
      saveSavedSeasonYear(s, year);
    },
    [year]
  );

  const setYear = useCallback(
    (y: number) => {
      setYearRaw(y);
      saveSavedSeasonYear(season, y);
    },
    [season]
  );

  const router = useRouter();

  // 進捗表の生徒名クリックで開く「生徒情報」モーダル
  const [infoStudent, setInfoStudent] = useState<Student | null>(null);

  // レポート印刷プレビュー（A3縦1枚）。'single'=表示中の1教室 / 'all'=全教室横断。
  const [reportMode, setReportMode] = useState<'none' | 'single' | 'all'>('none');

  // データ
  // ライブ（現在のDBから再計算された）データ。確定保存を表示しているときは
  // 下の students / items / ... がスナップショット側に差し替わる。
  const [liveStudents, setStudents] = useState<Student[]>([]);
  const [liveItems, setItems] = useState<CourseProgressItem[]>([]);
  const [liveProgressData, setProgressData] = useState<StudentCourseProgress[]>([]);
  const [livePeriod, setPeriod] = useState<CoursePrepPeriod | null>(null);
  const [liveAutoValuesData, setAutoValuesData] = useState<AutoValues>({});

  // 確定保存（スナップショット）。設計は docs/koushu-progress-snapshot-plan.md。
  // meta は「この期が保存済みか」を示すだけの軽い情報で、表を再生するときだけ payload を取りにいく。
  const [snapshotMeta, setSnapshotMeta] = useState<CoursePrepSnapshotMeta | null>(null);
  const [snapshot, setSnapshot] = useState<CoursePrepSnapshot | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [isSavingSnapshot, setIsSavingSnapshot] = useState(false);
  // 保存済みの期は既定で「当時の姿」を出す。ライブも見たいときだけ切り替える。
  const [showLiveInstead, setShowLiveInstead] = useState(false);

  const isSnapshotView = !!snapshot && !showLiveInstead;

  // 以降のロジックは差し替え後のデータだけを見る（表示・集計・印刷の分岐を増やさないため）。
  const students = isSnapshotView ? (snapshot.payload.students as Student[]) : liveStudents;
  const items = isSnapshotView ? snapshot.payload.items : liveItems;
  const progressData = isSnapshotView ? snapshot.payload.progress : liveProgressData;
  const period = isSnapshotView ? snapshot.payload.period : livePeriod;
  const autoValuesData = isSnapshotView
    ? (snapshot.payload.autoValues as AutoValues)
    : liveAutoValuesData;
  const [isLoading, setIsLoading] = useState(true);
  // 重い auto_values 集計の読み込み状態。表本体より遅れて到着するので分けて持つ。
  const [autoLoading, setAutoLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  // 「すべての教室」横断サマリー表示の状態。
  // isAllSelected（ヘッダーで全教室）のときのみ意味を持つ。既定は横断サマリーを先頭に出す。
  const [viewAllSchools, setViewAllSchools] = useState(true);
  const [allSchoolsKpis, setAllSchoolsKpis] = useState<SchoolOverviewRow[]>([]);
  const [allSchoolsLoading, setAllSchoolsLoading] = useState(true);
  // バックグラウンド更新中（カードは残したままボタンにスピナーを出す。初回ロードのスケルトンとは区別）
  const [allSchoolsRefreshing, setAllSchoolsRefreshing] = useState(false);
  const [allSchoolsUpdatedAt, setAllSchoolsUpdatedAt] = useState<Date | null>(null);
  // タブ復帰の自動更新を間引くための最終取得時刻（連続フォーカスでの過剰リクエストを防ぐ）
  const lastAllFetchAtRef = useRef(0);
  // 横断サマリーを表示する条件（全教室選択 かつ サマリーモード）
  const showAllSchoolsOverview = isAllSelected && viewAllSchools;

  // テンプレート
  const [templates, setTemplates] = useState<CourseTemplate[]>([]);
  const [showTemplateDialog, setShowTemplateDialog] = useState(false);
  const [templateLoading, setTemplateLoading] = useState(false);

  // スケジュールタスク（リンク設定用）
  const [scheduleTasks, setScheduleTasks] = useState<ScheduleTaskWithMarkers[]>([]);

  // テンプレート保存
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveTemplateName, setSaveTemplateName] = useState('');
  const [saving, setSaving] = useState(false);

  // 進捗表まるごとの削除（取り消し不可なので、消える件数を見せてから実行する）
  const [showDeleteTableDialog, setShowDeleteTableDialog] = useState(false);
  const [deleteSummary, setDeleteSummary] = useState<ProgressTableSummary | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deletingTable, setDeletingTable] = useState(false);
  const [deleteMessage, setDeleteMessage] = useState('');

  // フィルター
  const [searchQuery, setSearchQuery] = useState('');
  // フィルタ計算は重い memo を多数連動させるので 250ms デバウンスして打鍵中の再計算を抑える
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [gradeFilter, setGradeFilter] = useState<number | null>(null);
  const [showHidden, setShowHidden] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearchQuery(searchQuery), 250);
    return () => clearTimeout(id);
  }, [searchQuery]);

  // 設定パネル（フィルター + 項目管理 をアコーディオン統合）
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'filter' | 'items'>('filter');
  const [newItemName, setNewItemName] = useState('');
  const [newItemType, setNewItemType] = useState<ApplicationColumnType>('check');
  const [newItemGroup, setNewItemGroup] = useState<string>('');
  const [newItemAutoSource, setNewItemAutoSource] = useState<string>('');
  const [dragItemId, setDragItemId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setAutoLoading(true);
    setErrorMessage('');
    if (!localSchoolId) {
      setErrorMessage('教室が選択されていません');
      setIsLoading(false);
      setAutoLoading(false);
      return;
    }
    const schoolId = localSchoolId;
    const params = { schoolId, season, year: String(year), includeHidden: String(showHidden) };

    // 表本体（軽いクエリ）と auto_values（提案書集計・通塾日程ページングで重い）を
    // 別リクエストで並列発行する。重い集計の完了を待たずにグリッドを先に描画して体感を上げる。
    const lightPromise = batchFetchCoursePrepApi(params, [
      'students',
      'progress_items',
      'student_progress',
      'period',
      // この期が確定保存済みかどうか（payload は含まない軽い情報）
      'snapshot_meta',
    ]);
    const heavyPromise = batchFetchCoursePrepApi(params, ['auto_values', 'schedule_tasks']);

    // 重い集計は後追いで反映（ダッシュボードのカードはこれが届いてから表示）
    heavyPromise
      .then((heavy) => {
        setAutoValuesData((heavy.auto_values || {}) as AutoValues);
        setScheduleTasks((heavy.schedule_tasks || []) as ScheduleTaskWithMarkers[]);
      })
      .catch((error) => {
        console.error('Error fetching auto_values:', error);
      })
      .finally(() => setAutoLoading(false));

    // 軽いデータ: 到着次第グリッドを表示
    try {
      const batchData = await lightPromise;

      const studentsData = ((batchData.students as Record<string, unknown>[]) || []) as Student[];

      const itemsData = ((batchData.progress_items as Record<string, unknown>[]) || []).map(
        (item) => ({
          ...item,
          column_type: (item.column_type as string) || 'check',
          manager_only: item.manager_only === true,
          is_hidden: item.is_hidden === true,
          deadline: (item.deadline as string) || null,
          auto_source: (item.auto_source as string) || null,
        })
      ) as CourseProgressItem[];

      const progressResult = ((batchData.student_progress as Record<string, unknown>[]) || []).map(
        (d) => ({
          ...d,
          number_value: d.number_value ?? null,
          date_value: d.date_value ?? null,
        })
      ) as StudentCourseProgress[];

      setStudents(studentsData);
      setItems(itemsData);
      setProgressData(progressResult);
      setPeriod((batchData.period as CoursePrepPeriod) || null);

      // 期を切り替えたので、前の期のスナップショットを持ち越さない。
      const meta = (batchData.snapshot_meta as CoursePrepSnapshotMeta | null) ?? null;
      setSnapshotMeta(meta);
      setSnapshot(null);
      setShowLiveInstead(false);
      if (meta) {
        // 保存済みなら当時の姿を既定で出すため、payload を後追いで取りにいく。
        setSnapshotLoading(true);
        getCoursePrepSnapshot(schoolId, season, year)
          .then((snap) => setSnapshot(snap))
          .catch((e) => console.error('Error fetching snapshot:', e))
          .finally(() => setSnapshotLoading(false));
      }

      // 項目が0件なら初回テンプレート適用を提案
      if (itemsData.length === 0 && isOwnerOrAbove) {
        const tpls = await getTemplates('progress', season, schoolId);
        setTemplates(tpls);
        if (tpls.length > 0) {
          setShowTemplateDialog(true);
        }
      }
    } catch (error) {
      console.error('Error fetching data:', error);
      setErrorMessage(getUserErrorMessage(error, 'データの取得に失敗しました'));
    } finally {
      setIsLoading(false);
    }
  }, [localSchoolId, season, year, showHidden, isOwnerOrAbove]);

  useEffect(() => {
    // 横断サマリー表示中は単一校の取得をスキップ（無駄なリクエストを避ける）
    if (selectedSchoolId !== null && !showAllSchoolsOverview) {
      fetchData();
    }
  }, [fetchData, localSchoolId, showAllSchoolsOverview]);

  // 全教室横断サマリー用のデータ取得。
  // 各校分を batch_get_multi で1リクエストにまとめ、校ごとにKPIを算出する。
  // 進捗項目（列）は校ごとに別管理のため、提案/決定コマ列の特定も校ごとに行う（computeSchoolKpis 内）。
  const fetchAllSchools = useCallback(
    async (background = false) => {
      if (availableSchools.length === 0) {
        setAllSchoolsKpis([]);
        setAllSchoolsLoading(false);
        return;
      }
      // background=true（更新ボタン/タブ復帰）はカードを残してスピナーだけ。初回はスケルトン。
      if (background) setAllSchoolsRefreshing(true);
      else setAllSchoolsLoading(true);
      const today = new Date().toISOString().slice(0, 10);
      try {
        const multi = await batchFetchCoursePrepApiMulti(
          {
            schoolIds: availableSchools.map((s) => s.id),
            season,
            year: String(year),
            includeHidden: String(showHidden),
          },
          ['students', 'progress_items', 'student_progress', 'period', 'auto_values']
        );
        const rows: SchoolOverviewRow[] = availableSchools.map((school) => {
          const batch = multi[school.id] || {};
          const students = (batch.students as Parameters<typeof computeSchoolKpis>[0]) || [];
          const items = (batch.progress_items as Parameters<typeof computeSchoolKpis>[1]) || [];
          const progress =
            (batch.student_progress as Parameters<typeof computeSchoolKpis>[2]) || [];
          const autoValues = (batch.auto_values as Parameters<typeof computeSchoolKpis>[3]) || {};
          const period = (batch.period as Parameters<typeof computeSchoolKpis>[4]) || null;
          return {
            schoolId: school.id,
            schoolName: school.name,
            kpis: computeSchoolKpis(students, items, progress, autoValues, period, today),
          };
        });
        setAllSchoolsKpis(rows);
        setAllSchoolsUpdatedAt(new Date());
        lastAllFetchAtRef.current = Date.now();
      } catch (error) {
        console.error('Error fetching all-schools overview:', error);
        setErrorMessage(getUserErrorMessage(error, '横断サマリーの取得に失敗しました'));
      } finally {
        if (background) setAllSchoolsRefreshing(false);
        else setAllSchoolsLoading(false);
      }
    },
    [availableSchools, season, year, showHidden]
  );

  // 手動「更新」: マルチ取得キャッシュを無効化し、横断ビューだけ取り直す（リロード不要）。
  const refreshAllSchools = useCallback(() => {
    invalidateCoursePrepCache();
    fetchAllSchools(true);
  }, [fetchAllSchools]);

  useEffect(() => {
    if (showAllSchoolsOverview) {
      fetchAllSchools();
    }
  }, [showAllSchoolsOverview, fetchAllSchools]);

  // タブ復帰時に自動更新。直近20秒以内に取得済みならスキップして過剰リクエストを防ぐ。
  useEffect(() => {
    if (!showAllSchoolsOverview) return;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastAllFetchAtRef.current < 20_000) return;
      refreshAllSchools();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [showAllSchoolsOverview, refreshAllSchools]);

  // 表示用項目（講師はmanager_only除外 / 非表示除外）
  const displayItems = useMemo(() => {
    let result = items;
    if (profile?.role === 'teacher') {
      result = result.filter((i) => !i.manager_only);
    }
    if (!showHidden) {
      result = result.filter((i) => !i.is_hidden);
    }
    return result;
  }, [items, profile?.role, showHidden]);

  // フィルター適用（デバウンス後の検索クエリを使用）
  const filteredStudents = useMemo(() => {
    let result = students;
    if (gradeFilter !== null) {
      result = result.filter((s) => s.grade === gradeFilter);
    }
    if (debouncedSearchQuery) {
      const q = debouncedSearchQuery.toLowerCase();
      result = result.filter(
        (s) =>
          s.last_name.toLowerCase().includes(q) ||
          s.first_name.toLowerCase().includes(q) ||
          s.last_name_kana.toLowerCase().includes(q) ||
          s.first_name_kana.toLowerCase().includes(q)
      );
    }
    return result;
  }, [students, gradeFilter, debouncedSearchQuery]);

  // ステータス変更
  // 「面談申込」「面談未申込対応」項目を名前で特定（テンプレ共通名のため名前マッチ）。
  // 「面談未申込対応」は“面談を申し込んでいない人”への対応なので、面談申込が付いたら自動で「対象外」にする。
  const interviewLinkItemIds = useMemo(() => {
    const applyItem = items.find(
      (i) => i.column_type === 'check' && i.name.includes('面談申込') && !i.name.includes('未')
    );
    const followUpItem = items.find((i) => i.column_type === 'check' && i.name.includes('未申込'));
    return { applyItemId: applyItem?.id ?? null, followUpItemId: followUpItem?.id ?? null };
  }, [items]);

  // 単一項目のステータス更新（ローカル即時反映＋DB保存）
  const updateSingleStatus = useCallback(
    async (studentId: string, itemId: string, status: ApplicationStatus | null) => {
      // ローカル更新
      setProgressData((prev) => {
        if (status === null) {
          return prev.filter((d) => !(d.student_id === studentId && d.item_id === itemId));
        }
        const existing = prev.find((d) => d.student_id === studentId && d.item_id === itemId);
        if (existing) {
          return prev.map((d) => (d.id === existing.id ? { ...d, status } : d));
        }
        const schoolId = students.find((s) => s.id === studentId)?.school_id || '';
        return [
          ...prev,
          {
            id: `temp-${studentId}-${itemId}`,
            school_id: schoolId,
            student_id: studentId,
            item_id: itemId,
            status,
            number_value: null,
            date_value: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ];
      });
      try {
        const schoolId = students.find((s) => s.id === studentId)?.school_id;
        await updateStudentProgress(studentId, itemId, status, schoolId);
      } catch (err) {
        console.error('Error updating status:', err);
        fetchData();
      }
    },
    [students, fetchData]
  );

  const handleStatusChange = useCallback(
    async (studentId: string, itemId: string, status: ApplicationStatus | null) => {
      await updateSingleStatus(studentId, itemId, status);

      // 「面談申込」の連動: 申込が完了→「面談未申込対応」を自動で「対象外」/ 申込が外れたら未申込対応をクリア
      // （申し込んだ人には“未申込対応”が不要なため、完了ではなく対象外にする）
      const { applyItemId, followUpItemId } = interviewLinkItemIds;
      if (applyItemId && followUpItemId && itemId === applyItemId) {
        const linkedStatus: ApplicationStatus | null =
          status === 'completed' ? 'not_applicable' : null;
        await updateSingleStatus(studentId, followUpItemId, linkedStatus);
      }
    },
    [updateSingleStatus, interviewLinkItemIds]
  );

  // 数値変更
  const handleNumberChange = useCallback(
    async (studentId: string, itemId: string, value: number | null) => {
      setProgressData((prev) => {
        if (value === null) {
          return prev.filter((d) => !(d.student_id === studentId && d.item_id === itemId));
        }
        const existing = prev.find((d) => d.student_id === studentId && d.item_id === itemId);
        if (existing) {
          return prev.map((d) => (d.id === existing.id ? { ...d, number_value: value } : d));
        }
        const schoolId = students.find((s) => s.id === studentId)?.school_id || '';
        return [
          ...prev,
          {
            id: `temp-${studentId}-${itemId}`,
            school_id: schoolId,
            student_id: studentId,
            item_id: itemId,
            status: null,
            number_value: value,
            date_value: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ];
      });
      try {
        const schoolId = students.find((s) => s.id === studentId)?.school_id;
        await updateStudentProgressNumber(studentId, itemId, value, schoolId);
      } catch (err) {
        console.error('Error updating number:', err);
        fetchData();
      }
    },
    [students, fetchData]
  );

  // 日付変更
  const handleDateChange = useCallback(
    async (studentId: string, itemId: string, value: string | null) => {
      setProgressData((prev) => {
        if (value === null) {
          return prev.filter((d) => !(d.student_id === studentId && d.item_id === itemId));
        }
        const existing = prev.find((d) => d.student_id === studentId && d.item_id === itemId);
        if (existing) {
          return prev.map((d) => (d.id === existing.id ? { ...d, date_value: value } : d));
        }
        const schoolId = students.find((s) => s.id === studentId)?.school_id || '';
        return [
          ...prev,
          {
            id: `temp-${studentId}-${itemId}`,
            school_id: schoolId,
            student_id: studentId,
            item_id: itemId,
            status: null,
            number_value: null,
            date_value: value,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ];
      });
      try {
        const schoolId = students.find((s) => s.id === studentId)?.school_id;
        await updateStudentProgressDate(studentId, itemId, value, schoolId);
      } catch (err) {
        console.error('Error updating date:', err);
        fetchData();
      }
    },
    [students, fetchData]
  );

  /**
   * この期を確定保存する（取り直しは上書き）。
   *
   * 保存するのは集計結果ではなく「集計の入力」なので、payload はサーバー側で
   * ライブ表示と同じ取得関数から組み立てる。ここで渡す summary は一覧表示用の
   * キャッシュに過ぎない（正典は payload 側）。
   */
  const handleSaveSnapshot = useCallback(async () => {
    if (!localSchoolId) return;
    const already = !!snapshotMeta;
    const message = already
      ? `${year}年${SEASON_LABELS[season]}の確定データを、いまの内容で取り直します。\n以前保存した内容は上書きされます。よろしいですか？`
      : `${year}年${SEASON_LABELS[season]}の進捗管理表を確定保存します。\n以降この期は、保存した時点の内容で振り返れるようになります。`;
    if (!window.confirm(message)) return;

    setIsSavingSnapshot(true);
    setErrorMessage('');
    try {
      // 一覧用の見出し数値。ライブ側の集計をそのまま渡す。
      const today = new Date().toISOString().slice(0, 10);
      const kpis = computeSchoolKpis(
        liveStudents,
        liveItems,
        liveProgressData,
        liveAutoValuesData,
        livePeriod,
        today
      );
      await saveCoursePrepSnapshot(
        localSchoolId,
        season,
        year,
        kpis as unknown as Record<string, unknown>
      );
      // 保存後は当時の姿（＝いま保存した内容）に切り替えて、何が残ったかを確認できるようにする。
      const snap = await getCoursePrepSnapshot(localSchoolId, season, year);
      setSnapshot(snap);
      // meta は状態バー表示用なので、payload まで抱え込まないよう必要な項目だけ取り出す
      setSnapshotMeta(
        snap
          ? {
              id: snap.id,
              season: snap.season,
              year: snap.year,
              captured_at: snap.captured_at,
              captured_by: snap.captured_by,
              capture_reason: snap.capture_reason,
              student_count: snap.student_count,
              summary: snap.summary,
            }
          : null
      );
      setShowLiveInstead(false);
    } catch (error) {
      console.error('Error saving snapshot:', error);
      setErrorMessage(getUserErrorMessage(error, '確定保存に失敗しました'));
    } finally {
      setIsSavingSnapshot(false);
    }
  }, [
    localSchoolId,
    season,
    year,
    snapshotMeta,
    liveStudents,
    liveItems,
    liveProgressData,
    liveAutoValuesData,
    livePeriod,
  ]);

  // 予算コマ変更
  const handleBudgetKomaChange = useCallback(
    async (value: number) => {
      if (!localSchoolId) return;
      setPeriod((prev) => (prev ? { ...prev, budget_koma: value } : prev));
      try {
        await upsertCoursePrepPeriod(localSchoolId, season, year, { budget_koma: value });
      } catch (err) {
        console.error('Error updating budget:', err);
        fetchData();
      }
    },
    [localSchoolId, season, year, fetchData]
  );

  // 目標コマ変更
  const handleTargetKomaChange = useCallback(
    async (value: number) => {
      if (!localSchoolId) return;
      setPeriod((prev) => (prev ? { ...prev, target_koma: value } : prev));
      try {
        await upsertCoursePrepPeriod(localSchoolId, season, year, { target_koma: value });
      } catch (err) {
        console.error('Error updating target:', err);
        fetchData();
      }
    },
    [localSchoolId, season, year, fetchData]
  );

  // 予想取得率変更
  const handleExpectedRateChange = useCallback(
    async (value: number) => {
      if (!localSchoolId) return;
      setPeriod((prev) => (prev ? { ...prev, expected_rate: value } : prev));
      try {
        await upsertCoursePrepPeriod(localSchoolId, season, year, { expected_rate: value });
      } catch (err) {
        console.error('Error updating expected rate:', err);
        fetchData();
      }
    },
    [localSchoolId, season, year, fetchData]
  );

  // 講習期間日付変更 → upsert後にperiod+auto_valuesだけバッチ再取得（1リクエスト）
  const handlePeriodDateChange = useCallback(
    async (
      updates: Partial<Pick<CoursePrepPeriod, 'schedule_start_date' | 'schedule_end_date'>>
    ) => {
      if (!localSchoolId) return;
      try {
        await upsertCoursePrepPeriod(localSchoolId, season, year, updates);
        const batchResult = await batchFetchCoursePrepApi(
          { schoolId: localSchoolId, season, year: String(year) },
          ['period', 'auto_values']
        );
        setPeriod((batchResult.period as CoursePrepPeriod) || null);
        setAutoValuesData((batchResult.auto_values || {}) as AutoValues);
      } catch (err) {
        console.error('Error updating period dates:', err);
      }
    },
    [localSchoolId, season, year]
  );

  // テンプレート適用
  const handleApplyTemplate = useCallback(
    async (templateId: string) => {
      if (!localSchoolId) return;
      setTemplateLoading(true);
      try {
        await initializeProgressFromTemplate(localSchoolId, season, year, templateId);
        setShowTemplateDialog(false);
        await fetchData();
      } catch (err) {
        console.error('Error applying template:', err);
        setErrorMessage(getUserErrorMessage(err, 'テンプレートの適用に失敗しました'));
      } finally {
        setTemplateLoading(false);
      }
    },
    [localSchoolId, season, year, fetchData]
  );

  // テンプレート保存
  const handleSaveAsTemplate = useCallback(async () => {
    if (!localSchoolId || !saveTemplateName.trim()) return;
    setSaving(true);
    try {
      await saveCurrentAsTemplate(localSchoolId, season, year, 'progress', saveTemplateName.trim());
      alert('テンプレートを保存しました');
      setShowSaveDialog(false);
      setSaveTemplateName('');
    } catch (err) {
      console.error('Error saving template:', err);
      setErrorMessage(getUserErrorMessage(err, 'テンプレートの保存に失敗しました'));
    } finally {
      setSaving(false);
    }
  }, [localSchoolId, season, year, saveTemplateName]);

  // テンプレート削除
  const handleDeleteTemplate = useCallback(
    async (templateId: string) => {
      if (!localSchoolId) return;
      if (!confirm('このテンプレートを削除しますか？')) return;
      try {
        await deleteTemplate(templateId, localSchoolId);
        const tpls = await getTemplates('progress', season, localSchoolId);
        setTemplates(tpls);
      } catch (err) {
        console.error('Error deleting template:', err);
      }
    },
    [localSchoolId, season]
  );

  // 進捗表まるごとの削除
  // 取り消せない操作なので、開いた時点でサーバーに「何が消えるか」を数えさせて提示する。
  // 画面の items は「非表示項目も表示」の状態で欠けることがあり、件数の根拠にできない。
  const handleOpenDeleteTableDialog = useCallback(async () => {
    if (!localSchoolId) return;
    setDeleteConfirmText('');
    setDeleteSummary(null);
    setShowDeleteTableDialog(true);
    try {
      const summary = await getProgressTableSummary(localSchoolId, season, year);
      setDeleteSummary(summary);
    } catch (err) {
      console.error('Error loading progress table summary:', err);
      setShowDeleteTableDialog(false);
      setErrorMessage(getUserErrorMessage(err, '削除対象の確認に失敗しました'));
    }
  }, [localSchoolId, season, year]);

  const handleDeleteProgressTable = useCallback(async () => {
    if (!localSchoolId) return;
    setDeletingTable(true);
    try {
      const deleted = await deleteProgressTable(localSchoolId, season, year);
      setShowDeleteTableDialog(false);
      setDeleteSummary(null);
      setDeleteConfirmText('');
      // 横断サマリーは別キャッシュで持っているため、消えた教室の古い集計が残らないよう全クリアする
      invalidateCoursePrepCache();
      await fetchData();
      setDeleteMessage(
        `${SEASON_LABELS[season]}${year} の進捗表を削除しました（項目 ${deleted.items} 件 / 入力データ ${deleted.student_progress} 件）`
      );
    } catch (err) {
      console.error('Error deleting progress table:', err);
      setErrorMessage(getUserErrorMessage(err, '進捗表の削除に失敗しました'));
    } finally {
      setDeletingTable(false);
    }
  }, [localSchoolId, season, year, fetchData]);

  // スケジュールタスクとのリンク設定 → バッチ1リクエスト + 再取得1リクエスト
  const handleLinkScheduleTask = useCallback(
    async (itemId: string, taskId: string | null) => {
      if (!localSchoolId) return;
      try {
        const unlinkTaskIds = scheduleTasks
          .filter((t) => t.linked_progress_item_id === itemId)
          .map((t) => t.id);
        await callCoursePrepApi('batch_link_schedule_tasks', localSchoolId, {
          unlinkTaskIds,
          linkTaskId: taskId,
          linkItemId: itemId,
        });
        // 再取得
        const batchResult = await batchFetchCoursePrepApi(
          { schoolId: localSchoolId, season, year: String(year) },
          ['schedule_tasks']
        );
        setScheduleTasks((batchResult.schedule_tasks || []) as ScheduleTaskWithMarkers[]);
      } catch (err) {
        console.error('Error linking schedule task:', err);
      }
    },
    [localSchoolId, scheduleTasks, season, year]
  );

  // カレンダー同期
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');
  const handleSyncCalendar = useCallback(async () => {
    if (!localSchoolId) return;
    setSyncing(true);
    setSyncMessage('');
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setSyncMessage('認証エラー: ログインし直してください');
        return;
      }
      const res = await fetch('/api/courses/progress/sync-calendar', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ schoolId: localSchoolId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSyncMessage(data.error || '同期に失敗しました');
        return;
      }
      setSyncMessage(data.message);
      if (data.synced > 0) {
        await fetchData();
      }
    } catch (err) {
      console.error('Error syncing calendar:', err);
      setSyncMessage('カレンダー同期に失敗しました');
    } finally {
      setSyncing(false);
    }
  }, [localSchoolId, fetchData]);

  // テンプレートダイアログを手動で開く
  const handleOpenTemplateDialog = useCallback(async () => {
    if (!localSchoolId) return;
    const tpls = await getTemplates('progress', season, localSchoolId);
    setTemplates(tpls);
    setShowTemplateDialog(true);
  }, [season, localSchoolId]);

  // 項目関連の部分再取得（項目+進捗だけ。生徒やauto_valuesは不変）
  const refetchItems = useCallback(async () => {
    if (!localSchoolId) return;
    try {
      const batchResult = await batchFetchCoursePrepApi(
        { schoolId: localSchoolId, season, year: String(year), includeHidden: String(showHidden) },
        ['progress_items', 'student_progress']
      );
      const itemsData = ((batchResult.progress_items as Record<string, unknown>[]) || []).map(
        (item) => ({
          ...item,
          column_type: (item.column_type as string) || 'check',
          manager_only: item.manager_only === true,
          is_hidden: item.is_hidden === true,
          deadline: (item.deadline as string) || null,
          auto_source: (item.auto_source as string) || null,
        })
      ) as CourseProgressItem[];
      const progressResult = (
        (batchResult.student_progress as Record<string, unknown>[]) || []
      ).map((d) => ({
        ...d,
        number_value: d.number_value ?? null,
        date_value: d.date_value ?? null,
      })) as StudentCourseProgress[];
      setItems(itemsData);
      setProgressData(progressResult);
    } catch (err) {
      console.error('Error refetching items:', err);
    }
  }, [localSchoolId, season, year, showHidden]);

  // 項目追加
  const handleAddItem = useCallback(async () => {
    if (!newItemName.trim()) return;
    if (!localSchoolId) return;
    try {
      await createCourseProgressItem(
        {
          name: newItemName.trim(),
          column_type: newItemAutoSource ? 'number' : newItemType,
          column_group: newItemGroup || null,
          auto_source: newItemAutoSource || null,
        },
        localSchoolId,
        season,
        year
      );
      setNewItemName('');
      setNewItemType('check');
      setNewItemGroup('');
      setNewItemAutoSource('');
      await refetchItems();
    } catch (err) {
      console.error('Error creating item:', err);
      setErrorMessage(getUserErrorMessage(err, '項目の作成に失敗しました'));
    }
  }, [
    newItemName,
    newItemType,
    newItemGroup,
    newItemAutoSource,
    localSchoolId,
    season,
    year,
    refetchItems,
  ]);

  // 項目削除
  const handleDeleteItem = useCallback(
    async (itemId: string) => {
      if (!confirm('この項目を削除しますか？関連するデータも削除されます。')) return;
      if (!localSchoolId) return;
      try {
        await deleteCourseProgressItem(itemId, localSchoolId);
        await refetchItems();
      } catch (err) {
        console.error('Error deleting item:', err);
        setErrorMessage(getUserErrorMessage(err, '項目の削除に失敗しました'));
      }
    },
    [refetchItems, localSchoolId]
  );

  // 項目非表示トグル
  const handleToggleHideItem = useCallback(
    async (itemId: string, isHidden: boolean) => {
      if (!localSchoolId) return;
      try {
        if (isHidden) {
          await unhideCourseProgressItem(itemId, localSchoolId);
        } else {
          await hideCourseProgressItem(itemId, localSchoolId);
        }
        await refetchItems();
      } catch (err) {
        console.error('Error toggling item visibility:', err);
      }
    },
    [refetchItems, localSchoolId]
  );

  // 項目並び替え（D&D） → バッチ1リクエストで更新
  const handleDropItem = useCallback(
    async (dragId: string, dropId: string) => {
      if (dragId === dropId) return;
      if (!localSchoolId) return;
      const dragIdx = items.findIndex((i) => i.id === dragId);
      const dropIdx = items.findIndex((i) => i.id === dropId);
      if (dragIdx < 0 || dropIdx < 0) return;

      // 新しい並び順を作成
      const reordered = [...items];
      const [moved] = reordered.splice(dragIdx, 1);
      reordered.splice(dropIdx, 0, moved);

      // sort_orderを振り直し
      const updates = reordered.map((item, i) => ({ ...item, sort_order: i }));
      setItems(updates);

      // 変更のあった項目をバッチ1リクエストで送信
      try {
        const changed = updates
          .filter((u) => {
            const orig = items.find((o) => o.id === u.id);
            return orig && orig.sort_order !== u.sort_order;
          })
          .map((c) => ({ id: c.id, sort_order: c.sort_order }));
        if (changed.length > 0) {
          await callCoursePrepApi('batch_reorder_items', localSchoolId, { items: changed });
        }
      } catch (err) {
        console.error('Error reordering items:', err);
        fetchData();
      }
    },
    [items, localSchoolId, fetchData]
  );

  // 項目名変更
  const handleItemNameChange = useCallback(
    async (itemId: string, name: string) => {
      if (!localSchoolId) return;
      // ローカル即時反映
      setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, name } : i)));
      try {
        await updateCourseProgressItem(itemId, localSchoolId, { name });
      } catch (err) {
        console.error('Error updating item name:', err);
        fetchData();
      }
    },
    [localSchoolId, fetchData]
  );

  // 期日変更（ガントチャート連動はschedule側で実装）
  const handleItemDeadlineChange = useCallback(
    async (itemId: string, deadline: string | null) => {
      if (!localSchoolId) return;
      setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, deadline } : i)));
      try {
        await updateCourseProgressItem(itemId, localSchoolId, { deadline });
      } catch (err) {
        console.error('Error updating item deadline:', err);
        fetchData();
      }
    },
    [localSchoolId, fetchData]
  );

  // 権限チェック中
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

  // レポート印刷プレビュー: 画面をレポート単体に差し替え、印刷時はこのプレビューだけが用紙に載る。
  // （提案書印刷と同じ方式。印刷ボタンで window.print() を呼ぶ）
  if (reportMode !== 'none') {
    const seasonLabel = SEASON_LABELS[season];
    const reportToday = new Date().toISOString().slice(0, 10);
    const schoolName = availableSchools.find((s) => s.id === localSchoolId)?.name ?? '';
    return (
      <AdminLayout headerTitle="講習 進捗レポート">
        {/* ツールバー（印刷には出さない） */}
        <div className="mb-4 flex items-center gap-2 print:hidden">
          <button
            onClick={() => setReportMode('none')}
            className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600 transition-colors"
          >
            ← 戻る
          </button>
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-ink text-white rounded-lg hover:bg-ink/80 transition-colors"
          >
            <Printer className="w-3.5 h-3.5" />
            印刷する
          </button>
          <span className="text-xs text-gray-400">
            A3縦1枚 / {seasonLabel}
            {year}
            {reportMode === 'single' && schoolName ? ` / ${schoolName}` : ''}
          </span>
        </div>

        {/* レポート本体（印刷対象）。用紙イメージに合わせて白背景・中央寄せ。 */}
        <div className="course-report-print-root mx-auto max-w-[297mm] bg-white p-6 shadow-sm rounded-lg border border-gray-200 print:shadow-none print:border-0 print:rounded-none print:p-0">
          {reportMode === 'single' ? (
            <CourseProgressReport
              schoolName={schoolName}
              seasonLabel={seasonLabel}
              year={year}
              students={students}
              items={displayItems}
              progressData={progressData}
              autoValues={autoValuesData}
              period={period}
              today={reportToday}
            />
          ) : (
            <AllSchoolsReport
              seasonLabel={seasonLabel}
              year={year}
              rows={allSchoolsKpis}
              today={reportToday}
            />
          )}
        </div>
      </AdminLayout>
    );
  }

  // コンテキストヘルプ（?）。上部に独立した1行を取るのをやめ、ヘッダー右の
  // アクション群（設定など）と同じ行に並べる（座席表の上部整理と同じ方針）。
  const contextHelp = (
    <ContextHelp
      searchQuery="進捗管理"
      topics={[
        {
          title: '進捗を入力する',
          description: '生徒ごとの講習進捗を記録します。',
          steps: [
            '期・年を選択して対象データを表示',
            'テーブル内のセルをクリックして編集',
            '進捗ステータスやコマ数を入力',
          ],
        },
        {
          title: 'テンプレートを適用する',
          description: '保存済みテンプレートから一括設定します。',
          steps: [
            '「テンプレート適用」ボタンをクリック',
            '適用するテンプレートを選択',
            '上書き範囲を確認して適用',
          ],
        },
        {
          title: 'ダッシュボードで全体把握する',
          description: '教室全体の進捗状況をグラフで確認します。',
          steps: ['ページ上部のダッシュボードで完了率を確認', '遅れている生徒を素早く特定'],
        },
        {
          title: '作り間違えた進捗表を削除する',
          description: '期・年を間違えて作った進捗表をまるごと消します（管理者・オーナー）。',
          steps: [
            '削除したい期・年を選択して表示',
            '右上の「設定」を開き、パネル下部の「進捗表を削除」をクリック',
            '消える件数（項目・入力済みセル・期間設定）を確認して実行（取り消せません）',
          ],
        },
        {
          title: 'レポートをA3縦1枚で印刷する',
          description: '表示中の集計をA3縦1枚のレポートとして印刷します。',
          steps: [
            '右上の「レポート印刷」をクリック（1教室表示＝単一校 / すべての教室＝横断サマリー）',
            'プレビューで内容を確認',
            '「印刷する」でブラウザの印刷ダイアログを開き、用紙をA3・向きを縦にして印刷',
          ],
        },
      ]}
    />
  );

  return (
    <AdminLayout headerTitle="講習 進捗管理">
      <div>
        {isAllSelected && (
          <SchoolSwitcher
            schools={availableSchools}
            selectedSchoolId={localSchoolId}
            onChange={(id) => {
              // 個別教室を選んだら横断サマリーを抜けてその校の詳細表に切り替える
              setViewAllSchools(false);
              setLocalSchoolId(id);
            }}
            allowAll
            isAllActive={viewAllSchools}
            onSelectAll={() => setViewAllSchools(true)}
          />
        )}
        {/* ヘッダー: 期・年選択 + アクション */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <SeasonYearSelector
            season={season}
            year={year}
            onSeasonChange={setSeason}
            onYearChange={setYear}
          />
          {/* 右側の帯: アクション群 + ヘルプ（?）。? だけは表示モードによらず常に出す。 */}
          <div className="flex items-center gap-2">
            {/* アクションは単一校（特定教室の詳細表）のときだけ。横断サマリーでは非表示。 */}
            <div className={`flex items-center gap-2 ${showAllSchoolsOverview ? 'hidden' : ''}`}>
              {isOwnerOrAbove && (
                <>
                  <button
                    onClick={handleOpenTemplateDialog}
                    className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600 transition-[background-color,transform] duration-150 ease-out active:scale-[0.97]"
                  >
                    テンプレート適用
                  </button>
                  <button
                    onClick={() => {
                      const seasonLabel =
                        season === 'spring' ? '春期' : season === 'summer' ? '夏期' : '冬期';
                      setSaveTemplateName(`${seasonLabel}${year} 進捗管理テンプレート`);
                      setShowSaveDialog(true);
                    }}
                    className="px-3 py-1.5 text-xs border border-green-200 rounded-lg hover:bg-green-50 text-green-600 transition-[background-color,transform] duration-150 ease-out active:scale-[0.97]"
                  >
                    テンプレート保存
                  </button>
                  <button
                    onClick={handleSyncCalendar}
                    disabled={syncing}
                    className="px-3 py-1.5 text-xs border border-blue-200 rounded-lg hover:bg-blue-50 text-blue-600 disabled:opacity-50 transition-[background-color,transform] duration-150 ease-out active:scale-[0.97]"
                    title="Googleカレンダーの面談予約を取得して進捗を同期"
                  >
                    {syncing ? '同期中...' : '面談同期'}
                  </button>
                </>
              )}
              {isManagerOrAbove && (
                <button
                  onClick={() => setReportMode('single')}
                  disabled={isLoading || autoLoading || displayItems.length === 0}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600 disabled:opacity-50 transition-[background-color,transform] duration-150 ease-out active:scale-[0.97]"
                  title="表示中の教室の集計をA3縦1枚で印刷（集計の読み込み完了後に押せます）"
                >
                  <Printer className="w-3.5 h-3.5" />
                  レポート印刷
                </button>
              )}
              <button
                onClick={() => setShowSettings(!showSettings)}
                className={`px-3 py-1.5 text-xs border rounded-lg transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.97] ${showSettings ? 'border-ink bg-ink text-white' : 'border-gray-200 hover:bg-gray-50 text-gray-600'}`}
              >
                設定
              </button>
            </div>

            {/* 全教室横断サマリー表示中のレポート印刷（上のアクション群は横断時に隠れるため別置き） */}
            {showAllSchoolsOverview && isManagerOrAbove && (
              <button
                onClick={() => setReportMode('all')}
                disabled={allSchoolsLoading || allSchoolsKpis.length === 0}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600 disabled:opacity-50 transition-[background-color,transform] duration-150 ease-out active:scale-[0.97]"
                title="全教室の横断サマリーをA3縦1枚で印刷"
              >
                <Printer className="w-3.5 h-3.5" />
                レポート印刷
              </button>
            )}

            {contextHelp}
          </div>
        </div>

        {/* カレンダー同期結果 */}
        {syncMessage && (
          <div className="mb-4 px-4 py-2 rounded border border-blue-200 bg-blue-50 text-sm text-blue-700 flex items-center justify-between">
            <span>{syncMessage}</span>
            <button
              onClick={() => setSyncMessage('')}
              className="text-blue-400 hover:text-blue-600 ml-2"
            >
              &times;
            </button>
          </div>
        )}

        {/* 進捗表の削除結果（何がどれだけ消えたかを実績件数で残す） */}
        {deleteMessage && (
          <div className="mb-4 px-4 py-2 rounded border border-gray-200 bg-gray-50 text-sm text-gray-700 flex items-center justify-between">
            <span>{deleteMessage}</span>
            <button
              onClick={() => setDeleteMessage('')}
              className="text-gray-400 hover:text-gray-600 ml-2"
            >
              &times;
            </button>
          </div>
        )}

        {/* エラーメッセージ */}
        {errorMessage && (
          <div className="mb-4 bg-danger/20 text-danger px-4 py-2 rounded border border-danger">
            {errorMessage}
          </div>
        )}

        {/* 全教室横断サマリー（案A: 教室別KPIダッシュボード）。
            「すべての教室」選択時はこれを出し、個別校の詳細表・編集UIは出さない。
            カードクリックでその校の詳細表に切り替わる。 */}
        {showAllSchoolsOverview && (
          <AllSchoolsOverview
            rows={allSchoolsKpis}
            loading={allSchoolsLoading}
            refreshing={allSchoolsRefreshing}
            updatedAt={allSchoolsUpdatedAt}
            onRefresh={refreshAllSchools}
            onSelectSchool={(id) => {
              setViewAllSchools(false);
              setLocalSchoolId(id);
            }}
          />
        )}

        {/* 確定保存の状態バー。
            進捗表の数字はライブだと期の終了後も動き続ける（退塾で行が消える、通塾パターンの
            組み替えでコマ数が変わる）ため、確定済みかどうかを常に見えるところに出す。 */}
        {!showAllSchoolsOverview && !isLoading && displayItems.length > 0 && (
          <div
            className={`mb-4 rounded-xl border px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2 ${
              isSnapshotView ? 'bg-amber-50/60 border-amber-200' : 'bg-white border-gray-200'
            }`}
          >
            {snapshotLoading ? (
              <InlineLoading label="確定データを読み込み中…" />
            ) : (
              <>
                <div className="flex items-center gap-2 text-sm">
                  {isSnapshotView ? (
                    <>
                      <Lock className="w-4 h-4 text-amber-600" />
                      <span className="font-semibold text-amber-900">
                        {formatSnapshotDate(snapshotMeta?.captured_at)}時点の確定データ
                      </span>
                      <span className="text-xs text-amber-700">
                        （{snapshotMeta?.student_count ?? students.length}名・編集不可
                        {snapshotMeta?.capture_reason === 'auto' ? '・自動保存' : ''}）
                      </span>
                    </>
                  ) : snapshotMeta ? (
                    <>
                      <History className="w-4 h-4 text-gray-400" />
                      <span className="text-gray-600">
                        最新のデータを表示中（この期は
                        {formatSnapshotDate(snapshotMeta.captured_at)}に確定保存済み）
                      </span>
                    </>
                  ) : (
                    <>
                      <History className="w-4 h-4 text-gray-400" />
                      <span className="text-gray-500">この期はまだ確定保存されていません</span>
                    </>
                  )}
                </div>

                <div className="flex items-center gap-2 ml-auto">
                  {snapshot && (
                    <button
                      onClick={() => setShowLiveInstead((v) => !v)}
                      className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 transition-colors"
                    >
                      {isSnapshotView ? '最新のデータで見る' : '確定データに戻す'}
                    </button>
                  )}
                  {isManagerOrAbove && (
                    <button
                      onClick={handleSaveSnapshot}
                      disabled={isSavingSnapshot}
                      className="px-3 py-1.5 text-xs rounded-lg bg-ink text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
                    >
                      {isSavingSnapshot
                        ? '保存中…'
                        : snapshotMeta
                          ? '確定データを取り直す'
                          : 'この期を確定保存'}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* ダッシュボード（教室長以上のみ表示）。集計(auto_values)が届いてから表示し、
            それまではグリッドを先に出す。集計中は控えめなプレースホルダを表示する。
            確定データ表示中は集計もスナップショットに入っているので待たない。 */}
        {!showAllSchoolsOverview &&
          !isLoading &&
          displayItems.length > 0 &&
          isManagerOrAbove &&
          (autoLoading && !isSnapshotView ? (
            <div className="mb-4 bg-white rounded-xl border border-gray-200 p-6 flex items-center justify-center">
              <InlineLoading label="集計データを読み込み中…" />
            </div>
          ) : (
            <CourseProgressDashboard
              students={filteredStudents}
              items={displayItems}
              progressData={progressData}
              period={period}
              autoValues={autoValuesData}
              // 確定データは凍結物なので、予算・目標・期間の編集口を閉じる
              onBudgetKomaChange={
                isManagerOrAbove && !isSnapshotView ? handleBudgetKomaChange : undefined
              }
              onTargetKomaChange={
                isManagerOrAbove && !isSnapshotView ? handleTargetKomaChange : undefined
              }
              onExpectedRateChange={
                isManagerOrAbove && !isSnapshotView ? handleExpectedRateChange : undefined
              }
              onPeriodDateChange={
                isManagerOrAbove && !isSnapshotView ? handlePeriodDateChange : undefined
              }
            />
          ))}

        {/* 設定パネル（アコーディオン: フィルター + 項目管理） */}
        {!showAllSchoolsOverview && showSettings && (
          <div
            className="stagger-item mb-4 bg-white rounded-xl border border-gray-200 overflow-hidden"
            style={{ '--stagger-index': 0 } as CSSProperties}
          >
            {/* タブ切り替え */}
            <div className="flex border-b border-gray-200">
              <button
                onClick={() => setSettingsTab('filter')}
                className={`px-4 py-2 text-xs font-medium transition-colors duration-150 ${
                  settingsTab === 'filter'
                    ? 'text-ink border-b-2 border-ink bg-blue-50/30'
                    : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                フィルター
              </button>
              {isOwnerOrAbove && (
                <button
                  onClick={() => setSettingsTab('items')}
                  className={`px-4 py-2 text-xs font-medium transition-colors duration-150 ${
                    settingsTab === 'items'
                      ? 'text-ink border-b-2 border-ink bg-blue-50/30'
                      : 'text-gray-400 hover:text-gray-600'
                  }`}
                >
                  列の追加・削除
                </button>
              )}
            </div>

            <div className="p-4">
              {/* フィルタータブ */}
              {settingsTab === 'filter' && (
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="生徒名で検索..."
                    className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg w-48"
                  />
                  <select
                    value={gradeFilter ?? 'all'}
                    onChange={(e) =>
                      setGradeFilter(e.target.value === 'all' ? null : Number(e.target.value))
                    }
                    className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg"
                  >
                    <option value="all">全学年</option>
                    {[4, 5, 6, 7, 8, 9, 10, 11, 12].map((g) => (
                      <option key={g} value={g}>
                        {formatGradeLabel(g)}
                      </option>
                    ))}
                  </select>
                  {isOwnerOrAbove && (
                    <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={showHidden}
                        onChange={(e) => setShowHidden(e.target.checked)}
                        className="w-3.5 h-3.5 text-info rounded"
                      />
                      非表示項目も表示
                    </label>
                  )}
                  {(searchQuery || gradeFilter !== null) && (
                    <button
                      onClick={() => {
                        setSearchQuery('');
                        setGradeFilter(null);
                      }}
                      className="text-xs text-gray-400 hover:text-gray-600 transition-colors duration-150"
                    >
                      リセット
                    </button>
                  )}
                </div>
              )}

              {/* 列の追加・削除タブ */}
              {settingsTab === 'items' && isOwnerOrAbove && (
                <div>
                  {/* 新規追加 */}
                  <div className="flex flex-wrap items-end gap-2 mb-4 pb-4 border-b border-gray-100">
                    <div>
                      <label className="text-[10px] text-gray-500 block mb-0.5">項目名</label>
                      <input
                        type="text"
                        value={newItemName}
                        onChange={(e) => setNewItemName(e.target.value)}
                        placeholder="項目名"
                        className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg w-40"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500 block mb-0.5">タイプ</label>
                      <select
                        value={newItemType}
                        onChange={(e) => setNewItemType(e.target.value as ApplicationColumnType)}
                        className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg"
                      >
                        <option value="check">チェック</option>
                        <option value="number">数値</option>
                        <option value="date">日付</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500 block mb-0.5">グループ</label>
                      <select
                        value={newItemGroup}
                        onChange={(e) => setNewItemGroup(e.target.value)}
                        className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg"
                      >
                        <option value="">なし</option>
                        {Object.entries(PROGRESS_COLUMN_GROUPS).map(([key, val]) => (
                          <option key={key} value={key}>
                            {val.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500 mb-0.5 flex items-center gap-1">
                        自動計算
                        <HelpTooltip
                          text={
                            '自動計算を設定すると値が自動で入ります（編集不可）\n\n' +
                            '■ 通塾回数/週: 通塾パターンから週の回数\n' +
                            '■ 講習期間通常回数: 講習期間中の通塾回数合計\n' +
                            '■ 提示増コマ: 教科別コマ合計 - 講習期間通常回数\n' +
                            '■ 進行表コマ数: 進行表の提案コマを科目名で自動集計\n' +
                            '  ※ 項目名に科目名を含めてください（例: 英語, 数学）'
                          }
                          size={10}
                          position="bottom"
                        />
                      </label>
                      <select
                        value={newItemAutoSource}
                        onChange={(e) => setNewItemAutoSource(e.target.value)}
                        className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg"
                      >
                        <option value="">手動入力</option>
                        <option value="regular_weekly">通塾回数/週</option>
                        <option value="course_sessions">講習期間通常回数</option>
                        <option value="proposed_extra">提示増コマ (提案コマ計-通常回数)</option>
                        <option value="applied_extra">申込増コマ (申込コマ計-通常回数)</option>
                        <option value="subject_proposal">進行表コマ数 (科目別)</option>
                      </select>
                    </div>
                    <button
                      onClick={handleAddItem}
                      disabled={!newItemName.trim()}
                      className="px-3 py-1.5 text-xs bg-ink text-white rounded-lg hover:bg-ink/80 disabled:opacity-50 transition-colors duration-150"
                    >
                      追加
                    </button>
                  </div>

                  {/* 既存項目一覧 */}
                  <div className="space-y-0.5 max-h-80 overflow-y-auto">
                    {items.map((item) => {
                      const linkedTask = scheduleTasks.find(
                        (t) => t.linked_progress_item_id === item.id
                      );
                      return (
                        <div
                          key={item.id}
                          draggable
                          onDragStart={() => setDragItemId(item.id)}
                          onDragEnd={() => setDragItemId(null)}
                          onDragOver={(e) => {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = 'move';
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            if (dragItemId) handleDropItem(dragItemId, item.id);
                          }}
                          className={`flex items-center justify-between gap-2 px-2 py-1.5 rounded text-xs transition-[opacity,transform,border-color,background-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] ${
                            item.is_hidden ? 'bg-gray-50 text-gray-400' : ''
                          } ${dragItemId === item.id ? 'opacity-40 scale-95' : ''} ${dragItemId && dragItemId !== item.id ? 'border border-dashed border-blue-300' : 'border border-transparent'}`}
                        >
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <span
                              className="cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 shrink-0 select-none"
                              title="ドラッグで並び替え"
                            >
                              ⠿
                            </span>
                            <span className="font-medium shrink-0">{item.name}</span>
                            <select
                              value={item.column_type}
                              onChange={async (e) => {
                                if (!localSchoolId) return;
                                const newType = e.target.value as ApplicationColumnType;
                                setItems((prev) =>
                                  prev.map((i) =>
                                    i.id === item.id ? { ...i, column_type: newType } : i
                                  )
                                );
                                try {
                                  await updateCourseProgressItem(item.id, localSchoolId, {
                                    column_type: newType,
                                  });
                                } catch (err) {
                                  console.error('Error updating type:', err);
                                  fetchData();
                                }
                              }}
                              className="text-[10px] px-1 py-0.5 border border-gray-200 rounded bg-white text-gray-500"
                            >
                              <option value="check">チェック</option>
                              <option value="number">数値</option>
                              <option value="date">日付</option>
                            </select>
                            {item.column_group && (
                              <span
                                className="text-[9px] px-1 py-0.5 rounded shrink-0"
                                style={{
                                  backgroundColor:
                                    (PROGRESS_COLUMN_GROUPS[item.column_group]?.color ||
                                      '#6b7280') + '20',
                                  color:
                                    PROGRESS_COLUMN_GROUPS[item.column_group]?.color || '#6b7280',
                                }}
                              >
                                {PROGRESS_COLUMN_GROUPS[item.column_group]?.label ||
                                  item.column_group}
                              </span>
                            )}
                            {item.auto_source && (
                              <span className="text-[9px] px-1 py-0.5 bg-blue-100 text-blue-600 rounded shrink-0">
                                {item.auto_source === 'regular_weekly'
                                  ? '通塾回数'
                                  : item.auto_source === 'course_sessions'
                                    ? '通常回数'
                                    : item.auto_source === 'proposed_extra'
                                      ? '提示増コマ'
                                      : item.auto_source === 'applied_extra'
                                        ? '申込増コマ'
                                        : item.auto_source === 'subject_proposal'
                                          ? '進行表コマ'
                                          : '自動'}
                              </span>
                            )}
                            {item.is_hidden && (
                              <span className="text-[9px] px-1 py-0.5 bg-gray-200 text-gray-500 rounded shrink-0">
                                非表示
                              </span>
                            )}
                            {/* スケジュールリンク */}
                            {item.column_type === 'check' && scheduleTasks.length > 0 && (
                              <select
                                value={linkedTask?.id || ''}
                                onChange={(e) =>
                                  handleLinkScheduleTask(item.id, e.target.value || null)
                                }
                                className="text-[10px] px-1 py-0.5 border border-gray-200 rounded bg-white text-gray-600 max-w-[140px] truncate"
                                title={
                                  linkedTask
                                    ? `リンク: ${linkedTask.name}`
                                    : 'スケジュールタスクをリンク'
                                }
                              >
                                <option value="">リンクなし</option>
                                {scheduleTasks.map((t) => (
                                  <option key={t.id} value={t.id}>
                                    {t.major_category}: {t.name}
                                  </option>
                                ))}
                              </select>
                            )}
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={() => handleToggleHideItem(item.id, item.is_hidden)}
                              className="text-[10px] text-gray-400 hover:text-gray-600 px-1 transition-[color,transform] duration-150 ease-out active:scale-[0.97]"
                            >
                              {item.is_hidden ? '表示' : '非表示'}
                            </button>
                            <button
                              onClick={() => handleDeleteItem(item.id)}
                              className="text-[10px] text-danger hover:text-danger/80 px-1 transition-[color,transform] duration-150 ease-out active:scale-[0.97]"
                            >
                              削除
                            </button>
                          </div>
                        </div>
                      );
                    })}
                    {items.length === 0 && (
                      <p className="text-xs text-gray-400 text-center py-4">
                        項目がありません。テンプレートから作成するか、手動で追加してください。
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* 危険な操作: 期・年を間違えて作った進捗表を丸ごと片付けるための出口。
                  列の1件削除（上）と紛れないよう、タブの外に線で区切って置く。 */}
              {isOwnerOrAbove && (
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-danger/20 bg-danger/5 px-3 py-2.5">
                    <div>
                      <p className="text-xs font-medium text-danger">この進捗表を削除</p>
                      <p className="text-[10px] text-gray-500 mt-0.5">
                        {SEASON_LABELS[season]}
                        {year} の項目・生徒の入力値・期間設定がすべて消えます（取り消せません）。
                      </p>
                    </div>
                    <button
                      onClick={handleOpenDeleteTableDialog}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs border border-danger/30 rounded-lg text-danger hover:bg-danger/10 transition-[background-color,transform] duration-150 ease-out active:scale-[0.97]"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      進捗表を削除
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* テーブル（横断サマリー表示中は出さない） */}
        {!showAllSchoolsOverview &&
          (isLoading ? (
            <div className="bg-white rounded-xl border border-gray-200 p-8">
              <InlineLoading />
            </div>
          ) : displayItems.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
              <p className="text-text-body mb-4">進捗管理項目がありません。</p>
              {isOwnerOrAbove && (
                <button
                  onClick={handleOpenTemplateDialog}
                  className="px-4 py-2 text-sm bg-ink text-white rounded-lg hover:bg-ink/80 transition-[background-color,transform] duration-150 ease-out active:scale-[0.97]"
                >
                  テンプレートから作成
                </button>
              )}
            </div>
          ) : (
            <CourseProgressTable
              students={filteredStudents}
              items={displayItems}
              progressData={progressData}
              autoValues={autoValuesData}
              // 確定データは当時の記録なので、セルもヘッダーも一切編集させない
              canEdit={canEdit && !isSnapshotView}
              onStatusChange={handleStatusChange}
              onNumberChange={handleNumberChange}
              onDateChange={handleDateChange}
              onItemNameChange={isOwnerOrAbove ? handleItemNameChange : undefined}
              onItemDeadlineChange={isOwnerOrAbove ? handleItemDeadlineChange : undefined}
              // 確定データ表示中は生徒詳細を開かせない。
              // 凍結された当時の記録と、現在の生徒情報が混ざって見えるのを防ぐ。
              onShowStudentInfo={isSnapshotView ? undefined : setInfoStudent}
            />
          ))}
      </div>

      {/* 生徒情報モーダル（進捗表の生徒名クリックで開く）。編集は既存機構を再利用し生徒管理ページへ。 */}
      <StudentDetailModal
        isOpen={!!infoStudent}
        student={infoStudent}
        onClose={() => setInfoStudent(null)}
        onEdit={(s) => router.push(`/students?edit=${s.id}`)}
      />

      {/* テンプレート適用ダイアログ */}
      {showTemplateDialog && (
        <TemplateApplyDialog
          templates={templates}
          onApply={handleApplyTemplate}
          onClose={() => setShowTemplateDialog(false)}
          isLoading={templateLoading}
          onDelete={handleDeleteTemplate}
        />
      )}

      {/* テンプレート保存ダイアログ */}
      {showSaveDialog && (
        <div className="modal-overlay fixed inset-0 z-50 flex items-center justify-center">
          <div className="modal-panel bg-white rounded-xl shadow-xl p-6 w-96 max-w-[90vw]">
            <h3 className="text-sm font-bold text-ink mb-4">テンプレートとして保存</h3>
            <p className="text-xs text-gray-500 mb-3">
              現在の進捗管理項目をテンプレートとして保存します。
            </p>
            <input
              type="text"
              value={saveTemplateName}
              onChange={(e) => setSaveTemplateName(e.target.value)}
              placeholder="テンプレート名"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg mb-4"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && saveTemplateName.trim()) handleSaveAsTemplate();
              }}
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowSaveDialog(false)}
                className="px-4 py-2 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600 transition-[background-color,transform] duration-150 ease-out active:scale-[0.97]"
              >
                キャンセル
              </button>
              <button
                onClick={handleSaveAsTemplate}
                disabled={!saveTemplateName.trim() || saving}
                className="px-4 py-2 text-xs bg-ink text-white rounded-lg hover:bg-ink/80 disabled:opacity-50 transition-[background-color,transform] duration-150 ease-out active:scale-[0.97]"
              >
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 進捗表の削除ダイアログ
          取り消せない操作なので (1)消える件数を実データで見せ、(2)入力済みデータがある場合だけ
          期・年のタイプ入力を要求する。空の表（作り間違い）は1クリックで片付けられる。 */}
      {showDeleteTableDialog &&
        (() => {
          const confirmPhrase = `${SEASON_LABELS[season]}${year}`;
          const isEmpty =
            !!deleteSummary && deleteSummary.item_count === 0 && !deleteSummary.has_period;
          // 入力済みデータが1件でもあるなら、誤爆防止に期・年のタイプ入力を要求する
          const needsTyping = (deleteSummary?.progress_count ?? 0) > 0;
          const canDelete =
            !!deleteSummary &&
            !isEmpty &&
            !deletingTable &&
            (!needsTyping || deleteConfirmText.trim() === confirmPhrase);

          return (
            <div className="modal-overlay fixed inset-0 z-50 flex items-center justify-center">
              <div className="modal-panel bg-white rounded-xl shadow-xl p-6 w-[26rem] max-w-[90vw]">
                <h3 className="flex items-center gap-1.5 text-sm font-bold text-danger mb-1">
                  <AlertTriangle className="w-4 h-4" />
                  進捗表を削除
                </h3>
                <p className="text-xs text-gray-500 mb-4">
                  {SEASON_LABELS[season]}
                  {year}（{availableSchools.find((s) => s.id === localSchoolId)?.name ?? 'この教室'}
                  ）
                </p>

                {!deleteSummary ? (
                  <div className="py-6">
                    <InlineLoading />
                  </div>
                ) : isEmpty ? (
                  <p className="text-sm text-text-body mb-4">
                    この期・年には削除するデータがありません。
                  </p>
                ) : (
                  <>
                    <ul className="text-xs text-gray-700 space-y-1 mb-4 bg-gray-50 rounded-lg p-3">
                      <li>
                        進捗管理項目（列）: <strong>{deleteSummary.item_count}</strong> 件
                      </li>
                      <li>
                        生徒の入力データ: <strong>{deleteSummary.progress_count}</strong> セル
                      </li>
                      <li>
                        期間設定（予算コマ・講習期間など）:{' '}
                        {deleteSummary.has_period ? 'あり' : 'なし'}
                      </li>
                      {deleteSummary.linked_task_count > 0 && (
                        <li className="text-gray-500">
                          工程表からのリンク {deleteSummary.linked_task_count}{' '}
                          件が外れます（工程表のタスク自体は残ります）
                        </li>
                      )}
                    </ul>
                    <p className="text-xs text-danger mb-3">この操作は取り消せません。</p>

                    {needsTyping && (
                      <div className="mb-4">
                        <label className="text-[10px] text-gray-500 block mb-1">
                          確認のため <strong>{confirmPhrase}</strong> と入力してください
                        </label>
                        <input
                          type="text"
                          value={deleteConfirmText}
                          onChange={(e) => setDeleteConfirmText(e.target.value)}
                          placeholder={confirmPhrase}
                          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
                          autoFocus
                        />
                      </div>
                    )}
                  </>
                )}

                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setShowDeleteTableDialog(false)}
                    disabled={deletingTable}
                    className="px-4 py-2 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600 disabled:opacity-50 transition-[background-color,transform] duration-150 ease-out active:scale-[0.97]"
                  >
                    {deleteSummary && isEmpty ? '閉じる' : 'キャンセル'}
                  </button>
                  {!(deleteSummary && isEmpty) && (
                    <button
                      onClick={handleDeleteProgressTable}
                      disabled={!canDelete}
                      className="inline-flex items-center gap-1 px-4 py-2 text-xs bg-danger text-white rounded-lg hover:bg-danger/90 disabled:opacity-50 transition-[background-color,transform] duration-150 ease-out active:scale-[0.97]"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      {deletingTable ? '削除中...' : '削除する'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })()}
    </AdminLayout>
  );
}
