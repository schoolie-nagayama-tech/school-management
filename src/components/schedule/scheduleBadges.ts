/**
 * 座席表の「種別バッジ」色の単一ソース。
 * StudentCard（座席カード）と ScheduleLegend（凡例）が同じ定義を参照するための共有モジュール。
 */
import type { ScheduleEntryKind } from '@/types/schedule';
import { isExtraLessonKind } from '@/types/schedule';

/** 追加授業（単発コマ）の種別バッジ色。通常授業と一目で区別するため。 */
export const EXTRA_KIND_BADGE: Record<string, string> = {
  test_prep: 'bg-warning text-white',
  additional: 'bg-ink text-white',
  trial: 'bg-success text-white',
};

/** 追加授業の種別バッジ class（該当しない kind は空文字） */
export function extraKindBadgeClass(kind: ScheduleEntryKind): string {
  if (!isExtraLessonKind(kind)) return '';
  return EXTRA_KIND_BADGE[kind] ?? 'bg-ink text-white';
}
