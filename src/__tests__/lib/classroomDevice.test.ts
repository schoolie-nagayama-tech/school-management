/**
 * 教室端末の判定の単体テスト（正典: docs/classroom-device-plan.md §1・§2）
 *
 * ここが崩れるとページゲートとナビの出し分けが同時に狂うため、
 * 判定式とパスの線引きを固定しておく。
 */
import { describe, it, expect } from 'vitest';
import {
  CLASSROOM_ONLY_PREFIXES,
  isClassroomOnlyPath,
  isOutsideClassroom,
} from '@/lib/classroomDevice';

describe('isOutsideClassroom', () => {
  it('講師 × 未登録端末のときだけ教室外モードになる', () => {
    expect(isOutsideClassroom('teacher', false)).toBe(true);
    expect(isOutsideClassroom('teacher', true)).toBe(false);
  });

  it('教室長以上は端末に関係なく教室外モードにならない（§1-3）', () => {
    for (const role of ['manager', 'owner', 'admin']) {
      expect(isOutsideClassroom(role, false)).toBe(false);
    }
  });

  it('ロール未確定（null/undefined）は教室外モードにしない', () => {
    expect(isOutsideClassroom(null, false)).toBe(false);
    expect(isOutsideClassroom(undefined, false)).toBe(false);
  });
});

describe('isClassroomOnlyPath', () => {
  it('教室限定パスとその配下を拾う', () => {
    expect(isClassroomOnlyPath('/students')).toBe(true);
    expect(isClassroomOnlyPath('/students/abc')).toBe(true);
    expect(isClassroomOnlyPath('/lesson-reports/xyz')).toBe(true);
    expect(isClassroomOnlyPath('/test-prep-proposals')).toBe(true);
  });

  it('教室外OKパスは拾わない（§1-4）', () => {
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
