import { supabase } from '../supabase';

/**
 * 教室の月次経営指標（在籍トレンド・予実・増減）の取得。
 * school_monthly_metrics テーブル（実績/予算）を「正」として読む。
 * 複数校が指定された場合は year×month×kind で合算する（'all' 選択時の全校集計）。
 */

export type MetricKind = 'actual' | 'budget';

export interface MonthlyMetricPoint {
  year: number;
  month: number;
  kind: MetricKind;
  newCount: number; // 入会数
  leaveCount: number; // 休会数（在籍減の要因）
  activeCount: number; // 月末在籍数
}

/**
 * 指定教室・指定年の月次指標を取得。複数校は同一 年月×種別 で合算。
 * テーブル未作成やデータ未投入時は空配列を返す（呼び出し側でダミーにフォールバック可能）。
 */
export async function getSchoolMonthlyMetrics(
  schoolIds: string[],
  years: number[]
): Promise<MonthlyMetricPoint[]> {
  if (schoolIds.length === 0 || years.length === 0) return [];

  const { data, error } = await supabase
    .from('school_monthly_metrics')
    .select('year, month, kind, new_count, leave_count, active_count')
    .in('school_id', schoolIds)
    .in('year', years);

  if (error) {
    // マイグレーション未適用などはダミー表示に委ねるため、握りつぶして空を返す
    console.warn(
      'school_monthly_metrics の取得に失敗（マイグレーション未適用の可能性）:',
      error.message
    );
    return [];
  }

  // 複数校を 年月×種別 で合算
  const merged = new Map<string, MonthlyMetricPoint>();
  for (const row of data ?? []) {
    const key = `${row.year}-${row.month}-${row.kind}`;
    const cur = merged.get(key) ?? {
      year: row.year,
      month: row.month,
      kind: row.kind as MetricKind,
      newCount: 0,
      leaveCount: 0,
      activeCount: 0,
    };
    cur.newCount += row.new_count;
    cur.leaveCount += row.leave_count;
    cur.activeCount += row.active_count;
    merged.set(key, cur);
  }
  return Array.from(merged.values());
}
