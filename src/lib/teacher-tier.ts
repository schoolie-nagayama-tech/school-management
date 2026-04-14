// 講師バッジ数に応じたティア定義
// ヘッダーのメダル + 画面のいくつかの箇所に色味を差し込むために使う。
// 階梯:
//   0:     濃紺 (出発点)
//   1-3:   スレート
//   4-6:   エメラルド / ティール
//   7-9:   パープル / インディゴ (シマー)
//   10-13: ゴールド / アンバー (メタリック)
//   14+:   ゴールド × ローズ × インディゴ (パルス)

export type TierKey = 'zero' | 'slate' | 'emerald' | 'purple' | 'gold' | 'mythic';

export const TIERS: { key: TierKey; threshold: number }[] = [
  { key: 'zero', threshold: 0 },
  { key: 'slate', threshold: 1 },
  { key: 'emerald', threshold: 4 },
  { key: 'purple', threshold: 7 },
  { key: 'gold', threshold: 10 },
  { key: 'mythic', threshold: 14 },
];

export function getTier(count: number): { key: TierKey; threshold: number } {
  return [...TIERS].reverse().find((t) => count >= t.threshold)!;
}

export function getNextTier(count: number): { key: TierKey; threshold: number } | undefined {
  return TIERS.find((t) => t.threshold > count);
}
