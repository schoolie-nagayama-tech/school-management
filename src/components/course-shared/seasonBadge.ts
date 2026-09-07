import type { SeasonType } from '@/types/database';

/**
 * 季節（春期・夏期・冬期）のバッジ色と並び順の唯一の定義。
 *
 * 一覧・詳細・適用の3画面で同じ色を別々に書いていたため、片方だけ直すと
 * 画面ごとに色が食い違う状態になっていた。色は必ずここを参照する。
 * 表示ラベルは @/types/database の SEASON_LABELS が正典なので、ここでは再定義しない。
 */
export const SEASON_COLORS: Record<SeasonType, string> = {
  spring: 'bg-pink-100 text-pink-700',
  summer: 'bg-sky-100 text-sky-700',
  winter: 'bg-slate-100 text-slate-600',
};

/** 季節の並び順（春→夏→冬）。ソートの比較に使う。 */
export const SEASON_ORDER: Record<SeasonType, number> = { spring: 0, summer: 1, winter: 2 };
