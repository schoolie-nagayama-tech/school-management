/**
 * 通塾日程v2の公開ゲートのテスト。
 *
 * ★ なぜ要るか: 座席表の運用を始めた教室から順に開ける、という運用上の約束をコードで固定する。
 *   ここが緩むと、まだ座席表を使っていない教室の講師の画面が予告なく変わる。
 */
import { describe, it, expect } from 'vitest';
import { canUseLessonEntryV2 } from '@/lib/utils/lessonEntryV2';

/** 有効化済みの教室（デモ校） */
const DEMO_SCHOOL = 'd0000000-0000-4000-8000-000000000001';
/** 未有効化の教室（永山校） */
const NAGAYAMA = 'd187f7a3-633a-46ce-8d32-c56c85d17bac';

describe('canUseLessonEntryV2', () => {
  it('admin はどの教室でも true（動作確認のため）', () => {
    expect(canUseLessonEntryV2('admin', NAGAYAMA)).toBe(true);
    expect(canUseLessonEntryV2('admin', DEMO_SCHOOL)).toBe(true);
    expect(canUseLessonEntryV2('admin')).toBe(true);
  });

  it('有効化した教室では教室長・講師も true', () => {
    expect(canUseLessonEntryV2('manager', DEMO_SCHOOL)).toBe(true);
    expect(canUseLessonEntryV2('teacher', DEMO_SCHOOL)).toBe(true);
  });

  it('未有効化の教室では教室長・講師は false（従来UIのまま）', () => {
    expect(canUseLessonEntryV2('manager', NAGAYAMA)).toBe(false);
    expect(canUseLessonEntryV2('teacher', NAGAYAMA)).toBe(false);
    expect(canUseLessonEntryV2('owner', NAGAYAMA)).toBe(false);
    expect(canUseLessonEntryV2('parent', DEMO_SCHOOL)).toBe(false);
  });

  it('教室が分からないときは admin 以外 false（安全側）', () => {
    expect(canUseLessonEntryV2('manager')).toBe(false);
    expect(canUseLessonEntryV2('teacher', null)).toBe(false);
    expect(canUseLessonEntryV2('teacher', '')).toBe(false);
  });

  it('未設定・未知のロールは false', () => {
    expect(canUseLessonEntryV2(null, DEMO_SCHOOL)).toBe(false);
    expect(canUseLessonEntryV2(undefined, DEMO_SCHOOL)).toBe(false);
    expect(canUseLessonEntryV2('', DEMO_SCHOOL)).toBe(false);
  });
});
