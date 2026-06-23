/**
 * 5週目自動計算ユーティリティ
 *
 * ある月で5回ある曜日を特定し、生徒の通塾日程から
 * その曜日に何コマあるかを計算する。
 */

/**
 * 指定月で5回出現する曜日を返す
 * @param year 年
 * @param month 月 (1-12)
 * @returns 5回出現する曜日の配列 (1=月, 2=火, ..., 6=土, 0=日)
 *
 * 例: 2026年5月 → 金曜日が5回 → [5]
 */
export function getFifthWeekDays(year: number, month: number): number[] {
  const daysInMonth = new Date(year, month, 0).getDate();
  const dayCounts: Record<number, number> = {};

  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month - 1, d);
    const dow = date.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
    // Convert to our format: 1=Mon, 2=Tue, ..., 6=Sat, 0=Sun
    dayCounts[dow] = (dayCounts[dow] || 0) + 1;
  }

  return Object.entries(dayCounts)
    .filter(([, count]) => count >= 5)
    .map(([dow]) => Number(dow));
}

// Note: schedule_regular_patterns uses day_of_week: 1=Mon, 2=Tue, ..., 6=Sat
// JavaScript Date.getDay() uses: 0=Sun, 1=Mon, ..., 6=Sat
// These happen to match for Mon-Sat (1-6), only Sunday differs (0 vs 7)
// Since Sunday lessons are unlikely in a cram school, this should be fine.

/**
 * 5週目のある曜日をラベルで返す（表示用）
 */
export function getFifthWeekDayLabels(year: number, month: number): string {
  const DAY_LABELS: Record<number, string> = {
    0: '日',
    1: '月',
    2: '火',
    3: '水',
    4: '木',
    5: '金',
    6: '土',
  };
  const days = getFifthWeekDays(year, month);
  return days.map((d) => DAY_LABELS[d]).join('・');
}

/**
 * 生徒ごとの5週目コマ数を計算
 * @param patterns 通塾日程（全生徒分）
 * @param fifthWeekDows 5回出現する曜日の配列 (JS Date.getDay format: 0=Sun, 1=Mon, ..., 6=Sat)
 * @returns Map<studentId, slotCount>
 */
export function calcFifthWeekSlots(
  patterns: Array<{ student_id: string; day_of_week: number; is_active: boolean }>,
  fifthWeekDows: number[]
): Map<string, number> {
  const result = new Map<string, number>();

  // Only active regular patterns
  const activePatterns = patterns.filter((p) => p.is_active);

  for (const pattern of activePatterns) {
    // schedule_regular_patterns.day_of_week: 1=Mon..6=Sat
    // This matches JS getDay() for Mon-Sat
    if (fifthWeekDows.includes(pattern.day_of_week)) {
      const current = result.get(pattern.student_id) || 0;
      result.set(pattern.student_id, current + 1);
    }
  }

  return result;
}
