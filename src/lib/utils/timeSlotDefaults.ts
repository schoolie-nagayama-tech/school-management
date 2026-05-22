import type { ScheduleTimeSlot } from '@/types/schedule';

/** コマ時間マスタからシフト設定用の時間帯文字列を生成（"12:50-14:20,14:25-15:55,..."） */
export function formatSlotsForShift(slots: ScheduleTimeSlot[]): string {
  return slots
    .map((s) => `${s.start_time.slice(0, 5)}-${s.end_time.slice(0, 5)}`)
    .join(',');
}

/** コマ時間マスタからフォーム用の時限アイテムを生成 */
export function formatSlotsForPeriods(
  slots: ScheduleTimeSlot[]
): { code: string; label: string }[] {
  return slots.map((s) => ({
    code: String(s.slot_number),
    label: `${s.slot_number}限(${s.start_time.slice(0, 5)}-${s.end_time.slice(0, 5)})`,
  }));
}
