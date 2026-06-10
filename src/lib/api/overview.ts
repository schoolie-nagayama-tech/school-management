import { supabase } from '../supabase';
import { getStudents } from './students';
import { getAlertsLight } from './alerts';

/**
 * 全教室 俯瞰ダッシュボード用：校舎別の主要KPIを集計する。
 * マネージャー以上が「すべての教室」を選んだときに使う。
 * - 在籍数 / 要対応件数: 全校データから集計（必ず出る）
 * - 前月純増 / 予実達成% / 退会率: school_monthly_metrics 投入済みの校のみ（未投入は null = 「—」表示）
 */

export interface OverviewRow {
  schoolId: string;
  schoolName: string;
  activeCount: number;
  netChange: number | null; // 前月純増（月末在籍の前月差）
  targetRate: number | null; // 予実達成%（最新実績月 / 同月予算）
  churnRate: number | null; // 退会率%（最新月の休会/前月在籍）
  alertCount: number; // 要対応(軽量アラート)件数
}

export interface Overview {
  rows: OverviewRow[];
  totalActive: number;
  totalAlerts: number;
  avgChurn: number | null;
  overallTargetRate: number | null;
}

const EMPTY: Overview = { rows: [], totalActive: 0, totalAlerts: 0, avgChurn: null, overallTargetRate: null };

interface MetricRow {
  school_id: string;
  month: number;
  kind: string;
  new_count: number;
  leave_count: number;
  active_count: number;
}

export async function getOverview(schools: { id: string; name: string }[]): Promise<Overview> {
  const ids = schools.map((s) => s.id);
  if (ids.length === 0) return EMPTY;

  // 在籍（校舎別 active）
  const students = await getStudents(undefined, ids);
  const activeBySchool = new Map<string, number>();
  for (const s of students) {
    if (s.status === 'active') activeBySchool.set(s.school_id, (activeBySchool.get(s.school_id) ?? 0) + 1);
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

  const rows: OverviewRow[] = schools.map((school) => {
    const m = metricBySchool.get(school.id);
    let netChange: number | null = null;
    let targetRate: number | null = null;
    let churnRate: number | null = null;
    if (m && m.actual.length > 0) {
      const actual = [...m.actual].sort((a, b) => a.month - b.month);
      const last = actual[actual.length - 1];
      const prev = actual.length >= 2 ? actual[actual.length - 2] : null;
      netChange = prev ? last.active_count - prev.active_count : last.new_count - last.leave_count;
      churnRate = prev && prev.active_count > 0 ? Math.round((last.leave_count / prev.active_count) * 1000) / 10 : null;
      const b = m.budget.find((x) => x.month === last.month);
      targetRate = b && b.active_count > 0 ? Math.round((last.active_count / b.active_count) * 1000) / 10 : null;
    }
    return {
      schoolId: school.id,
      schoolName: school.name,
      activeCount: activeBySchool.get(school.id) ?? 0,
      netChange,
      targetRate,
      churnRate,
      alertCount: alertBySchool.get(school.id) ?? 0,
    };
  });

  const totalActive = rows.reduce((s, r) => s + r.activeCount, 0);
  const totalAlerts = rows.reduce((s, r) => s + r.alertCount, 0);
  const churns = rows.map((r) => r.churnRate).filter((x): x is number => x != null);
  const avgChurn = churns.length > 0 ? Math.round((churns.reduce((a, b) => a + b, 0) / churns.length) * 10) / 10 : null;
  const tRates = rows.map((r) => r.targetRate).filter((x): x is number => x != null);
  const overallTargetRate =
    tRates.length > 0 ? Math.round((tRates.reduce((a, b) => a + b, 0) / tRates.length) * 10) / 10 : null;

  return { rows, totalActive, totalAlerts, avgChurn, overallTargetRate };
}
