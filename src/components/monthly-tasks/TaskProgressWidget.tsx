'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  getProgressWidget,
  batchToggleCheck,
  toggleCheck,
  type ProgressWidgetData,
  type ProgressWidgetTask,
  type CoursePrepWidgetTask,
  type SchoolTaskSummary,
} from '@/lib/api/monthlyTasks';
import { batchFetchCoursePrepApiMulti } from '@/lib/api/coursePrepApi';
import { getEnabledSchoolIdsForWidget } from '@/lib/api/widgetSettings';
import { loadSavedSeasonYear } from '@/lib/utils/coursePrepStorage';
import { whenNetworkIdle } from '@/lib/utils/networkIdle';
import type {
  Student,
  CourseProgressItem,
  StudentCourseProgress,
  SeasonType,
} from '@/types/database';
import { SEASON_LABELS } from '@/types/database';
import type { AutoValues } from '@/lib/api/courseProgress';
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  GraduationCap,
  ListTodo,
  Trophy,
} from 'lucide-react';
import Link from 'next/link';

function formatDate(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getMonth() + 1}/${d.getDate()}(${['日', '月', '火', '水', '木', '金', '土'][d.getDay()]})`;
}

function formatCoursePrepMessage(task: CoursePrepWidgetTask): string {
  const deadlineStr = task.deadline ? formatDate(task.deadline) : '';
  if (task.overdue) {
    return `講習準備：${task.name}（${deadlineStr}期限 - 期限超過）`;
  }
  return `講習準備：${task.name}を${deadlineStr}までに完了してください`;
}

const CELEBRATION_STYLE_ID = 'task-progress-celebration';
const CELEBRATION_CSS = `
@keyframes confetti-burst {
  0% { transform: translate(-50%, -50%) scale(0.96); opacity: 1; }
  60% { opacity: 1; }
  100% { transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) scale(1); opacity: 0; }
}
@keyframes badge-pop {
  0% { transform: scale(0.96) rotate(-12deg); opacity: 0; }
  60% { transform: scale(1.15) rotate(2deg); opacity: 1; }
  100% { transform: scale(1) rotate(0deg); opacity: 1; }
}
@keyframes bar-shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
@media (prefers-reduced-motion: reduce) {
  .confetti-particle { animation: none !important; opacity: 0 !important; }
  [style*="badge-pop"] { animation: none !important; transform: none !important; opacity: 1 !important; }
  [style*="bar-shimmer"] { animation: none !important; }
}
`;

const PARTICLE_COUNT = 24;

function CompletionParticles() {
  const particles = useRef(
    Array.from({ length: PARTICLE_COUNT }, (_, i) => {
      const angle = (i / PARTICLE_COUNT) * 360;
      const distance = 40 + Math.random() * 60;
      const dx = Math.cos((angle * Math.PI) / 180) * distance;
      const dy = Math.sin((angle * Math.PI) / 180) * distance - 20;
      const size = 3 + Math.random() * 4;
      const delay = Math.random() * 0.3;
      const colors = ['#22c55e', '#eab308', '#3b82f6', '#f97316', '#a855f7'];
      const color = colors[i % colors.length];
      return { dx, dy, size, delay, color };
    })
  ).current;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {particles.map((p, i) => (
        <span
          key={i}
          className="confetti-particle absolute left-1/2 top-1/2 rounded-full"
          style={
            {
              width: p.size,
              height: p.size,
              backgroundColor: p.color,
              '--dx': `${p.dx}px`,
              '--dy': `${p.dy}px`,
              animation: `confetti-burst 0.8s ease-out ${p.delay}s forwards`,
              opacity: 0,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

function TaskCheckbox({
  task,
  onComplete,
}: {
  task: ProgressWidgetTask;
  onComplete: (task: ProgressWidgetTask) => void;
}) {
  const [completing, setCompleting] = useState(false);

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (completing) return;
    setCompleting(true);
    onComplete(task);
    try {
      await batchToggleCheck(task.id, task.incompleteSchoolIds, true);
    } catch {
      // optimistic UI already applied — ignore since widget will refetch if needed
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={completing}
      className={`flex-shrink-0 w-4 h-4 rounded border transition-[background-color,border-color] duration-150 ease-out flex items-center justify-center ${
        completing
          ? 'bg-green-500 border-green-500'
          : task.overdue
            ? 'border-red-300 hover:border-red-500 hover:bg-red-50'
            : task.category === 'business'
              ? 'border-orange-300 hover:border-orange-500 hover:bg-orange-50'
              : 'border-purple-300 hover:border-purple-500 hover:bg-purple-50'
      }`}
      title="完了にする"
    >
      {completing && <Check className="w-3 h-3 text-white" />}
    </button>
  );
}

function findItemByKeywords(
  items: CourseProgressItem[],
  keywords: string[]
): CourseProgressItem | undefined {
  for (const kw of keywords) {
    const exact = items.find((i) => i.name === kw);
    if (exact) return exact;
  }
  for (const kw of keywords) {
    const partial = items.find((i) => i.name.includes(kw));
    if (partial) return partial;
  }
  return undefined;
}

interface SchoolInfo {
  id: string;
  name: string;
}

interface PerSchoolCourseData {
  schoolId: string;
  schoolName: string;
  students: Student[];
  items: CourseProgressItem[];
  progress: StudentCourseProgress[];
  autoValues: AutoValues;
}

export function TaskProgressWidget({
  schoolIds,
  schoolId,
  schools: schoolsProp,
}: {
  schoolIds?: string[];
  schoolId?: string;
  schools?: SchoolInfo[];
}) {
  const [data, setData] = useState<ProgressWidgetData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showCelebration, setShowCelebration] = useState(false);
  const [isOpen, setIsOpen] = useState(true);
  // 教室別ビューでの楽観的完了（`taskId:schoolId`）。チェック時に即座に消し、進捗率も更新する。
  const [doneKeys, setDoneKeys] = useState<Set<string>>(new Set());

  // --- Course progress state (per-school) ---
  const [perSchoolData, setPerSchoolData] = useState<PerSchoolCourseData[]>([]);
  const [cpLoading, setCpLoading] = useState(false);
  // 講習進捗サマリーを非表示にした教室のID集合（設定/settings/dashboard-widgets）。
  // 未取得の間は null（=全教室表示）としてちらつきを避ける。
  const [courseWidgetEnabledIds, setCourseWidgetEnabledIds] = useState<Set<string> | null>(null);
  const [season] = useState<SeasonType>(() => loadSavedSeasonYear().season);
  const [year] = useState(() => loadSavedSeasonYear().year);

  const isMultiSchool = schoolId === 'all' || (!schoolId && (schoolsProp?.length ?? 0) > 1);

  // Stabilize schoolIds reference to avoid infinite re-renders
  const schoolIdsKey = schoolIds?.slice().sort().join(',') ?? '';
  const stableSchoolIds = useMemo(() => schoolIds, [schoolIdsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!document.getElementById(CELEBRATION_STYLE_ID)) {
      const style = document.createElement('style');
      style.id = CELEBRATION_STYLE_ID;
      style.textContent = CELEBRATION_CSS;
      document.head.appendChild(style);
    }
    return () => {
      document.getElementById(CELEBRATION_STYLE_ID)?.remove();
    };
  }, []);

  const fetchData = useCallback(async () => {
    try {
      const result = await getProgressWidget(stableSchoolIds);
      setData(result);
      setDoneKeys(new Set()); // 最新データに合わせて楽観的完了をリセット
      if (result.allComplete) {
        setShowCelebration(true);
      }
    } catch {
      // non-critical
    } finally {
      setIsLoading(false);
    }
  }, [stableSchoolIds]);

  useEffect(() => {
    setIsLoading(true);
    fetchData();
  }, [fetchData]);

  // --- Course progress fetch (supports multi-school) ---
  const targetSchoolIds = useMemo(() => {
    if (isMultiSchool && schoolsProp) return schoolsProp.map((s) => s.id);
    if (schoolId && schoolId !== 'all') return [schoolId];
    return [];
  }, [isMultiSchool, schoolsProp, schoolId]);

  useEffect(() => {
    let cancelled = false;
    if (targetSchoolIds.length === 0) {
      setCourseWidgetEnabledIds(null);
      return;
    }
    getEnabledSchoolIdsForWidget(targetSchoolIds, 'course_progress_summary')
      .then((ids) => {
        if (!cancelled) setCourseWidgetEnabledIds(ids);
      })
      .catch(() => {
        if (!cancelled) setCourseWidgetEnabledIds(null);
      });
    return () => {
      cancelled = true;
    };
  }, [targetSchoolIds]);

  const schoolNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    if (schoolsProp)
      schoolsProp.forEach((s) => {
        map[s.id] = s.name;
      });
    return map;
  }, [schoolsProp]);

  const fetchCourseProgress = useCallback(async () => {
    if (targetSchoolIds.length === 0) return;
    setCpLoading(true);
    try {
      // 教室別の4本HTTPを1本（batch_get_multi）に統合。返り値は schoolId -> batchResult のマップ。
      const multi = await batchFetchCoursePrepApiMulti(
        { schoolIds: targetSchoolIds, season, year: String(year), includeHidden: 'false' },
        ['students', 'progress_items', 'student_progress', 'auto_values']
      );
      // 各 schoolId のエントリが従来の単一 result に相当するため、同じ形で組み立てる。
      const results = targetSchoolIds.map((sid) => {
        const result = (multi[sid] || {}) as Record<string, unknown>;
        const rawItems = (result.progress_items as Record<string, unknown>[]) || [];
        const rawProgress = (result.student_progress as Record<string, unknown>[]) || [];
        return {
          schoolId: sid,
          schoolName: schoolNameMap[sid] || sid,
          students: ((result.students as Record<string, unknown>[]) || []) as Student[],
          items: rawItems.map((item) => ({
            ...item,
            column_type: (item.column_type as string) || 'check',
            manager_only: item.manager_only === true,
            is_hidden: item.is_hidden === true,
            deadline: (item.deadline as string) || null,
            auto_source: (item.auto_source as string) || null,
          })) as CourseProgressItem[],
          progress: rawProgress.map((d) => ({
            ...d,
            number_value: d.number_value ?? null,
            date_value: d.date_value ?? null,
          })) as StudentCourseProgress[],
          autoValues: (result.auto_values || {}) as AutoValues,
        } as PerSchoolCourseData;
      });
      setPerSchoolData(results.filter((r) => r.items.length > 0));
    } catch {
      // non-critical
    } finally {
      setCpLoading(false);
    }
  }, [targetSchoolIds, season, year, schoolNameMap]);

  // 講習進捗は (教室数 × /api/courses/prep) で初期ロードの「DBリクエスト殺到」の主因。
  // 実測(2026-06-16): 単発なら 271ms のルートが、殺到時の接続プーラー競合で約9秒に膨張していた。
  // クリティカルな取得（Lightアラート/通知/掲示板）の群れが捌けてから取得を始めることで
  // ピーク同時実行数を下げ、結果的に全体を速くする。表示は自動ロードのまま（一段遅れて出る）。
  useEffect(() => {
    let cancelled = false;
    whenNetworkIdle().then(() => {
      if (!cancelled) fetchCourseProgress();
    });
    return () => {
      cancelled = true;
    };
  }, [fetchCourseProgress]);

  // 教室別ビューで1タスクをその教室だけ完了にする（バッチではなく単一教室）。
  const handleSchoolTaskComplete = useCallback((taskId: string, schoolId: string) => {
    const key = `${taskId}:${schoolId}`;
    setDoneKeys((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
    // 楽観的更新済み。失敗しても次回リフェッチで整合するため握りつぶす。
    toggleCheck(taskId, schoolId, true).catch(() => {});
  }, []);

  const handleComplete = useCallback((completed: ProgressWidgetTask) => {
    setData((prev) => {
      if (!prev) return prev;
      const remaining = prev.tasks.filter((t) => t.id !== completed.id);
      if (remaining.length === 0) {
        setShowCelebration(true);
        return { allComplete: true, tasks: [] };
      }
      return { ...prev, tasks: remaining };
    });
  }, []);

  // --- Course progress computed values (per-school) ---
  const computeSchoolMetrics = useCallback((sd: PerSchoolCourseData) => {
    const pcsItem = findItemByKeywords(sd.items, ['PCS回収', 'PCS']);
    const soudanItem = findItemByKeywords(sd.items, ['面談申込', '面談申し込み', '面談申込み']);
    const interviewItem = findItemByKeywords(sd.items, ['生徒面談実施', '生徒面談', '面談実施']);
    const parentInterviewItem = findItemByKeywords(sd.items, [
      '父母面談実施',
      '父母面談',
      '保護者面談実施',
      '保護者面談',
    ]);
    const subjectItems = sd.items.filter(
      (i) => i.column_group === '教科別' && i.column_type === 'number'
    );

    const countCompleted = (item: CourseProgressItem | undefined) => {
      if (!item) return null;
      let completed = 0;
      for (const s of sd.students) {
        const d = sd.progress.find((p) => p.student_id === s.id && p.item_id === item.id);
        if (d?.status === 'completed') completed++;
      }
      return { completed, total: sd.students.length };
    };

    const pcsStats = countCompleted(pcsItem);
    const soudanStats = countCompleted(soudanItem);
    const interviewStats = countCompleted(interviewItem);
    const parentInterviewStats = countCompleted(parentInterviewItem);
    const interviewRate =
      parentInterviewStats && parentInterviewStats.total > 0
        ? Math.round((parentInterviewStats.completed / parentInterviewStats.total) * 100)
        : 0;

    // Subject totals
    const subjectTotals: { name: string; total: number }[] = [];
    let grandTotal = 0;
    for (const item of subjectItems) {
      let sum = 0;
      for (const s of sd.students) {
        if (item.auto_source === 'subject_proposal') {
          const sv = sd.autoValues[s.id];
          if (sv?.subject_proposals) {
            if (sv.subject_proposals[item.name] !== undefined)
              sum += sv.subject_proposals[item.name];
            else {
              for (const [subject, count] of Object.entries(sv.subject_proposals)) {
                if (item.name.includes(subject)) {
                  sum += count;
                  break;
                }
              }
            }
          }
        } else {
          const d = sd.progress.find((p) => p.student_id === s.id && p.item_id === item.id);
          if (d?.number_value != null) sum += d.number_value;
        }
      }
      if (sum > 0) subjectTotals.push({ name: item.name, total: sum });
      grandTotal += sum;
    }

    // Koma stats
    const proposedKomaItem =
      sd.items.find((i) => i.auto_source === 'proposed_extra') ||
      findItemByKeywords(sd.items, ['提案増コマ', '提示増コマ']);
    const decidedKomaItem =
      sd.items.find((i) => i.id !== proposedKomaItem?.id && i.auto_source === 'applied_extra') ||
      sd.items.find(
        (i) =>
          i.id !== proposedKomaItem?.id &&
          i.column_type === 'number' &&
          (i.name.includes('増コマ回数') || i.name === '増コマ回数決定')
      ) ||
      findItemByKeywords(
        sd.items.filter((i) => i.id !== proposedKomaItem?.id),
        ['増コマ回数決定', '増コマ決定', '決定コマ', '増コマ回数']
      );

    let totalProposed = 0,
      totalDecided = 0;
    for (const s of sd.students) {
      if (proposedKomaItem) {
        if (proposedKomaItem.auto_source === 'proposed_extra') {
          const sv = sd.autoValues[s.id];
          const proposalTotal = sv?.proposal_total ?? 0;
          const courseSessions = sv?.course_sessions ?? 0;
          totalProposed += Math.max(0, proposalTotal - courseSessions);
        } else {
          const d = sd.progress.find(
            (p) => p.student_id === s.id && p.item_id === proposedKomaItem.id
          );
          totalProposed += d?.number_value ?? 0;
        }
      }
      if (decidedKomaItem) {
        if (decidedKomaItem.auto_source === 'applied_extra') {
          const sv = sd.autoValues[s.id];
          const appliedTotal = sv?.applied_total ?? 0;
          const courseSessions = sv?.course_sessions ?? 0;
          totalDecided += Math.max(0, appliedTotal - courseSessions);
        } else {
          const d = sd.progress.find(
            (p) => p.student_id === s.id && p.item_id === decidedKomaItem.id
          );
          totalDecided += d?.number_value ?? 0;
        }
      }
    }

    const hasData = !!(
      pcsStats ||
      soudanStats ||
      interviewStats ||
      parentInterviewStats ||
      grandTotal > 0 ||
      totalProposed > 0 ||
      totalDecided > 0
    );
    return {
      schoolId: sd.schoolId,
      schoolName: sd.schoolName,
      pcsStats,
      soudanStats,
      interviewStats,
      parentInterviewStats,
      interviewRate,
      subjectTotals: { subjects: subjectTotals, grandTotal },
      komaStats: { proposed: totalProposed, decided: totalDecided },
      hasData,
    };
  }, []);

  const allSchoolMetrics = useMemo(() => {
    const metrics = perSchoolData.map(computeSchoolMetrics).filter((m) => m.hasData);
    if (!courseWidgetEnabledIds) return metrics;
    return metrics.filter((m) => courseWidgetEnabledIds.has(m.schoolId));
  }, [perSchoolData, computeSchoolMetrics, courseWidgetEnabledIds]);

  const hasCourseData = !cpLoading && allSchoolMetrics.length > 0;
  const seasonLabel = SEASON_LABELS[season];

  if (isLoading) {
    return (
      <div className="mb-4 rounded-xl border border-border bg-surface p-4">
        <div className="h-10 animate-pulse rounded bg-surface-hover" />
      </div>
    );
  }

  if (!data) return null;

  const now = new Date();
  const monthLabel = `${now.getMonth() + 1}月`;

  const courseProgressSection = hasCourseData ? (
    <div className="px-4 py-3 border-t border-border-subtle">
      <div className="flex items-center gap-2 mb-2">
        <GraduationCap className="w-3.5 h-3.5 text-indigo-500" />
        <span className="text-xs font-bold text-text-muted">講習進捗</span>
        <span className="text-xs text-text-faint">
          {year}年 {seasonLabel}
        </span>
        <Link
          href="/courses/progress"
          className="ml-auto flex items-center gap-0.5 text-xs text-blue-500 hover:text-blue-700 font-medium transition-[color] duration-150 ease-out"
        >
          詳細
          <ArrowRight className="w-3 h-3" />
        </Link>
      </div>
      {allSchoolMetrics.map((m, idx) => (
        <div
          key={m.schoolId}
          className={idx > 0 ? 'mt-2.5 pt-2.5 border-t border-border-subtle' : ''}
        >
          {allSchoolMetrics.length > 1 && (
            <div className="text-xs font-bold text-text-muted mb-1.5">{m.schoolName}</div>
          )}
          <div className="flex flex-wrap gap-2">
            {m.pcsStats && (
              <CourseMetricChip
                label="PCS回収"
                value={m.pcsStats.completed}
                total={m.pcsStats.total}
                color="blue"
              />
            )}
            {m.soudanStats && (
              <CourseMetricChip
                label="面談申込"
                value={m.soudanStats.completed}
                total={m.soudanStats.total}
                color="amber"
              />
            )}
            {m.interviewStats && (
              <CourseMetricChip
                label="生徒面談"
                value={m.interviewStats.completed}
                total={m.interviewStats.total}
                color="green"
              />
            )}
            {m.parentInterviewStats && (
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 text-xs">
                <span className="text-emerald-600 font-medium">面談実施率</span>
                <span className="text-emerald-800 font-bold">{m.interviewRate}%</span>
              </div>
            )}
            {(m.komaStats.proposed > 0 || m.komaStats.decided > 0) && (
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-purple-200 bg-purple-50 text-xs">
                <span className="text-purple-600 font-medium">増コマ</span>
                <span className="text-purple-800 font-bold">{m.komaStats.decided}</span>
                <span className="text-purple-400">/</span>
                <span className="text-purple-600">{m.komaStats.proposed}</span>
              </div>
            )}
          </div>
          {m.subjectTotals.subjects.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-text-faint mr-0.5">提案コマ:</span>
              {m.subjectTotals.subjects.map((s) => (
                <span
                  key={s.name}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-border bg-surface-hover text-xs"
                >
                  <span className="text-text-muted">{s.name}</span>
                  <span className="text-text-heading font-bold">{s.total}</span>
                </span>
              ))}
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-indigo-200 bg-indigo-50 text-xs">
                <span className="text-indigo-600 font-medium">合計</span>
                <span className="text-indigo-800 font-bold">{m.subjectTotals.grandTotal}</span>
              </span>
            </div>
          )}
        </div>
      ))}
    </div>
  ) : null;

  if (data.allComplete) {
    return (
      <div className="relative mb-4 rounded-xl border border-green-300 bg-gradient-to-r from-green-50 via-emerald-50 to-green-50 shadow-sm overflow-hidden">
        {showCelebration && <CompletionParticles />}
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <span
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-600 text-white text-xs font-bold"
              style={{ animation: 'badge-pop 0.5s ease-out 0.2s both' }}
            >
              <Trophy className="w-3.5 h-3.5" />
              {monthLabel}の業務 全完了
            </span>
          </div>
          <Link
            href="/tasks"
            className="flex items-center gap-1 text-xs text-green-700 hover:text-green-900 font-medium transition-[color] duration-150 ease-out"
          >
            業務進捗を見る
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
        {courseProgressSection}
        <div
          className="h-1"
          style={{
            background:
              'linear-gradient(90deg, #22c55e 0%, #4ade80 40%, #86efac 50%, #4ade80 60%, #22c55e 100%)',
            backgroundSize: '200% 100%',
            animation: 'bar-shimmer 2s linear infinite',
          }}
        />
      </div>
    );
  }

  const overdueTasks = data.tasks.filter((t) => t.overdue);
  const upcomingTasks = data.tasks.filter((t) => !t.overdue);

  // 「すべての教室」表示かつ複数教室分のサマリーがある場合は、教室別の進捗率＋未完了業務を出す。
  // 単一教室ではどの教室か自明なので従来のフラットなタスクチップ表示のままにする。
  const showPerSchool =
    isMultiSchool && !!data.schoolSummaries && data.schoolSummaries.length > 1;

  const flatTaskSection = (
    <div className="px-4 py-2.5 flex flex-wrap gap-1.5 border-t border-border-subtle">
      {overdueTasks.map((task) => (
        <span
          key={task.id}
          className="inline-flex items-center gap-1 px-2 py-1 rounded border border-red-200 bg-red-50 text-xs"
        >
          <TaskCheckbox task={task} onComplete={handleComplete} />
          <AlertTriangle className="w-3 h-3 text-red-500 flex-shrink-0" />
          <span className="font-medium text-red-600">{formatDate(task.task_date)}</span>
          <span className="text-red-700 max-w-[120px] truncate">{task.task_name}</span>
        </span>
      ))}
      {upcomingTasks.map((task) => (
        <span
          key={task.id}
          className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs border ${
            task.category === 'business'
              ? 'bg-orange-50 border-orange-200 text-orange-700'
              : 'bg-purple-50 border-purple-200 text-purple-700'
          }`}
        >
          <TaskCheckbox task={task} onComplete={handleComplete} />
          <span className="font-medium">{formatDate(task.task_date)}</span>
          <span className="max-w-[120px] truncate">{task.task_name}</span>
        </span>
      ))}
    </div>
  );

  const perSchoolTaskSection = (
    <div className="px-4 py-2.5 border-t border-border-subtle">
      {(data.schoolSummaries ?? []).map((summary, idx) => (
        <div
          key={summary.schoolId}
          className={idx > 0 ? 'mt-2 pt-2 border-t border-border-subtle' : ''}
        >
          <SchoolTaskRow
            summary={summary}
            schoolName={schoolNameMap[summary.schoolId] || summary.schoolId}
            doneKeys={doneKeys}
            onComplete={handleSchoolTaskComplete}
          />
        </div>
      ))}
    </div>
  );

  const businessTaskSection = showPerSchool ? perSchoolTaskSection : flatTaskSection;

  return (
    <div className="mb-4 rounded-xl border border-border bg-surface shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2">
        <button
          onClick={() => setIsOpen((v) => !v)}
          className="flex items-center gap-2 hover:opacity-70 transition-opacity"
        >
          <ChevronDown
            className={`w-4 h-4 text-text-faint transition-transform duration-200 ${isOpen ? '' : '-rotate-90'}`}
          />
          <ListTodo className="w-4 h-4 text-text-muted" />
          <span className="text-sm font-bold text-text-body">業務進捗</span>
          <span className="text-xs text-text-faint">{monthLabel}</span>
          <span className="text-xs text-text-faint">残 {data.tasks.length}件</span>
        </button>
        <Link
          href="/tasks"
          className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium transition-[color] duration-150 ease-out"
        >
          詳細を見る
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>

      {/* Collapsible content */}
      <div
        className="overflow-hidden transition-[max-height,opacity] duration-200 ease-out"
        style={{ maxHeight: isOpen ? '2000px' : '0', opacity: isOpen ? 1 : 0 }}
      >
        {/* 業務タスク（単一教室=フラット / すべての教室=教室別の進捗率＋未完了） */}
        {businessTaskSection}
        {/* 講習準備タスク */}
        {data.coursePrepTasks && data.coursePrepTasks.length > 0 && (
          <div className="px-4 py-2 border-t border-border-subtle space-y-1">
            {data.coursePrepTasks.map((ct) => (
              <div
                key={ct.id}
                className={`flex items-start gap-2 text-xs leading-relaxed ${
                  ct.overdue ? 'text-red-600' : 'text-blue-700'
                }`}
              >
                <BookOpen
                  className={`w-3 h-3 mt-0.5 flex-shrink-0 ${ct.overdue ? 'text-red-400' : 'text-blue-400'}`}
                />
                <span>{formatCoursePrepMessage(ct)}</span>
              </div>
            ))}
          </div>
        )}

        {/* 講習進捗 */}
        {courseProgressSection}
      </div>
    </div>
  );
}

