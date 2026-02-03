/**
 * スロット生成ロジック（GAS移植）
 */

export interface Slot {
  id: string; // yyyyMMdd_code (例: 20260203_5)
  label: string; // M/d(E) + "5限 16:20–17:50" 等
  date: Date;
  period: number; // 4, 5, 6, 7
  dayOfWeek: number; // 0=日, 1=月, ..., 6=土
}

export interface SlotConfig {
  startDate: Date; // 開始日（今日+2日）
  days: number; // 21日分
}

/**
 * スロット生成
 * @param startDate 開始日（省略時は今日+2日）
 * @param days 生成日数（デフォルト21日）
 */
export function generateSlots(startDate?: Date, days: number = 21): Slot[] {
  const start = startDate || addDays(new Date(), 2);
  const slots: Slot[] = [];

  for (let i = 0; i < days; i++) {
    const date = addDays(start, i);
    const dayOfWeek = date.getDay();

    // 日曜はスロットなし
    if (dayOfWeek === 0) continue;

    // 土曜: 4,5,6,7限
    // 平日: 5,6,7限
    const periods = dayOfWeek === 6 ? [4, 5, 6, 7] : [5, 6, 7];

    periods.forEach((period) => {
      const slotId = formatSlotId(date, period);
      const label = formatSlotLabel(date, period);
      slots.push({
        id: slotId,
        label,
        date: new Date(date),
        period,
        dayOfWeek,
      });
    });
  }

  return slots;
}

/**
 * 日付に日数を加算
 */
function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * スロットIDを生成（yyyyMMdd_code）
 */
function formatSlotId(date: Date, period: number): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}_${period}`;
}

/**
 * スロットラベルを生成（M/d(E) + "5限 16:20–17:50" 等）
 */
function formatSlotLabel(date: Date, period: number): string {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
  const dayName = dayNames[date.getDay()];

  // 時限と時間のマッピング
  const periodTimes: Record<number, string> = {
    4: '4限 14:30–16:00',
    5: '5限 16:20–17:50',
    6: '6限 18:10–19:40',
    7: '7限 20:00–21:30',
  };

  const time = periodTimes[period] || `${period}限`;

  return `${month}/${day}(${dayName}) ${time}`;
}

/**
 * スロットを日付と時限でグループ化
 */
export function groupSlotsByDate(slots: Slot[]): Map<string, Slot[]> {
  const grouped = new Map<string, Slot[]>();

  slots.forEach((slot) => {
    const dateKey = formatDateKey(slot.date);
    if (!grouped.has(dateKey)) {
      grouped.set(dateKey, []);
    }
    grouped.get(dateKey)!.push(slot);
  });

  return grouped;
}

/**
 * 日付キーを生成（yyyy-MM-dd）
 */
function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 時限でグループ化（4,5,6,7）
 */
export function groupSlotsByPeriod(slots: Slot[]): Map<number, Slot[]> {
  const grouped = new Map<number, Slot[]>();

  slots.forEach((slot) => {
    if (!grouped.has(slot.period)) {
      grouped.set(slot.period, []);
    }
    grouped.get(slot.period)!.push(slot);
  });

  return grouped;
}
