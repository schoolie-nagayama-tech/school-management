import type { SeasonType } from '@/types/database';

/** 講習準備ページ（進捗管理・スケジュール）共通のlocalStorageキー */
export const COURSE_PREP_STORAGE_KEY = 'course_prep_season_year';

/** 現在月からデフォルトシーズンを推定 */
export function getDefaultSeason(): SeasonType {
  const month = new Date().getMonth() + 1;
  if (month >= 2 && month <= 5) return 'spring';
  if (month >= 6 && month <= 9) return 'summer';
  return 'winter';
}

/** localStorageからシーズン/年を復元（保存なしの場合は現在の年+デフォルトシーズン） */
export function loadSavedSeasonYear(): { season: SeasonType; year: number } {
  try {
    const raw = localStorage.getItem(COURSE_PREP_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.season && parsed.year) return parsed;
    }
  } catch {
    /* ignore */
  }
  return { season: getDefaultSeason(), year: new Date().getFullYear() };
}

/** シーズン/年をlocalStorageへ保存 */
export function saveSavedSeasonYear(season: SeasonType, year: number): void {
  try {
    localStorage.setItem(COURSE_PREP_STORAGE_KEY, JSON.stringify({ season, year }));
  } catch {
    /* ignore */
  }
}
