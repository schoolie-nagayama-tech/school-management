/**
 * アラートの Light/Heavy 分割のテスト
 *
 * AlertBoard の「再読み込み」は Heavy の種別を入れ替える。その種別は alerts.ts の分割から引く。
 * 以前は画面側に古い写し（成績低下・成績未入力・テスト未更新の3種）があり、Heavy に宿題・遅刻・
 * 講習準備を足した際に取り残された。ここでは分割が ALERT_DEFINITIONS と過不足なく一致することを固定する。
 */
import { describe, it, expect, vi } from 'vitest';

// alerts.ts が supabase クライアントを import するため、生成だけ差し替える。
vi.mock('@/lib/supabase', () => {
  const client = { from: vi.fn() };
  return {
    supabase: client,
    getSupabaseBrowserClient: () => client,
    createSupabaseBrowserClient: () => client,
  };
});

import {
  ALERT_DEFINITIONS,
  HEAVY_ALERT_TYPES,
  LIGHT_ALERT_TYPES,
  isHeavyAlertType,
} from '@/lib/api/alerts';

describe('Light/Heavy の分割', () => {
  it('ALERT_DEFINITIONS の全種別が Light か Heavy のどちらか一方にだけ入る', () => {
    const all = Object.keys(ALERT_DEFINITIONS).sort();
    const split = [...LIGHT_ALERT_TYPES, ...HEAVY_ALERT_TYPES].sort();
    expect(split).toEqual(all);
    expect(LIGHT_ALERT_TYPES.filter((t) => HEAVY_ALERT_TYPES.includes(t))).toEqual([]);
  });

  it('宿題・遅刻・講習準備は Heavy（再読み込みで入れ替わる対象）', () => {
    for (const t of ['homework_not_done', 'tardy', 'course_prep_overdue']) {
      expect(isHeavyAlertType(t)).toBe(true);
    }
  });

  it('isHeavyAlertType は HEAVY_ALERT_TYPES と一致し、未知の種別は false', () => {
    for (const t of Object.keys(ALERT_DEFINITIONS)) {
      expect(isHeavyAlertType(t)).toBe((HEAVY_ALERT_TYPES as readonly string[]).includes(t));
    }
    expect(isHeavyAlertType('unknown_type')).toBe(false);
  });
});
