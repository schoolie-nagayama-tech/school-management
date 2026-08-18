'use client';

/**
 * 教室長ダッシュボード モック（検討用）
 * ------------------------------------------------------------------
 * docs/classroom-manager-dashboard-draft.md の構成を、すべてダミーデータで可視化したもの。
 * レイアウト・指標の見せ方を目で確認するための叩き台であり、本番ロジックは未接続。
 * 「業務系（日々さばく）」を上段、「経営系（傾向を見る）」を下段に置く2層構成。
 * 検討OKなら本番ルート /home へ昇格し、ダミーを実データ取得に差し替える。
 */

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useMasterData } from '@/contexts/MasterDataContext';
import { getOverview, type Overview } from '@/lib/api/overview';
import dynamic from 'next/dynamic';
import { batchFetchCoursePrepApi, batchFetchCoursePrepApiMulti } from '@/lib/api/coursePrepApi';
import { computeSchoolKpis } from '@/lib/coursePrepKpis';
import type { SchoolOverviewRow } from '@/components/course-progress';
import { loadSavedSeasonYear } from '@/lib/utils/coursePrepStorage';
import { getSchoolMonthlyMetrics, type MonthlyMetricPoint } from '@/lib/api/schoolMetrics';
import { getAlertsLight, getAlertsHeavy, mergeStudentAlerts } from '@/lib/api/alerts';
import { ALERT_TYPE_LABELS, type Alert, type StudentAlerts } from '@/types/alerts';
import { getStudents, type EnrichedStudent } from '@/lib/api/students';
import { getRecentUnprocessedResponses } from '@/lib/api/form-responses';
import { getBulletinPosts } from '@/lib/api/bulletin';
import type { BulletinPost } from '@/types/bulletin';
import { getScheduleEntries } from '@/lib/api/schedule';
import { getHomeworkTardyCounts, type HomeworkTardyCounts } from '@/lib/api/progress-sessions';
import {
  getFormParticipation,
  getProposalFunnel,
  type FormParticipation,
  type ProposalFunnel,
} from '@/lib/api/dashboardForms';
import { GRADE_LABELS } from '@/types/database';
import type {
  Student,
  CourseProgressItem,
  StudentCourseProgress,
  CoursePrepPeriod,
} from '@/types/database';
import type { AutoValues } from '@/lib/api/courseProgress';
import { AdminLayout } from '@/components/layouts';
import { Card, CardContent, CardHeader, CardTitle, Loading } from '@/components/ui';
import AccessDenied from '@/components/AccessDenied';
import { isSystemAdmin } from '@/lib/utils/roles';
import {
  Inbox,
  CalendarDays,
  AlertTriangle,
  Users,
  FileText,
  Repeat,
  Clock,
  MessageSquare,
  TrendingUp,
  TrendingDown,
  Target,
  GraduationCap,
  School,
  CheckCircle2,
  ChevronRight,
  Flag,
  Circle,
  CalendarPlus,
  ClipboardList,
  Pin,
  ListTodo,
  History,
} from 'lucide-react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Cell,
} from 'recharts';

// 講習進捗「すべての教室」カード（/courses/progress と同じコンポーネント。重いので遅延ロード）
const AllSchoolsOverview = dynamic(
  () => import('@/components/course-progress').then((m) => m.AllSchoolsOverview),
  { ssr: false, loading: () => <div className="h-44 animate-pulse rounded-xl bg-surface" /> }
);

// 個別校の講習進捗ダッシュボード（読み取り専用で使う。重いので遅延ロード）
const CourseProgressDashboard = dynamic(
  () => import('@/components/course-progress').then((m) => m.CourseProgressDashboard),
  { ssr: false, loading: () => <div className="h-44 animate-pulse rounded-xl bg-surface" /> }
);

// 業務進捗（今月の月次タスク）ウィジェット。schoolIds を渡すだけで自前取得＋達成演出
const TaskProgressWidget = dynamic(
  () => import('@/components/monthly-tasks/TaskProgressWidget').then((m) => m.TaskProgressWidget),
  { ssr: false, loading: () => <div className="h-44 animate-pulse rounded-xl bg-surface" /> }
);

// 最近の動き（活動フィード）。/students 上部の通知フィードを移植。自前取得・props不要
const NotificationFeed = dynamic(
  () => import('@/components/notifications/NotificationFeed').then((m) => m.NotificationFeed),
  { ssr: false, loading: () => <div className="h-48 animate-pulse rounded-xl bg-surface" /> }
);

// 外部ツールへのクイックリンク（Grow/らくプリ等）。/students 上部から移植
const QuickLinksBar = dynamic(
  () => import('@/components/quick-links/QuickLinksBar').then((m) => m.QuickLinksBar),
  { ssr: false }
);

/* ============================================================
 * ダミーデータ（本番では API 取得に差し替え）
 * ========================================================== */

// タスク種別 → ラベル・アイコン・色（tone は TONE マップのキー）
const TASK_TYPES: Record<
  string,
  {
    label: string;
    icon: React.ElementType;
    tone: 'danger' | 'warning' | 'info' | 'primary' | 'neutral';
  }
> = {
  apply: { label: '申込', icon: FileText, tone: 'danger' },
  transfer: { label: '振替', icon: Repeat, tone: 'warning' },
  koushu: { label: '講習', icon: CalendarDays, tone: 'info' },
  interview: { label: '面談', icon: MessageSquare, tone: 'info' },
  alert: { label: 'フォロー', icon: AlertTriangle, tone: 'warning' },
  procedure: { label: '手続き', icon: ClipboardList, tone: 'neutral' },
};

// 期日グループ（カレンダーに入れる優先度の帯）。この順で上から表示する
const DUE_GROUPS = [
  { key: 'overdue', label: '期限超過', tone: 'danger' as const },
  { key: 'thisWeek', label: '今週', tone: 'warning' as const },
  { key: 'nextWeek', label: '来週', tone: 'info' as const },
  { key: 'later', label: 'それ以降', tone: 'primary' as const },
];

// 今日基準で期日帯の日付レンジ表示を作る。
// 旧モックは固定日付（〜6/13 等）だったため今週/来週帯が実日付とズレ、「超過しか出ない」ように見えていた。
function dueGroupHint(key: string): string {
  const today = new Date();
  const md = (offset: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() + offset);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };
  if (key === 'overdue') return '対応を急ぐ';
  if (key === 'thisWeek') return `〜${md(6)}`;
  if (key === 'nextWeek') return `${md(7)}〜${md(13)}`;
  return `${md(14)}〜`;
}

// [A] KPI サマリーカード
const KPIS = [
  {
    key: 'pending',
    label: '未処理の申込',
    value: 5,
    unit: '件',
    icon: Inbox,
    tone: 'danger' as const,
    sub: '要さばき',
  },
  {
    key: 'today',
    label: '本日の授業',
    value: 24,
    unit: 'コマ',
    icon: CalendarDays,
    tone: 'info' as const,
    sub: '出欠未入力 6',
  },
  {
    key: 'alert',
    label: '要対応アラート',
    value: 7,
    unit: '件',
    icon: AlertTriangle,
    tone: 'warning' as const,
    sub: '成績・面談',
  },
  {
    key: 'students',
    label: '在籍生徒数',
    value: 123,
    unit: '名',
    icon: Users,
    tone: 'primary' as const,
    sub: '前月比 +3',
  },
];

// 在籍数トレンド（今年 vs 昨年）— 昨対比
const ENROLLMENT_TREND = [
  { month: '7月', thisYear: 104, lastYear: 98 },
  { month: '8月', thisYear: 106, lastYear: 99 },
  { month: '9月', thisYear: 110, lastYear: 103 },
  { month: '10月', thisYear: 113, lastYear: 105 },
  { month: '11月', thisYear: 115, lastYear: 107 },
  { month: '12月', thisYear: 116, lastYear: 108 },
  { month: '1月', thisYear: 118, lastYear: 109 },
  { month: '2月', thisYear: 119, lastYear: 110 },
  { month: '3月', thisYear: 114, lastYear: 106 },
  { month: '4月', thisYear: 120, lastYear: 109 },
  { month: '5月', thisYear: 122, lastYear: 111 },
  { month: '6月', thisYear: 123, lastYear: 112 },
];

// 増減ウォーターフォール：月初 +入会 −退会 ±休復 = 月末
// range=[start,end] の floating bar で増減を表現
const WATERFALL = [
  { name: '月初在籍', range: [0, 118], delta: '118', kind: 'total' as const },
  { name: '新規入会', range: [118, 126], delta: '+8', kind: 'up' as const },
  { name: '退会', range: [121, 126], delta: '−5', kind: 'down' as const },
  { name: '休会復帰', range: [121, 123], delta: '+2', kind: 'up' as const },
  { name: '月末在籍', range: [0, 123], delta: '123', kind: 'total' as const },
];

