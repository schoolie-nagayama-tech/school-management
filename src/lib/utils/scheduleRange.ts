/**
 * 準備スケジュール（工程表）ガントチャートの表示期間。
 *
 * 既定はシーズンごとの固定期間だが、それだけだとタスクの日付が枠外に出たとき
 * バーが見えなくなる（枠の長さが固定なので、はみ出した分は存在しないのと同じになる）。
 * タスクの日付を取り込んで枠を伸ばし、少なくとも全タスクが収まるようにする。
 *
 * 縮める側はやらない。undated なタスクの期間をチャート上のドラッグで引けるようにしてあり、
 * 枠を狭めるとドラッグできる範囲まで一緒に狭まってしまうため。
 */

/** シーズンごとの既定期間（準備開始月～講習終了月）。タスクが無いときはこれがそのまま枠になる。 */
export function getSeasonBaseRange(
  season: 'spring' | 'summer' | 'winter',
  year: number
): { start: Date; end: Date } {
  switch (season) {
    case 'spring':
      // 1月中旬～4月上旬 → 1月～4月
      return { start: new Date(year, 0, 1), end: new Date(year, 3, 30) };
    case 'summer':
      // 4月中旬～7月上旬 → 4月～8月
      return { start: new Date(year, 3, 1), end: new Date(year, 7, 31) };
    case 'winter':
      // 10月～翌1月
      return { start: new Date(year, 9, 1), end: new Date(year + 1, 0, 31) };
    default:
      return { start: new Date(year, 0, 1), end: new Date(year, 3, 30) };
  }
}

/** 'YYYY-MM-DD' をローカルタイムゾーンの Date にする（UTC解釈による1日ズレを避ける） */
function toLocalDate(dateStr: string): Date | null {
  const d = new Date(dateStr + 'T00:00:00');
  return Number.isNaN(d.getTime()) ? null : d;
}

/** その月の1日 */
function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/** その月の末日 */
function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

/** 表示期間の計算に使うタスクの形（ガントが持っている情報の部分集合） */
export type ScheduleRangeTask = {
  start_date?: string | null;
  end_date?: string | null;
  markers?: { marker_date: string }[];
};

/**
 * ガントの表示期間を求める。
 *
 * シーズンの既定期間に、全タスクの日付（開始日・終了日・マーカー日）を含むよう枠を広げる。
 * 月の境界に丸めるので、月ヘッダーが半端な位置から始まらない。
 * 日付を持つタスクが1つも無ければ既定期間をそのまま返す。
 */
export function getScheduleFullRange(
  season: 'spring' | 'summer' | 'winter',
  year: number,
  tasks: ScheduleRangeTask[] = []
): { start: Date; end: Date } {
  const base = getSeasonBaseRange(season, year);

  const dates: Date[] = [];
  for (const t of tasks) {
    for (const s of [t.start_date, t.end_date]) {
      if (!s) continue;
      const d = toLocalDate(s);
      if (d) dates.push(d);
    }
    // マーカーも枠外だと表示されないので範囲に含める
    for (const m of t.markers ?? []) {
      const d = toLocalDate(m.marker_date);
      if (d) dates.push(d);
    }
  }

  if (dates.length === 0) return base;

  let min = base.start;
  let max = base.end;
  for (const d of dates) {
    if (d < min) min = d;
    if (d > max) max = d;
  }

  return { start: startOfMonth(min), end: endOfMonth(max) };
}

/** 2つの期間が同じか（自動計算した枠と現在の枠を比べて「全体表示中」を判定するのに使う） */
export function isSameRange(a: { start: Date; end: Date }, b: { start: Date; end: Date }): boolean {
  return a.start.getTime() === b.start.getTime() && a.end.getTime() === b.end.getTime();
}
