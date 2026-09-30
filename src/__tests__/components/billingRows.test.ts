/**
 * 生徒ハブ「請求項目の計上」の行の作り方（src/components/students/hub/billingRows.ts）のテスト。
 * /billing の BillingTable.tsx のセル表示と同じ意味で「計上済み・未計上・無し」を分けること。
 */
import { describe, it, expect } from 'vitest';
import {
  buildHubBillingRows,
  pickHubBillingPeriod,
  toHubBillingRow,
} from '@/components/students/hub/billingRows';
import type { BillingItem, StudentBilling } from '@/types/database';

function item(partial: Partial<BillingItem>): BillingItem {
  return {
    id: 'i',
    school_id: 'sc',
    billing_period_id: 'p',
    name: '項目',
    source_type: 'free',
    source_form_response_id: null,
    source_order_id: null,
    value_type: 'check',
    linked_form_type: null,
    sort_order: 0,
    is_active: true,
    created_at: '',
    updated_at: '',
    ...partial,
  };
}

function billing(partial: Partial<StudentBilling>): StudentBilling {
  return {
    id: 'b',
    school_id: 'sc',
    student_id: 's',
    billing_item_id: 'i',
    is_billed: false,
    quantity: null,
    value_number: null,
    value_text: null,
    created_at: '',
    updated_at: '',
    ...partial,
  };
}

describe('toHubBillingRow', () => {
  it('check: 計上済みは billed、付けていなければ none（黄色にしない）', () => {
    expect(toHubBillingRow(item({}), billing({ is_billed: true })).state).toBe('billed');
    expect(toHubBillingRow(item({}), undefined).state).toBe('none');
    // quantity>0 は計上済み扱い（請求管理でもコマ数を緑で出している）
    expect(toHubBillingRow(item({}), billing({ quantity: 3 }))).toMatchObject({
      state: 'billed',
      value: '3',
    });
  });

  it('number: 値があって未計上なら pending、計上済みなら billed、値が無ければ none', () => {
    const n = item({ value_type: 'number', source_type: 'order' });
    expect(toHubBillingRow(n, billing({ value_number: 2 }))).toMatchObject({
      state: 'pending',
      value: '2',
    });
    expect(toHubBillingRow(n, billing({ value_number: 2, is_billed: true })).state).toBe('billed');
    expect(toHubBillingRow(n, billing({ value_number: 0 })).state).toBe('none');
  });

  it('フォーム連携の number: 計上済み(quantity)と未計上(value_number)の内訳で判定する', () => {
    const f = item({ value_type: 'number', linked_form_type: 'zoukoma' });
    expect(toHubBillingRow(f, billing({ quantity: 4, value_number: 0 }))).toMatchObject({
      state: 'billed',
      value: '4',
    });
    expect(toHubBillingRow(f, billing({ quantity: 4, value_number: 2 }))).toMatchObject({
      state: 'pending',
      value: '2（計上済 4）',
    });
    expect(toHubBillingRow(f, billing({ quantity: 0, value_number: 0 })).state).toBe('none');
  });

  it('text: 値があって未計上なら pending、空なら none', () => {
    const t = item({ value_type: 'text' });
    expect(toHubBillingRow(t, billing({ value_text: 'メモ' }))).toMatchObject({
      state: 'pending',
      value: 'メモ',
    });
    expect(toHubBillingRow(t, billing({ value_text: '' })).state).toBe('none');
  });
});

describe('buildHubBillingRows', () => {
  it('項目の並びを保ち、この生徒に計上するものが無い項目は落とす', () => {
    const rows = buildHubBillingRows(
      [item({ id: 'a', name: 'A' }), item({ id: 'b', name: 'B' }), item({ id: 'c', name: 'C' })],
      [
        billing({ billing_item_id: 'c', is_billed: true }),
        billing({ billing_item_id: 'a', is_billed: true }),
      ]
    );
    expect(rows.map((r) => r.name)).toEqual(['A', 'C']);
  });
});

describe('pickHubBillingPeriod', () => {
  it('有効な期間があればその中の先頭、無ければ先頭、空なら null', () => {
    expect(
      pickHubBillingPeriod([
        { id: 'new', is_active: false },
        { id: 'act', is_active: true },
      ])?.id
    ).toBe('act');
    expect(pickHubBillingPeriod([{ id: 'new', is_active: false }])?.id).toBe('new');
    expect(pickHubBillingPeriod([])).toBeNull();
  });
});