// 退会率・継続率・着地見込み
const CHURN = { churnRate: 4.1, retentionRate: 95.9, forecast: 128 };

// 在籍目標（予実）。target は取り込み or 手入力で用意する想定
const TARGET = { current: 123, target: 130 };

// 学年構成
const GRADE_DIST = [
  { grade: '小4', count: 6, cat: 'elem' },
  { grade: '小5', count: 9, cat: 'elem' },
  { grade: '小6', count: 12, cat: 'elem' },
  { grade: '中1', count: 18, cat: 'mid' },
  { grade: '中2', count: 21, cat: 'mid' },
  { grade: '中3', count: 28, cat: 'mid' },
  { grade: '高1', count: 11, cat: 'high' },
  { grade: '高2', count: 9, cat: 'high' },
  { grade: '高3', count: 9, cat: 'high' },
];

// 通学校別ランキング（上位）
const SCHOOL_DIST = [
  { name: '第一中学校', count: 22 },
  { name: '中央中学校', count: 18 },
  { name: '東高等学校', count: 14 },
  { name: '西小学校', count: 11 },
  { name: '南中学校', count: 9 },
];

// 平均週回数の分布
const WEEKLY_DIST = [
  { times: '週1', count: 28 },
  { times: '週2', count: 41 },
  { times: '週3', count: 33 },
  { times: '週4', count: 14 },
  { times: '週5+', count: 7 },
];

/* ============================================================
 * カラー（recharts は CSS 変数でなく hex で固定）
 * ========================================================== */
const C = {
  primary: '#2563eb',
  slate: '#94a3b8',
  green: '#22c55e',
  red: '#ef4444',
  amber: '#f59e0b',
  blue: '#3b82f6',
  ink: '#1e3a5f',
};

// tone → Tailwind クラス対応
// borderL はカード左端のアクセントバー（border-l-4 と併用）。tone の視覚的な帰属を一目で示す
const TONE: Record<string, { text: string; bg: string; bar: string; borderL: string }> = {
  danger: {
    text: 'text-danger',
    bg: 'bg-danger-subtle',
    bar: 'bg-danger',
    borderL: 'border-l-danger',
  },
  warning: {
    text: 'text-warning',
    bg: 'bg-warning-subtle',
    bar: 'bg-warning',
    borderL: 'border-l-warning',
  },
  info: { text: 'text-info', bg: 'bg-info-subtle', bar: 'bg-info', borderL: 'border-l-info' },
  primary: {
    text: 'text-primary',
    bg: 'bg-primary-subtle',
    bar: 'bg-primary',
    borderL: 'border-l-primary',
  },
  neutral: {
    text: 'text-text-muted',
    bg: 'bg-surface-hover',
    bar: 'bg-text-muted',
    borderL: 'border-l-border',
  },
};

/* ============================================================
 * 小コンポーネント
 * ========================================================== */

// セクション見出し（right に件数バッジ等を置ける。全セクションで見出し様式を統一する）
function SectionLabel({
  icon: Icon,
  children,
  right,
}: {
  icon: React.ElementType;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 mt-8 mb-3">
      <Icon className="w-5 h-5 text-text-muted" />
      <h2 className="text-base font-bold text-text-heading">{children}</h2>
      {right && <div className="ml-auto shrink-0">{right}</div>}
    </div>
  );
}

// 小さな統計表示
// invert=true のときは「上昇が悪い指標」（例：退会率）として矢印の色を反転する
function MiniStat({
  label,
  value,
  hint,
  trend,
  invert,
}: {
  label: string;
  value: string;
  hint?: string;
  trend?: 'up' | 'down';
  invert?: boolean;
}) {
  const upColor = invert ? 'text-danger' : 'text-success';
  const downColor = invert ? 'text-success' : 'text-danger';
  return (
    <div className="flex-1 min-w-[120px]">
      <div className="text-xs text-text-muted">{label}</div>
      <div className="flex items-center gap-1.5 mt-1">
        <span className="text-2xl font-bold text-text-heading">{value}</span>
        {trend === 'up' && <TrendingUp className={`w-4 h-4 ${upColor}`} />}
        {trend === 'down' && <TrendingDown className={`w-4 h-4 ${downColor}`} />}
      </div>
      {hint && <div className="text-xs text-text-faint mt-0.5">{hint}</div>}
    </div>
  );
}

/* ============================================================
 * 実データ（school_monthly_metrics）→ 経営指標の構築
 * 在籍トレンド(昨対)・増減ウォーターフォール・予実・退会率を組み立てる。
 * データが無いブロックは上のダミー定数にフォールバックする。
 * ========================================================== */

const MONTH_LABELS = [
  '1月',
  '2月',
  '3月',
  '4月',
  '5月',
  '6月',
  '7月',
  '8月',
  '9月',
  '10月',
  '11月',
  '12月',
];

// アラートの重要度ソート順と色（danger > warning > info）
const SEVERITY_RANK: Record<string, number> = { danger: 0, warning: 1, info: 2 };
// アラート種別の表示優先度（小さいほど重要。成績低下を最優先、講習準備など定型大量系は最後）
const TYPE_PRIORITY: Record<string, number> = {
  score_drop: 0,
  schedule_change_unapplied: 1,
  interview_overdue: 2,
  application_overdue: 3,
  exam_overdue: 4,
  homework_not_done: 5,
  tardy: 6,
  interview_task: 7,
  score_missing: 8,
  course_prep_overdue: 9,
};

interface BuiltMetrics {
  trend: { month: string; thisYear: number | null; lastYear: number | null }[];
  waterfall: { name: string; range: number[]; delta: string; kind: string }[];
  target: { current: number; target: number };
  churn: { churnRate: number; retentionRate: number; forecast: number };
}

function buildMetrics(metrics: MonthlyMetricPoint[], thisYear: number): BuiltMetrics {
  const actualThis = metrics
    .filter((m) => m.kind === 'actual' && m.year === thisYear)
    .sort((a, b) => a.month - b.month);
  const actualPrev = metrics.filter((m) => m.kind === 'actual' && m.year === thisYear - 1);
  const budgetThis = metrics.filter((m) => m.kind === 'budget' && m.year === thisYear);

  // 在籍トレンド（今年 実績 vs 昨年 実績）。データの無い月は null（線が途切れる）
  const trend = MONTH_LABELS.map((label, i) => {
    const mo = i + 1;
    const c = actualThis.find((m) => m.month === mo);
    const p = actualPrev.find((m) => m.month === mo);
    return { month: label, thisYear: c?.activeCount ?? null, lastYear: p?.activeCount ?? null };
  });

  // 以下は最新の実績月が必要。無ければダミー定数にフォールバック
  let waterfall: BuiltMetrics['waterfall'] = WATERFALL;
  let target: BuiltMetrics['target'] = TARGET;
  let churn: BuiltMetrics['churn'] = CHURN;

  const last = actualThis[actualThis.length - 1];
  if (last) {
    // 前月末在籍（無ければ 月末−入会+休会 で逆算）
    const prevActive =
      actualThis.length >= 2
        ? actualThis[actualThis.length - 2].activeCount
        : last.activeCount - last.newCount + last.leaveCount;
    const afterNew = prevActive + last.newCount;
    const prevMonthLabel = last.month - 1 >= 1 ? `${last.month - 1}月末` : '前月末';
    waterfall = [
      { name: prevMonthLabel, range: [0, prevActive], delta: String(prevActive), kind: 'total' },
      { name: '入会', range: [prevActive, afterNew], delta: `+${last.newCount}`, kind: 'up' },
      {
        name: '休会',
        range: [afterNew - last.leaveCount, afterNew],
        delta: `−${last.leaveCount}`,
        kind: 'down',
      },
      {
        name: `${last.month}月末`,
        range: [0, last.activeCount],
        delta: String(last.activeCount),
        kind: 'total',
      },
    ];

    // 予実（最新実績月の在籍 vs 同月予算）
    const b = budgetThis.find((m) => m.month === last.month);
    target = { current: last.activeCount, target: b?.activeCount ?? last.activeCount };

    // 退会率（最新月の休会 / 前月在籍）＋ 直近3ヶ月の純増ペースで期末を外挿
    const churnRate = prevActive > 0 ? Math.round((last.leaveCount / prevActive) * 1000) / 10 : 0;
    const recent = actualThis.slice(-3);
    const avgNet = recent.reduce((s, m) => s + (m.newCount - m.leaveCount), 0) / recent.length;
    const forecast = Math.round(last.activeCount + avgNet * (12 - last.month));
    churn = { churnRate, retentionRate: Math.round((100 - churnRate) * 10) / 10, forecast };
  }

  return { trend, waterfall, target, churn };
}

/* ============================================================
 * 実データ（getStudents）→ 経営スナップショット（学年/通学校/週回数）
 * 在籍中の生徒のみを対象に集計。データが無いブロックはダミー定数にフォールバック。
 * ========================================================== */

