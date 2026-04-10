import type { SlotSettingRow } from '@/components/seasonal-shift/ShiftSlotMatrix';

/**
 * 講習期間と時間帯から、デフォルトのスロット設定行を生成する。
 * 日曜は除外、土曜は is_open=false、平日は is_open=true。
 */
export function generateDefaultSlotSettings(
  startDate: string,
  endDate: string,
  timeSlots: string[]
): SlotSettingRow[] {
  const rows: SlotSettingRow[] = [];
  const start = new Date(startDate);
  const end = new Date(endDate);
  const current = new Date(start);
  while (current <= end) {
    const d = new Date(current);
    const day = d.getDay();
    if (day === 0) {
      current.setDate(current.getDate() + 1);
      continue;
    }
    const isOpen = day !== 6; // 土曜は休校、平日は開講
    const dateStr = d.toISOString().slice(0, 10);
    timeSlots.forEach((time_slot) => {
      rows.push({ slot_date: dateStr, time_slot, is_open: isOpen });
    });
    current.setDate(current.getDate() + 1);
  }
  return rows;
}