/** 教室別ビューの1タスク用チェックボックス（その教室だけ完了にする） */
function SchoolTaskCheckbox({
  overdue,
  onComplete,
}: {
  overdue: boolean;
  onComplete: () => void;
}) {
  const [completing, setCompleting] = useState(false);
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (completing) return;
    setCompleting(true);
    onComplete();
  };
  return (
    <button
      onClick={handleClick}
      disabled={completing}
      className={`flex-shrink-0 w-4 h-4 rounded border transition-[background-color,border-color] duration-150 ease-out flex items-center justify-center ${
        completing
          ? 'bg-green-500 border-green-500'
          : overdue
            ? 'border-red-300 hover:border-red-500 hover:bg-red-50'
            : 'border-orange-300 hover:border-orange-500 hover:bg-orange-50'
      }`}
      title="この教室で完了にする"
    >
      {completing && <Check className="w-3 h-3 text-white" />}
    </button>
  );
}

/** 教室ごとの当月業務タスクの進捗率＋未完了タスクを表示する行 */
function SchoolTaskRow({
  summary,
  schoolName,
  doneKeys,
  onComplete,
}: {
  summary: SchoolTaskSummary;
  schoolName: string;
  doneKeys: Set<string>;
  onComplete: (taskId: string, schoolId: string) => void;
}) {
  // 楽観的完了を差し引いた残りの未完了タスク（進捗率はこの全体を母数にする）
  const remaining = summary.incompleteTasks.filter(
    (t) => !doneKeys.has(`${t.id}:${summary.schoolId}`)
  );
  // 一覧に出すのは「期限を過ぎた未完了タスク」だけ（未来日のタスクはノイズなので出さない）
  const overdueRemaining = remaining.filter((t) => t.overdue);
  const completed = summary.total - remaining.length;
  const pct = summary.total > 0 ? Math.round((completed / summary.total) * 100) : null;
  const allDone = remaining.length === 0;

  return (
    // 講習進捗セクションと揃えて、進捗バーの右隣に残りの期限超過タスクを並べる。
    // 教室名 → 件数 → % → バー（左の固定クラスタ）／その右にタスクチップ。
    <div className="flex items-start gap-x-3 gap-y-1.5 flex-wrap">
      {/* 左クラスタ: 名前 + 件数 + % + バー（列幅を固定して各教室で桁を揃える） */}
      <div className="flex items-center gap-2 shrink-0">
        <span className="w-24 shrink-0 text-xs font-bold text-text-muted truncate">
          {schoolName}
        </span>
        {pct === null ? (
          <span className="text-xs text-text-faint">対象タスクなし</span>
        ) : (
          <>
            <span className="w-12 shrink-0 text-xs text-text-muted tabular-nums text-right">
              {completed}/{summary.total}
            </span>
            <span
              className={`w-9 shrink-0 text-xs font-bold tabular-nums text-right ${allDone ? 'text-green-600' : 'text-text-body'}`}
            >
              {pct}%
            </span>
            <div className="h-1.5 w-28 shrink-0 rounded-full bg-surface-hover overflow-hidden">
              <div
                className={`h-full rounded-full transition-[width] duration-300 ease-out ${allDone ? 'bg-green-500' : 'bg-blue-500'}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </>
        )}
      </div>

      {/* 右: 期限超過の未完了タスク（バーの横に並べる）。完了済みなら✓、超過なしは静かに畳む */}
      {allDone ? (
        summary.total > 0 && (
          <div className="flex items-center gap-1 text-xs text-green-600 pt-0.5">
            <Check className="w-3 h-3" />
            <span>すべて完了</span>
          </div>
        )
      ) : overdueRemaining.length > 0 ? (
        <div className="flex flex-1 flex-wrap gap-1.5 min-w-0">
          {overdueRemaining.map((t, idx) => (
            <span
              key={`${t.id}-${idx}`}
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs border bg-red-50 border-red-200 text-red-700"
            >
              <SchoolTaskCheckbox overdue onComplete={() => onComplete(t.id, summary.schoolId)} />
              <AlertTriangle className="w-3 h-3 text-red-500 flex-shrink-0" />
              <span className="font-medium">{formatDate(t.task_date)}</span>
              <span className="max-w-[140px] truncate">{t.task_name}</span>
            </span>
          ))}
        </div>
      ) : (
        <span className="text-xs text-text-faint pt-1">期限超過なし</span>
      )}
    </div>
  );
}

function CourseMetricChip({
  label,
  value,
  total,
  color,
}: {
  label: string;
  value: number;
  total: number;
  color: 'blue' | 'amber' | 'green';
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  const colors = {
    blue: {
      border: 'border-blue-200',
      bg: 'bg-blue-50',
      label: 'text-blue-600',
      value: 'text-blue-800',
      sub: 'text-blue-400',
    },
    amber: {
      border: 'border-amber-200',
      bg: 'bg-amber-50',
      label: 'text-amber-600',
      value: 'text-amber-800',
      sub: 'text-amber-400',
    },
    green: {
      border: 'border-green-200',
      bg: 'bg-green-50',
      label: 'text-green-600',
      value: 'text-green-800',
      sub: 'text-green-400',
    },
  }[color];
  return (
    <div
      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border ${colors.border} ${colors.bg} text-xs`}
    >
      <span className={`${colors.label} font-medium`}>{label}</span>
      <span className={`${colors.value} font-bold`}>{value}</span>
      <span className={colors.sub}>/</span>
      <span className={colors.label}>{total}</span>
      <span className={`${colors.sub} text-xs`}>({pct}%)</span>
    </div>
  );
}