// 学年(1-13) → 小中高の区分（students.ts の getGradeCategory は private なので再実装）
function gradeCategory(grade: number): 'elem' | 'mid' | 'high' {
  if (grade <= 6) return 'elem';
  if (grade <= 9) return 'mid';
  return 'high';
}

// 学年構成（学年順・小中高で色分け）
function buildGradeDist(students: EnrichedStudent[]) {
  const counts = new Map<number, number>();
  students.forEach((s) => counts.set(s.grade, (counts.get(s.grade) ?? 0) + 1));
  return Array.from(counts.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([grade, count]) => ({
      grade: GRADE_LABELS[grade] ?? `${grade}`,
      count,
      cat: gradeCategory(grade),
    }));
}

// 通学校別の生徒数（上位5校）
function buildSchoolDist(students: EnrichedStudent[]) {
  const counts = new Map<string, number>();
  students.forEach((s) => {
    if (s.school_name) counts.set(s.school_name, (counts.get(s.school_name) ?? 0) + 1);
  });
  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
}

// 週回数の分布（distinct 曜日数）と平均。通塾パターンが無い生徒は除外
function buildWeeklyDist(students: EnrichedStudent[]) {
  const buckets: Record<string, number> = { 週1: 0, 週2: 0, 週3: 0, 週4: 0, '週5+': 0 };
  let total = 0;
  let n = 0;
  students.forEach((s) => {
    const w = new Set(s.schedulePatterns.map((p) => p.day_of_week)).size;
    if (w === 0) return;
    total += w;
    n += 1;
    const key = w >= 5 ? '週5+' : `週${w}`;
    buckets[key] = (buckets[key] ?? 0) + 1;
  });
  const dist = Object.entries(buckets).map(([times, count]) => ({ times, count }));
  const avg = n > 0 ? Math.round((total / n) * 10) / 10 : 0;
  return { dist, avg };
}

/* ============================================================
 * アラートの期日系 → 要対応・期日一覧（期日帯タスク）
 * 期日を持つアラート(申込/面談/講習準備/日程変更/目標未設定)を、
 * 期限超過/今週/来週/それ以降 に振り分ける。期日の無い種別は一覧に出さない。
 * ========================================================== */

interface DueStudentRow {
  studentId: string;
  studentName: string;
  group: string; // 最も緊急な期日帯
  types: { type: string; count: number }[]; // 種別ごと件数
  soonestText: string; // 最も近い/古い期日の表示
  total: number; // この生徒の期日タスク総数
}

// 期日を持つアラート種別 → タスク種別バッジ（TASK_TYPES のキー）
const DUE_ALERT_TO_TYPE: Record<string, string> = {
  application_overdue: 'apply',
  course_prep_overdue: 'koushu',
  schedule_change_unapplied: 'transfer',
  interview_overdue: 'interview',
  interview_task: 'interview',
  exam_overdue: 'procedure',
};

// 期日のないアラート種別（成績低下/成績未入力/宿題/遅刻）＝「気になる生徒」に回す
const WATCH_ALERT_TYPES = new Set<string>([
  'score_drop',
  'score_missing',
  'homework_not_done',
  'tardy',
]);

const GROUP_RANK: Record<string, number> = { overdue: 0, thisWeek: 1, nextWeek: 2, later: 3 };
const TASK_TYPE_RANK: Record<string, number> = {
  apply: 0,
  transfer: 1,
  interview: 2,
  koushu: 3,
  procedure: 4,
};

function fmtDate(d?: string): string {
  if (!d) return '';
  const parts = d.split('-');
  return parts.length >= 3 ? `${+parts[1]}/${+parts[2]}` : d;
}

// アラートの期日系を生徒ごとに集約。各生徒は最も緊急な期日帯に置き、種別を件数チップ化する
function buildDueStudents(alertData: StudentAlerts[]): DueStudentRow[] {
  const rows: DueStudentRow[] = [];
  for (const s of alertData) {
    const items: { type: string; group: string; dueText: string; sortKey: number }[] = [];
    for (const a of s.alerts) {
      const type = DUE_ALERT_TO_TYPE[a.alert_type];
      if (!type) continue; // 成績低下/宿題/遅刻など期日の無い種別はアラートカード側のみ
      const d = a.details ?? {};
      const overdue = d.days_overdue;
      const until = d.days_until_due;
      let group: string;
      let dueText: string;
      let sortKey: number;
      if (overdue != null && overdue > 0) {
        group = 'overdue';
        dueText = d.due_date ? fmtDate(d.due_date) : `${overdue}日超過`;
        sortKey = -overdue;
      } else if (until != null) {
        group =
          until < 0 ? 'overdue' : until <= 6 ? 'thisWeek' : until <= 13 ? 'nextWeek' : 'later';
        dueText = d.due_date
          ? fmtDate(d.due_date)
          : until < 0
            ? `${-until}日超過`
            : `あと${until}日`;
        sortKey = until;
      } else {
        group = 'overdue';
        dueText = '要対応';
        sortKey = -9999;
      }
      items.push({ type, group, dueText, sortKey });
    }
    if (items.length === 0) continue;
    // 最緊急（期日帯→期日の近さ）を先頭に
    items.sort((a, b) => GROUP_RANK[a.group] - GROUP_RANK[b.group] || a.sortKey - b.sortKey);
    const soonest = items[0];
    const typeMap = new Map<string, number>();
    items.forEach((it) => typeMap.set(it.type, (typeMap.get(it.type) ?? 0) + 1));
    const types = Array.from(typeMap.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => (TASK_TYPE_RANK[a.type] ?? 99) - (TASK_TYPE_RANK[b.type] ?? 99));
    rows.push({
      studentId: s.student_id,
      studentName: s.student_name,
      group: soonest.group,
      types,
      soonestText: soonest.dueText,
      total: items.length,
    });
  }
  // 期日帯→件数の多い順
  rows.sort((a, b) => GROUP_RANK[a.group] - GROUP_RANK[b.group] || b.total - a.total);
  return rows;
}

/* ============================================================
 * ページ本体
 * ========================================================== */

