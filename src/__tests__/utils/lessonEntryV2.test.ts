/**
 * 通塾日程v2の公開ゲートのテスト。
 *
 * ★ なぜ要るか: 講師には座席表の運用を始めた教室から順に開ける、という運用上の約束をコードで固定する。
 *   ここが緩むと、まだ座席表を使っていない教室の講師の画面が予告なく変わる。
 *   教室長以上は期間設定を先に使い慣れておくため、教室を問わず開けてある。
 */
import { describe, it, expect } from 'vitest';
import { canUseLessonEntryV2 } from '@/lib/utils/lessonEntryV2';

/** 有効化済みの教室（デモ校） */
const DEMO_SCHOOL = 'd0000000-0000-4000-8000-000000000001';
/** 未有効化の教室（永山校） */
const NAGAYAMA = 'd187f7a3-633a-46ce-8d32-c56c85d17bac';

describe('canUseLessonEntryV2', () => {
  it('教室長以上はどの教室でも true（教室が分からなくても）', () => {
    for (const role of ['admin', 'owner', 'manager']) {
      expect(canUseLessonEntryV2(role, NAGAYAMA)).toBe(true);
      expect(canUseLessonEntryV2(role, DEMO_SCHOOL)).toBe(true);
      expect(canUseLessonEntryV2(role)).toBe(true);
    }
  });

  it('有効化した教室では講師も true', () => {
    expect(canUseLessonEntryV2('teacher', DEMO_SCHOOL)).toBe(true);
  });

  it('未有効化の教室では講師は false（従来UIのまま）', () => {
    expect(canUseLessonEntryV2('teacher', NAGAYAMA)).toBe(false);
    expect(canUseLessonEntryV2('parent', DEMO_SCHOOL)).toBe(false);
  });

  it('教室が分からないときは講師は false（安全側）', () => {
    expect(canUseLessonEntryV2('teacher')).toBe(false);
    expect(canUseLessonEntryV2('teacher', null)).toBe(false);
    expect(canUseLessonEntryV2('teacher', '')).toBe(false);
  });

  it('未設定・未知のロールは false', () => {
    expect(canUseLessonEntryV2(null, DEMO_SCHOOL)).toBe(false);
    expect(canUseLessonEntryV2(undefined, DEMO_SCHOOL)).toBe(false);
    expect(canUseLessonEntryV2('', DEMO_SCHOOL)).toBe(false);
  });
});
