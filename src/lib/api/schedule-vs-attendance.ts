// スケジュールと出勤簿の照合用 API
//
// 「勤怠チェック画面」で、講師の出勤簿（自己申告）と座席表（実態）を並列表示して
// 室長が差分を目視チェックするための集計関数。
//
// 連携方針：自動転記は一切しない。スケジュール側のコマ数を「参考値」として表示するのみ。
// 室長が「実態と合うか」をチェックし、必要なら差し戻しで講師に修正依頼する。

import { supabase } from '@/lib/supabase';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface ScheduleCountsByDate {
  /** 'YYYY-MM-DD' → コマ数 */
  byDate: Map<string, number>;
  /** 種別別（regular / koushu）の小計 */
  byDateByKind: Map<string, { regular: number; koushu: number }>;
  /** 月合計 */
  totalRegular: number;
  totalKoushu: number;
}

/**
 * 指定講師の指定月のスケジュール集計を返す。
 *
 * 集計対象：
 *   - 'scheduled', 'completed', 'transferred_in' の3ステータス
 *   - 'cancelled' と 'transferred_out' は除外（実授業として成立していないため）
 *
 * 個別/集団どちらも1コマとして数える（出勤簿の「通常授業」「特別講習」と直接突き合わせる用途）。
 * 後で attendance_type マッピング設定が入ったら、kind→type 対応で詳細集計に拡張できる。
 *
 * @param schoolId 教室ID
 * @param teacherId 講師の user_profiles.id
 * @param yearMonth 'YYYY-MM' 形式（例: '2026-07'）
 */
export async function getScheduleCountsByMonth(
  schoolId: string,
  teacherId: string,
  yearMonth: string
): Promise<ScheduleCountsByDate> {
  const [yearStr, monthStr] = yearMonth.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const fromStr = `${yearStr}-${monthStr}-01`;
  // 月末日：翌月の0日 = 当月の末日
  const lastDate = new Date(year, month, 0);
  const toStr = `${yearStr}-${monthStr}-${String(lastDate.getDate()).padStart(2, '0')}`;

  const { data, error } = await db
    .from('schedule_entries')
    .select('entry_date, kind, status')
    .eq('school_id', schoolId)
    .eq('teacher_id', teacherId)
    .gte('entry_date', fromStr)
    .lte('entry_date', toStr)
    .in('status', ['scheduled', 'completed', 'transferred_in']);

  if (error) {
    console.error('Error fetching schedule counts:', error);
    throw new Error('スケジュール集計の取得に失敗しました');
  }

  const byDate = new Map<string, number>();
  const byDateByKind = new Map<string, { regular: number; koushu: number }>();
  let totalRegular = 0;
  let totalKoushu = 0;

  for (const row of (data || []) as Array<{ entry_date: string; kind: 'regular' | 'koushu'; status: string }>) {
    byDate.set(row.entry_date, (byDate.get(row.entry_date) ?? 0) + 1);
    const existing = byDateByKind.get(row.entry_date) ?? { regular: 0, koushu: 0 };
    if (row.kind === 'koushu') {
      existing.koushu += 1;
      totalKoushu += 1;
    } else {
      existing.regular += 1;
      totalRegular += 1;
    }
    byDateByKind.set(row.entry_date, existing);
  }

  return { byDate, byDateByKind, totalRegular, totalKoushu };
}