function DetailView() {
  // タスクの完了状態をローカルで管理（チェックで完了/未完をトグル）
  // 要対応・期日一覧の「対応済み」チェック（生徒IDを保持）
  const [doneIds, setDoneIds] = useState<Set<string>>(() => new Set<string>());
  const toggleTask = (id: string) =>
    setDoneIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // 経営指標の実データ（school_monthly_metrics）を取得。無ければ下のダミー定数にフォールバック
  const { getSelectedSchoolIds } = useAuth();
  const [metrics, setMetrics] = useState<MonthlyMetricPoint[] | null>(null);
  useEffect(() => {
    const ids = getSelectedSchoolIds();
    const y = new Date().getFullYear();
    getSchoolMonthlyMetrics(ids, [y - 2, y - 1, y])
      .then(setMetrics)
      .catch(() => setMetrics([]));
  }, [getSelectedSchoolIds]);

  const real =
    metrics && metrics.length > 0 ? buildMetrics(metrics, new Date().getFullYear()) : null;
  const isRealData = !!real;
  const trend = real?.trend ?? ENROLLMENT_TREND;
  const waterfall = real?.waterfall ?? WATERFALL;
  const target = real?.target ?? TARGET;
  const churn = real?.churn ?? CHURN;

  const targetPct = Math.round((target.current / target.target) * 100);

  // 今月の動き（最新実績月の入会/退会/純増/予実）。室長が追う月次サマリー
  const thisMonthMove = (() => {
    if (!metrics || metrics.length === 0) return null;
    const y = new Date().getFullYear();
    const actual = metrics
      .filter((m) => m.kind === 'actual' && m.year === y)
      .sort((a, b) => a.month - b.month);
    const budget = metrics.filter((m) => m.kind === 'budget' && m.year === y);
    if (actual.length === 0) return null;
    const last = actual[actual.length - 1];
    const prev = actual.length >= 2 ? actual[actual.length - 2] : null;
    const b = budget.find((x) => x.month === last.month);
    return {
      newCount: last.newCount,
      leaveCount: last.leaveCount,
      netChange: prev ? last.activeCount - prev.activeCount : last.newCount - last.leaveCount,
      targetRate:
        b && b.activeCount > 0 ? Math.round((last.activeCount / b.activeCount) * 1000) / 10 : null,
    };
  })();

  // アラート（生徒モニタリング）の実データ。light を先に表示し、heavy(成績低下等)は背後でマージ
  const [alertData, setAlertData] = useState<StudentAlerts[] | null>(null);
  useEffect(() => {
    const ids = getSelectedSchoolIds();
    if (ids.length === 0) return;
    let active = true;
    getAlertsLight(ids)
      .then((light) => {
        if (!active) return;
        setAlertData(light);
        getAlertsHeavy(ids)
          .then((heavy) => {
            if (active) setAlertData((prev) => mergeStudentAlerts(prev ?? [], heavy));
          })
          .catch(() => {});
      })
      .catch(() => setAlertData([]));
    return () => {
      active = false;
    };
  }, [getSelectedSchoolIds]);

  const allAlerts: Alert[] = (alertData ?? []).flatMap((s) => s.alerts);
  const alertCount = allAlerts.length;
  const hasRealAlerts = alertData !== null && alertData.length > 0;

  // 生徒ごとに集約し、最重要種別→最重要severity の順で並べる（気になる生徒の並びに使う）
  const studentsSorted = (alertData ?? [])
    .map((s) => ({
      data: s,
      topPriority: Math.min(...s.alerts.map((a) => TYPE_PRIORITY[a.alert_type] ?? 99)),
      topSeverity: Math.min(...s.alerts.map((a) => SEVERITY_RANK[a.severity ?? 'info'] ?? 2)),
    }))
    .sort((a, b) => a.topPriority - b.topPriority || a.topSeverity - b.topSeverity);

  // 気になる生徒（期日のないアラート: 成績低下/成績未入力/宿題/遅刻）を持つ生徒
  const watchStudents = studentsSorted
    .map((s) => ({
      data: s.data,
      watch: s.data.alerts.filter((a) => WATCH_ALERT_TYPES.has(a.alert_type)),
    }))
    .filter((s) => s.watch.length > 0);

  // 要対応・期日一覧：アラートの期日系を生徒ごとに集約。未対応 = 未チェックの生徒数
  const dueStudents = alertData ? buildDueStudents(alertData) : [];
  const openCount = dueStudents.filter((s) => !doneIds.has(s.studentId)).length;
  // 期日帯ごとの未対応件数。超過の前（今週/来週/以降）を最上部サマリーで前面に出す
  const tierCounts = DUE_GROUPS.map((g) => ({
    key: g.key,
    label: g.label,
    tone: g.tone,
    count: dueStudents.filter((s) => s.group === g.key && !doneIds.has(s.studentId)).length,
  }));
  const gradeColor = (cat: string) => (cat === 'elem' ? C.blue : cat === 'mid' ? C.primary : C.ink);

  // 生徒データ（経営スナップショット集計用）と未処理申込件数の実データ
  const [students, setStudents] = useState<EnrichedStudent[] | null>(null);
  const [unprocessedCount, setUnprocessedCount] = useState<number | null>(null);
  useEffect(() => {
    const ids = getSelectedSchoolIds();
    if (ids.length === 0) return;
    let active = true;
    getStudents(undefined, ids)
      .then((s) => active && setStudents(s))
      .catch(() => setStudents([]));
    getRecentUnprocessedResponses(ids, 30, 100)
      .then((r) => active && setUnprocessedCount(r.length))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [getSelectedSchoolIds]);

  const activeStudents = (students ?? []).filter((s) => s.status === 'active');
  const hasStudents = students !== null && activeStudents.length > 0;
  const gradeDist = hasStudents ? buildGradeDist(activeStudents) : GRADE_DIST;
  const schoolDist = hasStudents ? buildSchoolDist(activeStudents) : SCHOOL_DIST;
  const weekly = hasStudents ? buildWeeklyDist(activeStudents) : { dist: WEEKLY_DIST, avg: 2.4 };
  const maxSchool = Math.max(...schoolDist.map((s) => s.count), 1);

  // 掲示板と本日の授業（単一校APIのため、複数選択時は先頭校を対象）
  const [bulletins, setBulletins] = useState<BulletinPost[] | null>(null);
  const [todayClasses, setTodayClasses] = useState<{ total: number; unrecorded: number } | null>(
    null
  );
  useEffect(() => {
    const ids = getSelectedSchoolIds();
    if (ids.length === 0) return;
    const sid = ids[0];
    let active = true;
    getBulletinPosts(sid)
      .then((b) => active && setBulletins(b))
      .catch(() => setBulletins([]));
    const today = new Date().toISOString().split('T')[0];
    getScheduleEntries(sid, today, today)
      .then((entries) => {
        if (!active) return;
        setTodayClasses({
          total: entries.length,
          unrecorded: entries.filter((e) => !e.attendance_status).length,
        });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [getSelectedSchoolIds]);

  // 宿題忘れ・遅刻の期間集計（既定は直近1週間。トグルで1ヶ月に切り替え）
  const [behaviorDays, setBehaviorDays] = useState<7 | 30>(7);
  const [behavior, setBehavior] = useState<HomeworkTardyCounts | null>(null);
  useEffect(() => {
    const ids = getSelectedSchoolIds();
    if (ids.length === 0) return;
    let active = true;
    getHomeworkTardyCounts(ids, behaviorDays)
      .then((c) => active && setBehavior(c))
      .catch(() => active && setBehavior({ homework: 0, tardy: 0, days: behaviorDays }));
    return () => {
      active = false;
    };
  }, [getSelectedSchoolIds, behaviorDays]);

  // フォーム参加率（模試/Vもぎ/増コマ の直近回。紐付き生徒/対象学年在籍）
  const [participation, setParticipation] = useState<FormParticipation[] | null>(null);
  useEffect(() => {
    const ids = getSelectedSchoolIds();
    if (ids.length === 0) return;
    let active = true;
    getFormParticipation(ids)
      .then((p) => active && setParticipation(p))
      .catch(() => setParticipation([]));
    return () => {
      active = false;
    };
  }, [getSelectedSchoolIds]);

  // ① 個別校の講習進捗データ（単一校。軽いデータ先行・auto_values 後追い）
  const [coursePrep, setCoursePrep] = useState<{
    students: Student[];
    items: CourseProgressItem[];
    progress: StudentCourseProgress[];
    period: CoursePrepPeriod | null;
    autoValues?: AutoValues;
  } | null>(null);
  useEffect(() => {
    const sid = getSelectedSchoolIds()[0];
    if (!sid) return;
    let active = true;
    const { season, year } = loadSavedSeasonYear();
    const params = { schoolId: sid, season, year: String(year), includeHidden: 'false' };
    batchFetchCoursePrepApi(params, ['students', 'progress_items', 'student_progress', 'period'])
      .then((light) => {
        if (!active) return;
        setCoursePrep({
          students: (light.students as Student[]) || [],
          items: (light.progress_items as CourseProgressItem[]) || [],
          progress: (light.student_progress as StudentCourseProgress[]) || [],
          period: (light.period as CoursePrepPeriod | null) || null,
        });
        batchFetchCoursePrepApi(params, ['auto_values'])
          .then((heavy) => {
            if (!active) return;
            setCoursePrep((prev) =>
              prev ? { ...prev, autoValues: (heavy.auto_values as AutoValues) || {} } : prev
            );
          })
          .catch(() => {});
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [getSelectedSchoolIds]);

  // テスト対策 提案→取得ファネル（7月運用開始予定。現状は提案0件で「データなし」表示）
  const [funnel, setFunnel] = useState<ProposalFunnel | null>(null);
  useEffect(() => {
    const ids = getSelectedSchoolIds();
    if (ids.length === 0) return;
    let active = true;
    getProposalFunnel(ids)
      .then((f) => active && setFunnel(f))
      .catch(() => setFunnel(null));
    return () => {
      active = false;
    };
  }, [getSelectedSchoolIds]);

  return (
    <AdminLayout
      headerTitle="ホーム"
      title="サンプル教室 ダッシュボード"
      actions={<QuickLinksBar />}
    >
      {/* モック明示バナー */}
      <div className="mb-2 flex items-center gap-2 rounded-lg border border-warning bg-warning-subtle px-4 py-2 text-sm text-warning">
        <Flag className="w-4 h-4 shrink-0" />
        これは検討用モックです。すべてダミーデータで、実データは未接続です。
      </div>

      {/* ① 連絡事項（掲示板）— 最上部・全幅 */}
      <SectionLabel icon={Pin}>連絡事項</SectionLabel>
      {/* 左アクセント: primary（全体連絡＝ブランド色で最上部を引き締める） */}
      <Card className="border-l-4 border-l-primary">
        <CardContent className="py-2">
          {bulletins === null ? (
            <div className="py-2 text-sm text-text-muted">読み込み中…</div>
          ) : bulletins.length === 0 ? (
            <div className="py-2 text-sm text-text-muted">連絡はありません</div>
          ) : (
            bulletins.slice(0, 4).map((b) => (
              <div
                key={b.id}
                className="flex items-center gap-2 py-2 border-b border-border-subtle last:border-0"
              >
                {b.is_pinned && <Pin className="w-3.5 h-3.5 text-warning shrink-0" />}
                <span className="flex-1 truncate text-sm text-text-body">{b.title}</span>
                <span className="shrink-0 text-xs text-text-faint">
                  {(b.created_at ?? '').slice(5, 10).replace('-', '/')}
                </span>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* ②③ 2カラム: 左＝数値（今を把握）/ 右＝やること（さばく）。lg未満は縦積み */}
      <div className="grid gap-x-6 lg:grid-cols-2 lg:items-start">
        {/* ── 左カラム：数値 ── */}
        <div>
          {/* 今月の動き（最新実績月の入会/退会/純増/予実）。室長が追う月次が主役 */}
          {thisMonthMove && (
            <>
              <SectionLabel icon={TrendingUp}>今月の動き</SectionLabel>
              {/* tone付き背景で4枚を色分けし、白カード群の中で月次サマリーを際立たせる */}
              <div className="grid grid-cols-2 gap-3">
                <Card className="border-success bg-success-subtle">
                  <CardContent className="py-3">
                    <div className="text-xs text-text-muted">入会</div>
                    <div className="text-2xl font-bold text-success">+{thisMonthMove.newCount}</div>
                  </CardContent>
                </Card>
                <Card className="border-danger bg-danger-subtle">
                  <CardContent className="py-3">
                    <div className="text-xs text-text-muted">退会(休会)</div>
                    <div className="text-2xl font-bold text-danger">
                      −{thisMonthMove.leaveCount}
                    </div>
                  </CardContent>
                </Card>
                <Card className="border-info bg-info-subtle">
                  <CardContent className="py-3">
                    <div className="text-xs text-text-muted">純増</div>
                    <div className="text-2xl font-bold text-text-heading">
                      {thisMonthMove.netChange > 0 ? '+' : ''}
                      {thisMonthMove.netChange}
                    </div>
                  </CardContent>
                </Card>
                <Card className="border-primary bg-primary-subtle">
                  <CardContent className="py-3">
                    <div className="text-xs text-text-muted">予実達成</div>
                    <div className="text-2xl font-bold text-text-heading">
                      {thisMonthMove.targetRate != null ? `${thisMonthMove.targetRate}%` : '—'}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </>
          )}

          {/* 今この瞬間（KPI: 未処理申込/本日授業/アラート/在籍）。「今の数値」軸 */}
          <SectionLabel icon={Inbox}>今この瞬間</SectionLabel>
          <div className="grid grid-cols-2 gap-4">
            {KPIS.map((k) => {
              const t = TONE[k.tone];
              // 要対応アラート/在籍/未処理申込/本日授業は実データで上書き（他はダミーのまま）
              const value =
                k.key === 'alert' && hasRealAlerts
                  ? alertCount
                  : k.key === 'students' && hasStudents
                    ? activeStudents.length
                    : k.key === 'pending' && unprocessedCount !== null
                      ? unprocessedCount
                      : k.key === 'today' && todayClasses
                        ? todayClasses.total
                        : k.value;
              return (
                <Card
                  key={k.key}
                  className={`cursor-pointer hover:bg-surface-hover transition-colors border-l-4 ${t.borderL}`}
                >
                  <CardContent className="py-4">
                    <div className="flex items-start justify-between">
                      <div className={`rounded-lg p-2 ${t.bg}`}>
                        <k.icon className={`w-5 h-5 ${t.text}`} />
                      </div>
                      <ChevronRight className="w-4 h-4 text-text-faint" />
                    </div>
                    <div className="mt-3 flex items-baseline gap-1">
                      <span className="text-3xl font-bold text-text-heading">{value}</span>
                      <span className="text-sm text-text-muted">{k.unit}</span>
                    </div>
                    <div className="mt-0.5 text-sm text-text-body">{k.label}</div>
                    <div className="text-xs text-text-faint">
                      {k.key === 'today' && todayClasses
                        ? `出欠未入力 ${todayClasses.unrecorded}`
                        : k.sub}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* 宿題忘れ・遅刻の件数集計（既定1週間 / トグルで1ヶ月）。授業単位の発生件数 */}
          <SectionLabel
            icon={ClipboardList}
            right={
              <div className="inline-flex overflow-hidden rounded-lg border border-border text-xs">
                {([7, 30] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setBehaviorDays(d)}
                    className={`px-2.5 py-1 font-medium transition-colors ${
                      behaviorDays === d
                        ? 'bg-ink text-text-on-primary'
                        : 'bg-surface text-text-muted hover:bg-surface-hover'
                    }`}
                  >
                    {d === 7 ? '1週間' : '1ヶ月'}
                  </button>
                ))}
              </div>
            }
          >
            宿題忘れ・遅刻
          </SectionLabel>
          <div className="grid grid-cols-2 gap-4">
            <Card className="border-l-4 border-l-warning">
              <CardContent className="py-4">
                <div className="flex items-center gap-1.5 text-xs text-text-muted">
                  <ClipboardList className="h-3.5 w-3.5" />
                  宿題忘れ
                </div>
                <div className="mt-1 flex items-baseline gap-1">
                  <span className="text-3xl font-bold text-text-heading">
                    {behavior ? behavior.homework : '—'}
                  </span>
                  <span className="text-sm text-text-muted">件</span>
                </div>
                <div className="mt-0.5 text-xs text-text-faint">
                  直近{behaviorDays === 7 ? '1週間' : '1ヶ月'}
                </div>
              </CardContent>
            </Card>
            <Card className="border-l-4 border-l-danger">
              <CardContent className="py-4">
                <div className="flex items-center gap-1.5 text-xs text-text-muted">
                  <Clock className="h-3.5 w-3.5" />
                  遅刻
                </div>
                <div className="mt-1 flex items-baseline gap-1">
                  <span className="text-3xl font-bold text-text-heading">
                    {behavior ? behavior.tardy : '—'}
                  </span>
                  <span className="text-sm text-text-muted">件</span>
                </div>
                <div className="mt-0.5 text-xs text-text-faint">
                  直近{behaviorDays === 7 ? '1週間' : '1ヶ月'}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* 在籍数の推移（昨対比）。経営の頭出しとして数値カラムに置く */}
          <SectionLabel
            icon={TrendingUp}
            right={
              <Link
                href="/settings/school-metrics"
                className="flex items-center gap-1 text-xs text-text-muted hover:text-primary transition-colors"
              >
                データ入力
                <ChevronRight className="w-3 h-3" />
              </Link>
            }
          >
            在籍数の推移（昨対比）
          </SectionLabel>
          {!isRealData && (
            <p className="-mt-2 mb-3 text-xs text-text-faint">
              ※
              この教室の月次データが未取得のためサンプル表示です（永山校を選択し月次データのマイグレーションを適用すると実データになります）。
            </p>
          )}
          <Card>
            <CardContent>
              <div className="w-full h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trend} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis
                      dataKey="month"
                      tick={{ fontSize: 11, fill: '#4b5563' }}
                      tickLine={false}
                    />
                    <YAxis
                      domain={[90, 130]}
                      tick={{ fontSize: 11, fill: '#4b5563' }}
                      tickLine={false}
                      axisLine={false}
                      width={32}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#fff',
                        border: '1px solid #e5e7eb',
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />
                    <Line
                      type="monotone"
                      dataKey="thisYear"
                      name="今年"
                      stroke={C.primary}
                      strokeWidth={2.5}
                      dot={{ r: 2 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="lastYear"
                      name="昨年"
                      stroke={C.slate}
                      strokeWidth={2}
                      strokeDasharray="5 4"
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ── 右カラム：やること ── */}
        <div>
          {/* 業務進捗（今月のタスク）— 室長が毎月追う主役。やることの最上位に置く（達成演出つき） */}
          <SectionLabel icon={ListTodo}>業務進捗（今月のタスク）</SectionLabel>
          <TaskProgressWidget schoolIds={getSelectedSchoolIds()} />

          {/* [★] 要対応（アラート統合）。期日帯でグルーピングし超過前から網羅、各行からカレンダー登録 */}
          <SectionLabel
            icon={CalendarDays}
            right={
              <span className="text-sm text-text-muted">
                未対応 <span className="font-bold text-text-heading">{openCount}</span> 件
              </span>
            }
          >
            要対応・期日一覧
          </SectionLabel>
          {/* 左アクセント: warning（期日系＝注意して捌く） */}
          <Card className="border-l-4 border-l-warning">
            <CardContent className="py-2">
              {/* 期日帯サマリー：超過の前（今週/来週/以降）の件数を最初に見せ、先回りで気づけるようにする */}
              {dueStudents.length > 0 && (
                <div className="flex flex-wrap gap-1.5 border-b border-border-subtle pb-2">
                  {tierCounts.map((t) => {
                    const tn = TONE[t.tone];
                    return (
                      <span
                        key={t.key}
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                          t.count > 0 ? `${tn.bg} ${tn.text}` : 'bg-surface-hover text-text-faint'
                        }`}
                      >
                        {t.label} {t.count}
                      </span>
                    );
                  })}
                </div>
              )}
              <p className="border-b border-border-subtle py-2 text-xs text-text-muted">
                期日が来る前から網羅（アラート予兆を含む）。いつカレンダーに入れるかの判断材料。
              </p>
              {dueStudents.length === 0 ? (
                <div className="py-3 text-sm text-text-muted">
                  {alertData === null ? '読み込み中…' : '対応が必要な期日はありません'}
                </div>
              ) : (
                DUE_GROUPS.map((g) => {
                  // この期日帯の生徒（未対応を上、対応済みを下）
                  const inGroup = dueStudents
                    .filter((s) => s.group === g.key)
                    .sort(
                      (a, b) => Number(doneIds.has(a.studentId)) - Number(doneIds.has(b.studentId))
                    );
                  if (inGroup.length === 0) return null;
                  const gt = TONE[g.tone];
                  return (
                    <div key={g.key} className="py-2">
                      {/* グループ見出し（期日帯） */}
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className={`text-xs font-bold px-2 py-0.5 rounded-full ${gt.bg} ${gt.text}`}
                        >
                          {g.label}
                        </span>
                        <span className="text-xs text-text-faint">
                          {dueGroupHint(g.key)}・{inGroup.length}名
                        </span>
                      </div>
                      {inGroup.map((s) => {
                        const done = doneIds.has(s.studentId);
                        const overdue = g.key === 'overdue' && !done;
                        return (
                          <div
                            key={s.studentId}
                            onClick={() => toggleTask(s.studentId)}
                            className="flex items-center gap-3 py-2.5 border-b border-border-subtle last:border-0 cursor-pointer hover:bg-surface-hover -mx-2 px-2 rounded-lg transition-colors"
                          >
                            {/* チェック（対応済みにする） */}
                            {done ? (
                              <CheckCircle2 className="w-5 h-5 text-success shrink-0" />
                            ) : (
                              <Circle className="w-5 h-5 text-text-faint shrink-0" />
                            )}
                            {/* 生徒名 + 最緊急の期日 */}
                            <div className="flex items-center gap-2 shrink-0">
                              <span
                                className={`text-sm font-medium ${done ? 'line-through text-text-faint' : 'text-text-body'}`}
                              >
                                {s.studentName}
                              </span>
                              <span
                                className={`flex items-center gap-1 text-xs ${overdue ? 'text-danger font-medium' : 'text-text-faint'}`}
                              >
                                <Clock className="w-3 h-3" />
                                {s.soonestText}
                              </span>
                            </div>
                            {/* 種別チップ群（件数つき） */}
                            <div className="hidden flex-1 flex-wrap justify-end gap-1 sm:flex">
                              {s.types.map((ty) => {
                                const def = TASK_TYPES[ty.type];
                                const tn = TONE[def.tone];
                                return (
                                  <span
                                    key={ty.type}
                                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs font-medium ${tn.bg} ${tn.text}`}
                                  >
                                    <def.icon className="w-3 h-3" />
                                    {def.label}
                                    {ty.count > 1 ? ` ${ty.count}` : ''}
                                  </span>
                                );
                              })}
                            </div>
                            {/* カレンダー登録（将来 Google カレンダー連携の入口。今は見た目のみ） */}
                            {!done && (
                              <button
                                type="button"
                                onClick={(e) => e.stopPropagation()}
                                className="flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-border text-text-muted hover:bg-surface-hover hover:text-primary transition-colors shrink-0"
                              >
                                <CalendarPlus className="w-3.5 h-3.5" />
                                <span className="hidden sm:inline">予定に追加</span>
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>

          {/* 気になる生徒（期日のないアラート: 成績低下/宿題/遅刻）。AlertBoard の非期日系を移行 */}
          {watchStudents.length > 0 && (
            <>
              <SectionLabel icon={AlertTriangle}>気になる生徒</SectionLabel>
              {/* 左アクセント: info（期日はないが目配りしたい情報） */}
              <Card className="border-l-4 border-l-info">
                <CardContent className="py-2">
                  <p className="border-b border-border-subtle pb-2 text-xs text-text-muted">
                    成績低下・宿題・遅刻など、期日のない注意点
                  </p>
                  {watchStudents.slice(0, 10).map((s) => (
                    <div
                      key={s.data.student_id}
                      className="flex items-center gap-2 border-b border-border-subtle py-2 last:border-0"
                    >
                      <span className="flex-1 text-sm font-medium text-text-body">
                        {s.data.student_name}
                      </span>
                      <div className="flex flex-wrap justify-end gap-1">
                        {s.watch.map((a) => (
                          <span
                            key={a.id}
                            className="rounded-full bg-surface-hover px-2 py-0.5 text-xs text-text-muted"
                          >
                            {ALERT_TYPE_LABELS[a.alert_type]}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </>
          )}

          {/* 最近の動き（活動フィード）。/students 上部の通知フィードを移行 */}
          <SectionLabel icon={History}>最近の動き</SectionLabel>
          <NotificationFeed />
        </div>
      </div>

      {/* ===== ④ 下段：見える化（フォーム参加率 / 提案 / 講習 / 業務 / 経営） ===== */}

      {/* フォーム参加率（受験率・取得率） */}
      <SectionLabel icon={ClipboardList}>フォーム参加率（受験率・取得率）</SectionLabel>
      <p className="-mt-2 mb-3 text-xs text-text-faint">
        紐付け済みの回答で集計（各フォームの直近の回が対象。分母は対象学年の在籍数）。
      </p>
      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {participation === null ? (
          <div className="py-3 text-sm text-text-muted">読み込み中…</div>
        ) : participation.length === 0 ? (
          <div className="py-3 text-sm text-text-muted">対象のフォーム期間がありません</div>
        ) : (
          participation.map((p) => (
            <Card key={p.formType}>
              <CardContent className="py-4">
                <div className="text-sm text-text-muted">{p.label}</div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-3xl font-bold text-text-heading">{p.rate}%</span>
                  <span className="text-xs text-text-faint">
                    {p.numerator} / {p.denominator} 名
                  </span>
                </div>
                <div className="mt-1 truncate text-xs text-text-faint">{p.periodTitle || '—'}</div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* テスト対策 提案→取得ファネル（7月運用開始予定） */}
      <SectionLabel icon={ClipboardList}>テスト対策 提案→取得ファネル</SectionLabel>
      {funnel === null ? (
        <div className="mb-4 py-3 text-sm text-text-muted">読み込み中…</div>
      ) : funnel.proposalCount === 0 ? (
        <Card className="mb-4">
          <CardContent className="py-5 text-sm text-text-muted">
            提案データはまだありません（テスト対策提案書は7月運用開始予定）。提案が入ると、提案数・提案人数・取得率と学年別の内訳が自動で表示されます。
          </CardContent>
        </Card>
      ) : (
        <Card className="mb-4">
          <CardContent className="py-4">
            {/* 全体ファネル */}
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className="text-sm text-text-muted">
                提案 <b className="text-text-heading">{funnel.proposalCount}</b> 件
              </span>
              <span className="text-sm text-text-muted">
                提案人数 <b className="text-text-heading">{funnel.proposedStudents}</b> 名
              </span>
              <ChevronRight className="w-4 h-4 text-text-faint" />
              <span className="text-sm text-text-muted">
                取得 <b className="text-text-heading">{funnel.acquiredStudents}</b> 名
              </span>
              <span className="ml-auto text-2xl font-bold text-primary">{funnel.rate}%</span>
            </div>
            {/* 科目ベースの取得率 */}
            <div className="mt-2 text-sm text-text-muted">
              科目：提案 <b className="text-text-heading">{funnel.proposedSubjects}</b> 科目
              <ChevronRight className="mx-1 inline h-3 w-3 text-text-faint" />
              取得 <b className="text-text-heading">{funnel.acquiredSubjects}</b> 科目
              <span className="ml-2 font-bold text-primary">{funnel.subjectRate}%</span>
            </div>
            {/* 学年別の取得率 */}
            {funnel.byGrade.length > 0 && (
              <div className="mt-4 space-y-2">
                <div className="text-xs font-medium text-text-muted">学年別の取得率</div>
                {funnel.byGrade.map((g) => (
                  <div key={g.grade} className="flex items-center gap-3">
                    <div className="w-10 shrink-0 text-sm text-text-body">
                      {GRADE_LABELS[g.grade] ?? g.grade}
                    </div>
                    <div className="h-5 flex-1 overflow-hidden rounded-md bg-surface-hover">
                      <div
                        className="h-full rounded-md bg-primary"
                        style={{ width: `${g.rate}%` }}
                      />
                    </div>
                    <div className="w-28 text-right text-xs text-text-faint">
                      {g.acquired}/{g.proposed} 名（{g.rate}%）
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ① 講習進捗（この教室）— /courses/progress と同じ単一校ダッシュボードを読み取り専用で */}
      <SectionLabel icon={GraduationCap}>講習進捗（この教室）</SectionLabel>
      {coursePrep ? (
        <CourseProgressDashboard
          students={coursePrep.students}
          items={coursePrep.items}
          progressData={coursePrep.progress}
          period={coursePrep.period}
          autoValues={coursePrep.autoValues}
        />
      ) : (
        <div className="h-44 animate-pulse rounded-xl bg-surface" />
      )}

      {/* ===== 経営指標 — 動き（増減・予実・見込み） ===== */}
      <SectionLabel icon={TrendingUp}>経営指標 — 動き（増減・予実）</SectionLabel>
      <Card>
        <CardHeader>
          <CardTitle>今月の増減内訳</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="w-full h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={waterfall} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 11, fill: '#4b5563' }}
                  tickLine={false}
                  interval={0}
                />
                <YAxis
                  domain={[100, 130]}
                  tick={{ fontSize: 11, fill: '#4b5563' }}
                  tickLine={false}
                  axisLine={false}
                  width={32}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#fff',
                    border: '1px solid #e5e7eb',
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="range" radius={[4, 4, 4, 4]}>
                  {waterfall.map((w, i) => (
                    <Cell
                      key={i}
                      fill={w.kind === 'up' ? C.green : w.kind === 'down' ? C.red : C.slate}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="flex justify-between px-2 -mt-2 text-xs">
            {waterfall.map((w) => (
              <span
                key={w.name}
                className={
                  w.kind === 'up'
                    ? 'text-success'
                    : w.kind === 'down'
                      ? 'text-danger'
                      : 'text-text-muted'
                }
              >
                {w.delta}
              </span>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* 率・予実・見込み（3つの小カード） */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-6">
        {/* 退会率・継続率 */}
        <Card>
          <CardContent className="py-5">
            <div className="flex gap-4">
              <MiniStat label="今月の退会率" value={`${churn.churnRate}%`} />
              <MiniStat label="継続率" value={`${churn.retentionRate}%`} />
            </div>
          </CardContent>
        </Card>

        {/* 着地見込み */}
        <Card>
          <CardContent className="py-5">
            <div className="flex items-center gap-2 text-xs text-text-muted">
              <Target className="w-4 h-4" />
              期末の着地見込み
            </div>
            <div className="mt-1 text-3xl font-bold text-text-heading">
              {churn.forecast}
              <span className="text-sm font-normal text-text-muted ml-1">名</span>
            </div>
            <div className="text-xs text-text-faint mt-0.5">直近の純増ペースから外挿</div>
          </CardContent>
        </Card>

        {/* 予実ゲージ（在籍目標） */}
        <Card>
          <CardContent className="py-5">
            <div className="flex items-center justify-between text-xs text-text-muted">
              <span>在籍目標の達成</span>
              <span>
                {target.current} / {target.target} 名
              </span>
            </div>
            <div className="mt-2 text-3xl font-bold text-text-heading">{targetPct}%</div>
            <div className="mt-2 h-2.5 w-full rounded-full bg-surface-hover overflow-hidden">
              <div
                className={`h-full rounded-full ${targetPct >= 100 ? 'bg-success' : 'bg-primary'}`}
                style={{ width: `${Math.min(targetPct, 100)}%` }}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ===== 経営指標 — 構成（スナップショット） ===== */}
      <SectionLabel icon={GraduationCap}>経営指標 — 構成（今の生徒の内訳）</SectionLabel>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 学年構成 */}
        <Card>
          <CardHeader>
            <CardTitle>学年構成</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="w-full h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={gradeDist} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                  <XAxis
                    dataKey="grade"
                    tick={{ fontSize: 11, fill: '#4b5563' }}
                    tickLine={false}
                    interval={0}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#4b5563' }}
                    tickLine={false}
                    axisLine={false}
                    width={28}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#fff',
                      border: '1px solid #e5e7eb',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="count" name="人数" radius={[4, 4, 0, 0]}>
                    {gradeDist.map((g, i) => (
                      <Cell key={i} fill={gradeColor(g.cat)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="flex gap-4 justify-center text-xs text-text-muted mt-1">
              <span className="flex items-center gap-1">
                <span
                  className="w-2.5 h-2.5 rounded-full inline-block"
                  style={{ background: C.blue }}
                />
                小学
              </span>
              <span className="flex items-center gap-1">
                <span
                  className="w-2.5 h-2.5 rounded-full inline-block"
                  style={{ background: C.primary }}
                />
                中学
              </span>
              <span className="flex items-center gap-1">
                <span
                  className="w-2.5 h-2.5 rounded-full inline-block"
                  style={{ background: C.ink }}
                />
                高校
              </span>
            </div>
          </CardContent>
        </Card>

        {/* 平均週回数 */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>週回数の分布</CardTitle>
            <span className="text-sm text-text-muted">
              平均 <span className="font-bold text-text-heading">{weekly.avg}</span> 回
            </span>
          </CardHeader>
          <CardContent>
            <div className="w-full h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weekly.dist} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                  <XAxis
                    dataKey="times"
                    tick={{ fontSize: 11, fill: '#4b5563' }}
                    tickLine={false}
                    interval={0}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#4b5563' }}
                    tickLine={false}
                    axisLine={false}
                    width={28}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#fff',
                      border: '1px solid #e5e7eb',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="count" name="人数" fill={C.blue} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 通学校別ランキング */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6 mb-4">
        <Card>
          <CardHeader className="flex flex-row items-center gap-2">
            <School className="w-4 h-4 text-text-muted" />
            <CardTitle>通学校別の生徒数（上位）</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 py-4">
            {schoolDist.map((s) => (
              <div key={s.name} className="flex items-center gap-3">
                <div className="w-28 shrink-0 text-sm text-text-body truncate">{s.name}</div>
                <div className="flex-1 h-5 rounded-md bg-surface-hover overflow-hidden">
                  <div
                    className="h-full rounded-md bg-primary"
                    style={{ width: `${(s.count / maxSchool) * 100}%` }}
                  />
                </div>
                <div className="w-8 text-right text-sm font-medium text-text-heading">
                  {s.count}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* 男女比プレースホルダ（性別データ未整備） */}
        <Card>
          <CardHeader>
            <CardTitle>男女比</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center justify-center h-[180px] text-center">
            <Users className="w-8 h-8 text-text-faint mb-2" />
            <div className="text-sm text-text-muted">性別データの取り込み後に表示</div>
            <div className="text-xs text-text-faint mt-1">CSV/Excel 一括取り込みで整備予定</div>
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}

/* ============================================================
 * 全教室 俯瞰ビュー（「すべての教室」選択時）
 * 校舎別の主要KPIを比較テーブル＋合計行で表示。行クリックで詳細へ切り替え。
 * 月次系(前月純増/予実/退会率)は school_monthly_metrics 投入済み校のみ数字、他は「—」。
 * ========================================================== */

function SummaryStat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="text-xs text-text-muted">{label}</div>
        <div className="mt-1">
          <span className="text-2xl font-bold text-text-heading">{value}</span>
          {unit && <span className="ml-1 text-sm text-text-muted">{unit}</span>}
        </div>
      </CardContent>
    </Card>
  );
}

function OverviewView() {
  const { getSelectedSchoolIds, setSelectedSchoolId } = useAuth();
  const { schools } = useMasterData();
  const [data, setData] = useState<Overview | null>(null);

  useEffect(() => {
    const ids = new Set(getSelectedSchoolIds());
    const target = schools.filter((s) => ids.has(s.id)).map((s) => ({ id: s.id, name: s.name }));
    let active = true;
    getOverview(target)
      .then((d) => active && setData(d))
      .catch(() => active && setData(null));
    return () => {
      active = false;
    };
  }, [getSelectedSchoolIds, schools]);

  // 講習進捗「すべての教室」カード用データ（/courses/progress と同じ取得・KPI算出）
  const [coursePrepRows, setCoursePrepRows] = useState<SchoolOverviewRow[]>([]);
  const [coursePrepLoading, setCoursePrepLoading] = useState(true);
  useEffect(() => {
    const ids = new Set(getSelectedSchoolIds());
    const target = schools.filter((s) => ids.has(s.id));
    if (target.length === 0) {
      setCoursePrepLoading(false);
      return;
    }
    let active = true;
    setCoursePrepLoading(true);
    const { season, year } = loadSavedSeasonYear();
    const today = new Date().toISOString().slice(0, 10);
    batchFetchCoursePrepApiMulti(
      { schoolIds: target.map((s) => s.id), season, year: String(year), includeHidden: 'false' },
      ['students', 'progress_items', 'student_progress', 'period', 'auto_values']
    )
      .then((multi) => {
        if (!active) return;
        const rows: SchoolOverviewRow[] = target.map((school) => {
          const batch = multi[school.id] || {};
          return {
            schoolId: school.id,
            schoolName: school.name,
            kpis: computeSchoolKpis(
              (batch.students as Parameters<typeof computeSchoolKpis>[0]) || [],
              (batch.progress_items as Parameters<typeof computeSchoolKpis>[1]) || [],
              (batch.student_progress as Parameters<typeof computeSchoolKpis>[2]) || [],
              (batch.auto_values as Parameters<typeof computeSchoolKpis>[3]) || {},
              (batch.period as Parameters<typeof computeSchoolKpis>[4]) || null,
              today
            ),
          };
        });
        setCoursePrepRows(rows);
        setCoursePrepLoading(false);
      })
      .catch(() => active && setCoursePrepLoading(false));
    return () => {
      active = false;
    };
  }, [getSelectedSchoolIds, schools]);

  const fmtNet = (n: number | null) => (n == null ? '—' : n > 0 ? `+${n}` : `${n}`);
  const fmtPct = (n: number | null) => (n == null ? '—' : `${n}%`);

  return (
    <AdminLayout headerTitle="ホーム" title="全教室 ダッシュボード">
      <div className="mb-6 flex items-center gap-2 rounded-lg border border-warning bg-warning-subtle px-4 py-2 text-sm text-warning">
        <Flag className="w-4 h-4 shrink-0" />
        全教室の俯瞰ビュー（マネージャー以上）。校舎の行をクリックすると、その校舎の詳細に切り替わります。
      </div>

      {/* 全社サマリー */}
      {data && (
        <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-3">
          <SummaryStat label="総在籍" value={`${data.totalActive}`} unit="名" />
          <SummaryStat label="今月入会" value={`${data.totalNew}`} unit="名" />
          <SummaryStat label="今月退会(休会)" value={`${data.totalLeave}`} unit="名" />
          <SummaryStat label="予実達成（平均）" value={fmtPct(data.overallTargetRate)} />
          <SummaryStat label="平均退会率" value={fmtPct(data.avgChurn)} />
          <SummaryStat label="要対応 合計" value={`${data.totalAlerts}`} unit="件" />
          <SummaryStat label="Vもぎ受験率（全社）" value={fmtPct(data.mogiRate)} />
          <SummaryStat label="増コマ取得率（全社）" value={fmtPct(data.zoukomaRate)} />
          <SummaryStat label="提案取得率（全社）" value={fmtPct(data.proposalRate)} />
        </div>
      )}

      {/* 校舎別 比較テーブル */}
      <Card>
        <CardHeader>
          <CardTitle>校舎別 比較</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto py-2">
          {data === null ? (
            <div className="py-4 text-sm text-text-muted">読み込み中…</div>
          ) : data.rows.length === 0 ? (
            <div className="py-4 text-sm text-text-muted">対象の教室がありません</div>
          ) : (
            <table className="w-full whitespace-nowrap text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-text-muted">
                  <th className="px-2 py-2 text-left">校舎</th>
                  <th className="px-2 py-2 text-right">在籍</th>
                  <th className="px-2 py-2 text-right">前月純増</th>
                  <th className="px-2 py-2 text-right">入会</th>
                  <th className="px-2 py-2 text-right">退会</th>
                  <th className="px-2 py-2 text-right">予実達成</th>
                  <th className="px-2 py-2 text-right">退会率</th>
                  <th className="px-2 py-2 text-right">要対応</th>
                  <th className="px-2 py-2 text-right">模試</th>
                  <th className="px-2 py-2 text-right">Vもぎ</th>
                  <th className="px-2 py-2 text-right">増コマ</th>
                  <th className="px-2 py-2 text-right">提案</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr
                    key={r.schoolId}
                    onClick={() => setSelectedSchoolId(r.schoolId)}
                    className="cursor-pointer border-b border-border-subtle hover:bg-surface-hover"
                  >
                    <td className="px-2 py-2.5 font-medium text-text-body">{r.schoolName}</td>
                    <td className="px-2 py-2.5 text-right text-text-heading">{r.activeCount}</td>
                    <td
                      className={`px-2 py-2.5 text-right ${
                        r.netChange != null && r.netChange > 0
                          ? 'text-success'
                          : r.netChange != null && r.netChange < 0
                            ? 'text-danger'
                            : 'text-text-faint'
                      }`}
                    >
                      {fmtNet(r.netChange)}
                    </td>
                    <td className="px-2 py-2.5 text-right text-text-body">{r.newCount ?? '—'}</td>
                    <td className="px-2 py-2.5 text-right text-text-body">{r.leaveCount ?? '—'}</td>
                    <td
                      className={`px-2 py-2.5 text-right ${
                        r.targetRate != null && r.targetRate >= 100
                          ? 'font-medium text-success'
                          : r.targetRate != null && r.targetRate < 90
                            ? 'text-danger'
                            : 'text-text-body'
                      }`}
                    >
                      {fmtPct(r.targetRate)}
                    </td>
                    <td
                      className={`px-2 py-2.5 text-right ${
                        r.churnRate != null && r.churnRate > 5
                          ? 'font-medium text-danger'
                          : 'text-text-body'
                      }`}
                    >
                      {fmtPct(r.churnRate)}
                    </td>
                    <td
                      className={`px-2 py-2.5 text-right ${r.alertCount > 10 ? 'font-medium text-danger' : 'text-text-body'}`}
                    >
                      {r.alertCount}
                    </td>
                    <td className="px-2 py-2.5 text-right text-text-body">{fmtPct(r.moshiRate)}</td>
                    <td className="px-2 py-2.5 text-right text-text-body">{fmtPct(r.mogiRate)}</td>
                    <td className="px-2 py-2.5 text-right text-text-body">
                      {fmtPct(r.zoukomaRate)}
                    </td>
                    <td className="px-2 py-2.5 text-right text-text-body">
                      {fmtPct(r.proposalRate)}
                    </td>
                  </tr>
                ))}
                {/* 合計/全社行 */}
                <tr className="border-t-2 border-border font-bold">
                  <td className="px-2 py-2.5 text-text-heading">合計 / 全社</td>
                  <td className="px-2 py-2.5 text-right text-text-heading">{data.totalActive}</td>
                  <td className="px-2 py-2.5 text-right text-text-faint">—</td>
                  <td className="px-2 py-2.5 text-right text-text-body">{data.totalNew}</td>
                  <td className="px-2 py-2.5 text-right text-text-body">{data.totalLeave}</td>
                  <td className="px-2 py-2.5 text-right text-text-body">
                    {fmtPct(data.overallTargetRate)}
                  </td>
                  <td className="px-2 py-2.5 text-right text-text-body">{fmtPct(data.avgChurn)}</td>
                  <td className="px-2 py-2.5 text-right text-text-heading">{data.totalAlerts}</td>
                  <td className="px-2 py-2.5 text-right text-text-body">
                    {fmtPct(data.moshiRate)}
                  </td>
                  <td className="px-2 py-2.5 text-right text-text-body">{fmtPct(data.mogiRate)}</td>
                  <td className="px-2 py-2.5 text-right text-text-body">
                    {fmtPct(data.zoukomaRate)}
                  </td>
                  <td className="px-2 py-2.5 text-right text-text-body">
                    {fmtPct(data.proposalRate)}
                  </td>
                </tr>
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* 講習進捗（すべての教室）— /courses/progress と同じ全教室カードをそのまま組み込み */}
      <div className="mt-6">
        <SectionLabel icon={GraduationCap}>講習進捗（すべての教室）</SectionLabel>
        <AllSchoolsOverview
          rows={coursePrepRows}
          loading={coursePrepLoading}
          onSelectSchool={(id) => setSelectedSchoolId(id)}
        />
      </div>
    </AdminLayout>
  );
}

/* 分岐: すべての教室 → 俯瞰ビュー、個別校舎 → 詳細ビュー */
export default function HomeMockPage() {
  const { selectedSchoolId, profile, isLoading } = useAuth();

  // このページはリンク側（AppHeader）が元から admin 限定で出しているのに、
  // ページ自体には認可が無く、URL直打ちなら講師でも開けてしまっていた。
  // ここは「意図（admin限定の試作）に実装を合わせる」だけの修正であり、
  // リンクは元から admin にしか出ていないため誰の業務動線も変えない。
  // 判定は必ずリンク側と同じ isSystemAdmin にする（ズレると入口と中身が食い違う）。
  if (isLoading) {
    return (
      <AdminLayout>
        <Loading />
      </AdminLayout>
    );
  }
  if (!isSystemAdmin(profile?.role)) {
    return (
      <AdminLayout>
        <AccessDenied message="このページはシステム管理者のみアクセス可能です" />
      </AdminLayout>
    );
  }

  return selectedSchoolId === 'all' ? <OverviewView /> : <DetailView />;
}
