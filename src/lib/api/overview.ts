import { supabase } from '../supabase';
import { getStudents } from './students';
import { getAlertsLight } from './alerts';
import { getFormParticipation, getProposalFunnel } from './dashboardForms';

/**
 * 全教室 俯瞰ダッシュボード用：校舎別の主要KPIと全社合計/平均を集計する。
 * マネージャー以上が「すべての教室」を選んだときに使う。
 * - 在籍/要対応/フォーム参加率/提案取得率: 全校データから集計
 * - 入会/退会/前月純増/予実達成/退会率: school_monthly_metrics 投入済みの校のみ（未投入は null = 「—」）
 */

export interface OverviewRow {
  schoolId: string;
  schoolName: string;
  activeCount: number;
  newCount: number | null; // 今月の入会数
  leaveCount: number | null; // 今月の休会(退会)数
  netChange: number | null; // 前月純増
  targetRate: number | null; // 予実達成%
  churnRate: number | null; // 退会率%
  alertCount: number; // 要対応件数
  moshiRate: number | null; // 模試 受験率
  mogiRate: number | null; // Vもぎ 受験率
  zoukomaRate: number | null; // 増コマ 取得率
  proposalRate: number | null; // 提案 取得率(生徒ベース)
}

export interface Overview {
  rows: OverviewRow[];
  totalActive: number;
  totalNew: number;
  totalLeave: number;
  totalAlerts: number;
  avgChurn: number | null;
  overallTargetRate: number | null;
  moshiRate: number | null; // 全社 模試 受験率
  mogiRate: number | null; // 全社 Vもぎ 受験率
  zoukomaRate: number | null; // 全社 増コマ 取得率
  proposalRate: number | null; // 全社 提案 取得率
}

const EMPTY: Overview = {
  rows: [],
  totalActive: 0,
  totalNew: 0,
  totalLeave: 0,
  totalAlerts: 0,
  avgChurn: null,
  overallTargetRate: null,
  moshiRate: null,
  mogiRate: null,
  zoukomaRate: null,
  proposalRate: null,
};

interface MetricRow {
  school_id: string;
  month: number;
  kind: string;
  new_count: number;
  leave_count: number;
  active_count: number;
}

// フォーム参加率の配列から種別ごとの率を引く
function rateOf(parts: { formType: string; rate: number }[], ft: string): number | null {
  const p = parts.find((x) => x.formType === ft);
  return p ? p.rate : null;
}

