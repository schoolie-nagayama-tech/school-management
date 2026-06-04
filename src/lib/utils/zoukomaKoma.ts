import type { ZoukomaResponseData } from '@/types/forms/zoukoma';

/**
 * 増コマ（zoukoma）1回答あたりの請求コマ数を算出する。
 *
 * 増コマは「1回答 = 1件」ではなく「1回答 = 申込コマ数」を請求数として扱うため、
 * response_data.total_koma（合計コマ数）を採用する。
 * 欠損時は subjects のコマ数合計 → 最低1 にフォールバックする。
 *
 * 請求の自動同期（回答紐付け時 / ポータル投稿時）と
 * 一括同期（syncFormToBilling）で同じロジックを使うために共通化している。
 */
export function zoukomaKomaCount(responseData: unknown): number {
  const rd = (responseData || {}) as Partial<ZoukomaResponseData>;
  if (typeof rd.total_koma === 'number' && rd.total_koma > 0) return rd.total_koma;
  if (rd.subjects && typeof rd.subjects === 'object') {
    const sum = Object.values(rd.subjects).reduce((a, b) => a + (Number(b) || 0), 0);
    if (sum > 0) return sum;
  }
  return 1;
}
