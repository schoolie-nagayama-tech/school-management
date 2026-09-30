import type { BillingItem, StudentBilling } from '@/types/database';

/**
 * 生徒ハブ「請求項目の計上」の1行。
 *   billed  = 計上済み（もう手を離れている）
 *   pending = 値はあるのに未計上（対応が要る。ここだけ黄色）
 *   none    = この生徒には計上するものが無い（表に出さない）
 */
export type HubBillingState = 'billed' | 'pending' | 'none';

export interface HubBillingRow {
  itemId: string;
  name: string;
  state: HubBillingState;
  /** 数量・値の表示。無ければ null（「—」を出す） */
  value: string | null;
}

/**
 * 計上済み(quantity)/未計上(value_number)の内訳で持つ項目か。
 * ★/billing の BillingTable.tsx の usesChargedSplit（と isCourseExtraItem / isSpecialCourseItem）を
 *   number 型の範囲で書き写したもの。判定を変えるときは両方を直すこと。ずれると、請求管理では
 *   計上済みなのにハブでは未計上（またはその逆）と出る。
 */
function usesChargedSplit(item: BillingItem, billing: StudentBilling | undefined): boolean {
  if (billing?.quantity == null) return false;
  if (item.linked_form_type) return true;
  if (item.name.includes('講習') || item.name.includes('特別講座')) return true;
  return item.source_type !== 'order';
}

/**
 * 請求項目1つとこの生徒の請求行から、表の1行を作る。
 * 「計上済みか」「値があるか」の判定は /billing の BillingTable.tsx のセル表示と同じ意味にしてある
 * （check=is_billed か quantity>0、number/text=値があって is_billed か）。
 * ★NESTは金額を持たない（請求は本部システム）。ここで出すのは計上の有無と数量・値だけ。
 */
export function toHubBillingRow(
  item: BillingItem,
  billing: StudentBilling | undefined
): HubBillingRow {
  const base = { itemId: item.id, name: item.name };
  const valueType = item.value_type || 'check';

  if (valueType === 'number') {
    if (usesChargedSplit(item, billing)) {
      const charged = billing?.quantity ?? 0;
      const pending = billing?.value_number ?? 0;
      if (charged + pending === 0) return { ...base, state: 'none', value: null };
      if (pending > 0) {
        // 一部だけ計上済みのときは、未計上の数を主に出し、計上済みの数を添える
        return {
          ...base,
          state: 'pending',
          value: charged > 0 ? `${pending}（計上済 ${charged}）` : String(pending),
        };
      }
      return { ...base, state: 'billed', value: String(charged) };
    }
    const hasValue = billing?.value_number != null && billing.value_number !== 0;
    if (!hasValue) return { ...base, state: 'none', value: null };
    return {
      ...base,
      state: billing?.is_billed ? 'billed' : 'pending',
      value: String(billing?.value_number),
    };
  }

  if (valueType === 'text') {
    const hasValue = billing?.value_text != null && billing.value_text !== '';
    if (!hasValue) return { ...base, state: 'none', value: null };
    return {
      ...base,
      state: billing?.is_billed ? 'billed' : 'pending',
      value: billing?.value_text ?? null,
    };
  }

  // check 型: 請求管理でも未チェックは空欄（黄色にしない）。付けていない＝この生徒には無い項目なので出さない
  const hasQuantity = billing?.quantity != null && billing.quantity > 0;
  if (billing?.is_billed === true || hasQuantity) {
    return { ...base, state: 'billed', value: hasQuantity ? String(billing?.quantity) : null };
  }
  return { ...base, state: 'none', value: null };
}

/**
 * 表に出す行を作る。項目の並び（sort_order）はそのまま、計上するものが無い項目は落とす。
 * ★全項目を並べると、生徒に関係の無い項目がずらりと「—」で並び、未計上が埋もれる。
 */
export function buildHubBillingRows(
  items: BillingItem[],
  billings: StudentBilling[]
): HubBillingRow[] {
  const byItem = new Map(billings.map((b) => [b.billing_item_id, b]));
  return items
    .map((item) => toHubBillingRow(item, byItem.get(item.id)))
    .filter((r) => r.state !== 'none');
}

/**
 * ハブに出す請求期間を1つ選ぶ。periods は getBillingPeriods の並び（開始日の新しい順）を前提にする。
 * 有効（is_active）な期間があればその中で一番新しいもの、無ければ一番新しい期間。
 * ★/billing は開いたとき先頭（一番新しい期間）を選ぶ。有効な期間を優先するのはハブだけの決め
 *   （2026-09-30 の指示。無効にした期間より、いま使っている期間を出す）。
 */
export function pickHubBillingPeriod<T extends { is_active: boolean }>(periods: T[]): T | null {
  return periods.find((p) => p.is_active) ?? periods[0] ?? null;
}