export async function getOverview(schools: { id: string; name: string }[]): Promise<Overview> {
  const ids = schools.map((s) => s.id);
  if (ids.length === 0) return EMPTY;

  // 在籍（校舎別 active）
  const students = await getStudents(undefined, ids);
  const activeBySchool = new Map<string, number>();
  for (const s of students) {
    if (s.status === 'active')
      activeBySchool.set(s.school_id, (activeBySchool.get(s.school_id) ?? 0) + 1);
  }

  // 月次（校舎別、今年の実績/予算）
  const thisYear = new Date().getFullYear();
  const { data: metricsRaw } = await supabase
    .from('school_monthly_metrics')
    .select('school_id, month, kind, new_count, leave_count, active_count')
    .in('school_id', ids)
    .eq('year', thisYear);
  const metrics = (metricsRaw ?? []) as MetricRow[];
  const metricBySchool = new Map<string, { actual: MetricRow[]; budget: MetricRow[] }>();
  for (const m of metrics) {
    const e = metricBySchool.get(m.school_id) ?? { actual: [], budget: [] };
    (m.kind === 'budget' ? e.budget : e.actual).push(m);
    metricBySchool.set(m.school_id, e);
  }

  // 要対応（校舎別 軽量アラート件数）
  const alertBySchool = new Map<string, number>();
  try {
    const alerts = await getAlertsLight(ids);
    for (const sa of alerts) {
      const sid = sa.school_id ?? '';
      alertBySchool.set(sid, (alertBySchool.get(sid) ?? 0) + sa.alerts.length);
    }
  } catch {
    // アラート取得失敗は0扱い（俯瞰を止めない）
  }

  // 校舎別のフォーム参加率・提案取得率（各校を並列に集計）
  const formBySchool = new Map<
    string,
    {
      moshi: number | null;
      mogi: number | null;
      zoukoma: number | null;
      proposalRate: number | null;
    }
  >();
  await Promise.all(
    schools.map(async (school) => {
      const [parts, funnel] = await Promise.all([
        getFormParticipation([school.id]).catch(() => []),
        getProposalFunnel([school.id]).catch(() => null),
      ]);
      formBySchool.set(school.id, {
        moshi: rateOf(parts, 'moshi'),
        mogi: rateOf(parts, 'mogi'),
        zoukoma: rateOf(parts, 'zoukoma'),
        proposalRate: funnel && funnel.proposedStudents > 0 ? funnel.rate : null,
      });
    })
  );

  // 全社のフォーム参加率・提案取得率
  const [allParts, allFunnel] = await Promise.all([
    getFormParticipation(ids).catch(() => []),
    getProposalFunnel(ids).catch(() => null),
  ]);

  const rows: OverviewRow[] = schools.map((school) => {
    const m = metricBySchool.get(school.id);
    let newCount: number | null = null;
    let leaveCount: number | null = null;
    let netChange: number | null = null;
    let targetRate: number | null = null;
    let churnRate: number | null = null;
    if (m && m.actual.length > 0) {
      const actual = [...m.actual].sort((a, b) => a.month - b.month);
      const last = actual[actual.length - 1];
      const prev = actual.length >= 2 ? actual[actual.length - 2] : null;
      newCount = last.new_count;
      leaveCount = last.leave_count;
      netChange = prev ? last.active_count - prev.active_count : last.new_count - last.leave_count;
      churnRate =
        prev && prev.active_count > 0
          ? Math.round((last.leave_count / prev.active_count) * 1000) / 10
          : null;
      const b = m.budget.find((x) => x.month === last.month);
      targetRate =
        b && b.active_count > 0
          ? Math.round((last.active_count / b.active_count) * 1000) / 10
          : null;
    }
    const f = formBySchool.get(school.id);
    return {
      schoolId: school.id,
      schoolName: school.name,
      activeCount: activeBySchool.get(school.id) ?? 0,
      newCount,
      leaveCount,
      netChange,
      targetRate,
      churnRate,
      alertCount: alertBySchool.get(school.id) ?? 0,
      moshiRate: f?.moshi ?? null,
      mogiRate: f?.mogi ?? null,
      zoukomaRate: f?.zoukoma ?? null,
      proposalRate: f?.proposalRate ?? null,
    };
  });

  const sumNonNull = (arr: (number | null)[]) => arr.reduce<number>((s, v) => s + (v ?? 0), 0);
  const avgNonNull = (arr: (number | null)[]) => {
    const xs = arr.filter((x): x is number => x != null);
    return xs.length > 0 ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null;
  };

  return {
    rows,
    totalActive: rows.reduce((s, r) => s + r.activeCount, 0),
    totalNew: sumNonNull(rows.map((r) => r.newCount)),
    totalLeave: sumNonNull(rows.map((r) => r.leaveCount)),
    totalAlerts: rows.reduce((s, r) => s + r.alertCount, 0),
    avgChurn: avgNonNull(rows.map((r) => r.churnRate)),
    overallTargetRate: avgNonNull(rows.map((r) => r.targetRate)),
    moshiRate: rateOf(allParts, 'moshi'),
    mogiRate: rateOf(allParts, 'mogi'),
    zoukomaRate: rateOf(allParts, 'zoukoma'),
    proposalRate: allFunnel && allFunnel.proposedStudents > 0 ? allFunnel.rate : null,
  };
}
