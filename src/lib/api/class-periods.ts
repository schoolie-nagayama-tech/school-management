/**
 * 授業の時間帯（時限）の共通設定
 * 週回数変更・曜日変更などのフォームで利用する「コード,ラベル」形式のリストを教室ごとに保持
 * マスタ: schedule_time_slots → getActiveTimeSlots で取得し localStorage にキャッシュ
 */

import { getActiveTimeSlots } from '@/lib/api/schedule';
import { formatSlotsForPeriods } from '@/lib/utils/timeSlotDefaults';
import type { ScheduleEntryFormation } from '@/types/schedule';
// Phase A: 形態キーの直書きを定数参照に置換（既定値は個別）
import { INDIVIDUAL_FORMATION } from '@/types/schedule';

export interface ClassPeriodItem {
  code: string;
  label: string;
}

const STORAGE_KEY = (schoolId: string) => `class_periods_${schoolId}`;

/**
 * 教室の授業の時間帯一覧を取得（localStorage キャッシュ → フォールバック空配列）
 * 初回はマスタから取得して保存する getClassPeriodsAsync を使うこと
 */
export function getClassPeriods(schoolId: string | undefined): ClassPeriodItem[] {
  if (!schoolId || typeof window === 'undefined') {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY(schoolId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ClassPeriodItem[];
    if (!Array.isArray(parsed) || parsed.length === 0) return [];
    return parsed.filter((p) => p && typeof p.code === 'string' && typeof p.label === 'string');
  } catch {
    return [];
  }
}

/**
 * コマ時間マスタ(schedule_time_slots)から毎回取得する（localStorageキャッシュを使わない）。
 * フォームがマスタをライブ参照するための取得関数。失敗時は空配列。
 * formation は通塾コマの個別指導枠 'individual' を既定とする。
 */
export async function fetchClassPeriodsLive(
  schoolId: string,
  formation: ScheduleEntryFormation = INDIVIDUAL_FORMATION
): Promise<ClassPeriodItem[]> {
  if (!schoolId) return [];
  try {
    const slots = await getActiveTimeSlots(schoolId, formation);
    return formatSlotsForPeriods(slots);
  } catch {
    return [];
  }
}

/**
 * コマ時間マスタから取得し localStorage にキャッシュして返す
 */
export async function getClassPeriodsAsync(schoolId: string): Promise<ClassPeriodItem[]> {
  const cached = getClassPeriods(schoolId);
  if (cached.length > 0) return cached;
  try {
    // 呼び出し元（曜日変更・週回数変更フォーム等）はいずれも個別指導の通塾コマが前提のため、
    // fetchClassPeriodsLive と同様に既定を個別指導枠にし、集団枠との slot_number 衝突を避ける。
    const slots = await getActiveTimeSlots(schoolId, INDIVIDUAL_FORMATION);
    if (slots.length > 0) {
      const periods = formatSlotsForPeriods(slots);
      setClassPeriods(schoolId, periods);
      return periods;
    }
  } catch {
    /* ignore */
  }
  return [];
}

/**
 * 教室の授業の時間帯一覧を保存
 */
export function setClassPeriods(schoolId: string | undefined, periods: ClassPeriodItem[]): void {
  if (!schoolId || typeof window === 'undefined') return;
  const valid = periods.filter((p) => p && p.code.trim() !== '' && p.label.trim() !== '');
  window.localStorage.setItem(STORAGE_KEY(schoolId), JSON.stringify(valid));
}

/**
 * テキスト形式（1行1時限「コード,ラベル」）をパース
 */
export function parsePeriodsText(text: string): ClassPeriodItem[] {
  return text
    .split('\n')
    .map((line) => {
      const [code, ...rest] = line.split(',');
      const label = rest.join(',').trim() || (code?.trim() ?? '');
      return { code: code?.trim() ?? '', label };
    })
    .filter((p) => p.code !== '');
}

/**
 * ClassPeriodItem[] をテキスト形式に変換
 */
export function formatPeriodsToText(periods: ClassPeriodItem[]): string {
  return periods.map((p) => `${p.code},${p.label}`).join('\n');
}
