/**
 * NEST の季節講習シフト提出 → スクールIE(M Planning「講習会契約設定」)への自動入力ヘルパー。
 *
 * スクールIEの契約設定グリッドは、日付×時限ごとに name="BASE_YYYYMMDD_{時限index}" の
 * チェックボックスを持つプレーンHTMLフォーム。ここでは出勤可能スロットを「チェックすべき name 一覧」に
 * 変換するだけを担う。実際の流し込みは共通ローダー(src/lib/automation/actions.ts)が actions として実行する。
 *
 * 時限indexは永山校のスクールIE画面実物から確認した対応:
 *   HALLO① 15:10-16:00 → 7 / HALLO② 16:10-17:00 → 8 / HALLO③ 18:10-19:30 → 9
 *   3限 12:50-14:20 → 12 / 4限 14:25-15:55 → 13 / 5限 16:20-17:50 → 14
 *   6限 17:55-19:25 → 15 / 7限 19:30-21:00 → 16
 * NESTの季節講習の時間帯(time_slot, "HH:MM-HH:MM")をこの表で引き、一致しないものは除外(skipped)する。
 * ※ この時刻表は永山校の時限定義に依存する。別校舎で時刻が異なる場合は skipped に出るので要確認。
 */

/** スクールIE の時限時刻文字列 → チェックボックス name のindexサフィックス。 */
export const SCHOOLIE_TIME_SLOT_INDEX: Record<string, number> = {
  '15:10-16:00': 7, // HALLO①
  '16:10-17:00': 8, // HALLO②
  '18:10-19:30': 9, // HALLO③
  '12:50-14:20': 12, // 3限
  '14:25-15:55': 13, // 4限
  '16:20-17:50': 14, // 5限
  '17:55-19:25': 15, // 6限
  '19:30-21:00': 16, // 7限
};

/** シフト提出スロットの最小形（available な日付×時間帯）。 */
export interface ShiftSlotLike {
  shift_date: string; // 'YYYY-MM-DD'
  time_slot: string; // 'HH:MM-HH:MM'
  available: boolean;
}

export interface SchoolieCheckboxResult {
  /** チェックすべきチェックボックス name 一覧（BASE_YYYYMMDD_idx）。 */
  names: string[];
  /** 対応表に無く除外した time_slot の一覧（重複除去）。空ならすべて変換できた。 */
  skipped: string[];
}

/**
 * available なスロットを スクールIE のチェックボックス name 配列に変換する。
 * 対応表に無い time_slot は names に含めず skipped に記録する（黙って落とさない）。
 */
export function buildSchoolieCheckboxNames(slots: ShiftSlotLike[]): SchoolieCheckboxResult {
  const names: string[] = [];
  const skippedSet = new Set<string>();
  for (const s of slots) {
    if (!s.available) continue;
    const idx = SCHOOLIE_TIME_SLOT_INDEX[s.time_slot];
    if (idx == null) {
      skippedSet.add(s.time_slot);
      continue;
    }
    const ymd = s.shift_date.replace(/-/g, '');
    names.push(`BASE_${ymd}_${idx}`);
  }
  // 安定した並びに（日付→index）
  names.sort();
  return { names, skipped: Array.from(skippedSet) };
}
