/**
 * 通塾日程v2の公開ゲートのテスト。
 *
 * ★ なぜ要るか: 座席表の運用開始までは講師・教室長に新UIを見せない、という運用上の約束を
 *   コードで固定する。ここが緩むと講師の画面が予告なく変わる。
 */
import { describe, it, expect } from 'vitest';
import { canUseLessonEntryV2 } from '@/lib/utils/lessonEntryV2';

describe('canUseLessonEntryV2', () => {
  it('admin だけ true', () => {
    expect(canUseLessonEntryV2('admin')).toBe(true);
  });

  it('講師・教室長・エリアマネージャー・保護者は false（従来UIのまま）', () => {
    expect(canUseLessonEntryV2('teacher')).toBe(false);
    expect(canUseLessonEntryV2('manager')).toBe(false);
    expect(canUseLessonEntryV2('owner')).toBe(false);
    expect(canUseLessonEntryV2('parent')).toBe(false);
  });

  it('未設定・未知のロールは false', () => {
    expect(canUseLessonEntryV2(null)).toBe(false);
    expect(canUseLessonEntryV2(undefined)).toBe(false);
    expect(canUseLessonEntryV2('')).toBe(false);
  });
});
