/**
 * 講習申込フォーム（保護者向け）の表示専用ヘルパー。
 *
 * 正典仕様: docs/koushu-auto-allocation-spec.md 第2部。見た目・挙動の設計図は
 * モック `src/app/schedule/koushu/apply-mock/page.tsx`（週アコーディオン＝案B）。
 * ここに置くのは純粋な表示計算のみ。DB・API呼び出しは持ち込まない
 * （KoushuApplyForm.tsx とその配下のステップコンポーネントから使う）。
 */

export const WEEKDAY = ['日', '月', '火', '水', '木', '金', '土'] as const;

/** 円表記（税込）。カンマ区切り＋¥記号 */
export function yen(n: number): string {
  return `¥${n.toLocaleString()}`;
}

/** 通える日マトリクスのセルキー。日付×時間帯の一意な識別子 */
export function cellKey(date: string, timeSlot: string): string {
  return `${date}_${timeSlot}`;
}

/** "YYYY-MM-DD" → "M/D" */
export function mmdd(date: string): string {
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
}

/** "YYYY-MM-DD" の曜日（0=日〜6=土）。正午基準でタイムゾーンのずれによる日付誤認を避ける */
export function dow(date: string): number {
  return new Date(`${date}T12:00:00`).getDay();
}

/** "HH:MM-HH:MM" → 開始時刻のみ（列見出し用に短く出す） */
export function timeSlotLabel(timeSlot: string): string {
  const [start] = timeSlot.split('-');
  return start ?? timeSlot;
}

export interface WeekGroup {
  label: string;
  dates: string[];
}

/**
 * 開講日を週（月曜始まり）で区切る（案B: 週アコーディオン）。
 * 日付は昇順ソート済みを渡すこと。月曜に当たるたびに新しい週を開始する。
 */
export function groupByWeek(dates: string[]): WeekGroup[] {
  const weeks: WeekGroup[] = [];
  let cur: string[] = [];
  for (const d of dates) {
    if (dow(d) === 1 && cur.length > 0) {
      weeks.push({ label: `${mmdd(cur[0])}〜${mmdd(cur[cur.length - 1])}`, dates: cur });
      cur = [];
    }
    cur.push(d);
  }
  if (cur.length > 0) {
    weeks.push({ label: `${mmdd(cur[0])}〜${mmdd(cur[cur.length - 1])}`, dates: cur });
  }
  return weeks;
}

/**
 * 直前の週の最終日と次の週の初日の間に空いた休講期間を返す（お盆など。無ければ null）。
 * 日曜だけの隙間は毎週あるので出さない。2日以上空いたときだけ休講期間とみなす。
 */
export function gapBetween(
  prevLast: string,
  nextFirst: string
): { from: string; to: string } | null {
  const from = new Date(`${prevLast}T12:00:00`);
  from.setDate(from.getDate() + 1);
  const to = new Date(`${nextFirst}T12:00:00`);
  to.setDate(to.getDate() - 1);
  if (from > to) return null;
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
  if (days < 2) return null;
  return { from: iso(from), to: iso(to) };
}
