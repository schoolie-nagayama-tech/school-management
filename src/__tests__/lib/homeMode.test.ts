/**
 * 家モード判定の単体テスト（正典: docs/teacher-home-mode-plan.md §1・§2）
 *
 * ここが崩れるとページゲートとナビの出し分けが同時に狂うため、
 * 判定式とパスの線引きを固定しておく。
 */
import { describe, it, expect } from 'vitest';
import { CLASSROOM_ONLY_PREFIXES, isClassroomOnlyPath, isHomeModeRestricted } from '@/lib/homeMode';

describe('isHomeModeRestricted', () => {
  it('講師 × 未登録端末のときだけ家モードになる', () => {
    expect(isHomeModeRestricted('teacher', false)).toBe(true);
    expect(isHomeModeRestricted('teacher', true)).toBe(false);
  });

  it('教室長以上は端末に関係なく家モードにならない（§1-3）', () => {
    for (const role of ['manager', 'owner', 'admin']) {
      expect(isHomeModeRestricted(role, false)).toBe(false);
    }
  });

  it('ロール未確定（null/undefined）は家モードにしない', () => {
    expect(isHomeModeRestricted(null, false)).toBe(false);
    expect(isHomeModeRestricted(undefined, false)).toBe(false);
  });
});

describe('isClassroomOnlyPath', () => {
  it('教室限定パスとその配下を拾う', () => {
    expect(isClassroomOnlyPath('/students')).toBe(true);
    expect(isClassroomOnlyPath('/students/abc')).toBe(true);
    expect(isClassroomOnlyPath('/lesson-reports/xyz')).toBe(true);
    expect(isClassroomOnlyPath('/test-prep-proposals')).toBe(true);
  });

  it('家OKパスは拾わない（§1-4）', () => {
    for (const path of [
      '/today',
      '/my-schedule',
      '/attendance/NAGAYAMA/u1',
      '/my/badges',
      '/help',
      '/settings/account',
    ]) {
      expect(isClassroomOnlyPath(path)).toBe(false);
    }
  });

  it('前方一致は境界を見る（/interview が /interview-mock を巻き込まない）', () => {
    expect(isClassroomOnlyPath('/interview')).toBe(true);
    expect(isClassroomOnlyPath('/interview-mock')).toBe(false);
    // /test-prep と /test-prep-proposals は別項目として両方必要
    expect(CLASSROOM_ONLY_PREFIXES).toContain('/test-prep');
    expect(CLASSROOM_ONLY_PREFIXES).toContain('/test-prep-proposals');
  });

  it('pathname が無いときは制限しない', () => {
    expect(isClassroomOnlyPath(null)).toBe(false);
    expect(isClassroomOnlyPath(undefined)).toBe(false);
  });
});
