/**
 * 通塾日程フォームから講座に入れるときの引数組み立てのテスト。
 *
 * ★ なぜ要るか: 講座への登録は必ず createFormationClassPatterns を通す（定員・同時刻枠数・
 *   講師重複・生徒の時間帯重複の検査が全部そこにある）。ここで渡す値を間違えると、
 *   「国理社は月19:10のはずが火曜に入る」「HAL の科目が講座の科目で上書きされる」といった
 *   静かな事故になるため、組み立てだけを純関数に切り出して固定する。
 */
import { describe, it, expect } from 'vitest';
import {
  buildFormationClassParams,
  filterCoursesForGrade,
  hasFixedWeeklySlot,
  resolveCourseSlot,
  resolveCourseSubjectIds,
  resolveFormationForSlots,
  type PatternCourseChoice,
} from '@/lib/schedule/patternCourseForm';

/** 開催枠固定の講座（国理社型）: 月曜・特定コマで開催、科目も決まっている */
const fixedCourse: PatternCourseChoice = {
  id: 'course-kokurisha',
  name: '中1理A',
  formation: 'group',
  target_grades: [7],
  subject_id: 'subject-science',
  day_of_week: 1,
  time_slot_id: 'slot-group-3',
};

/** 時間未固定の講座（HAL型）: 生徒ごとに曜日・コマ・科目を選ぶ */
const freeCourse: PatternCourseChoice = {
  id: 'course-hal50',
  name: 'HAL50分',
  formation: 'f_hal12345',
  target_grades: [],
  subject_id: null,
  day_of_week: null,
  time_slot_id: null,
};

const capacityDefaults = { maxStudentsPerGroup: 8, maxConcurrentGroups: 1 };

describe('filterCoursesForGrade', () => {
  it('生徒の学年が対象に入る講座と全学年の講座だけ残す', () => {
    const list = filterCoursesForGrade([fixedCourse, freeCourse], 7);
    expect(list.map((c) => c.id)).toEqual(['course-kokurisha', 'course-hal50']);
  });

  it('対象学年に入らない講座は落とす', () => {
    const list = filterCoursesForGrade([fixedCourse, freeCourse], 9);
    expect(list.map((c) => c.id)).toEqual(['course-hal50']);
  });

  it('学年が分からないときは絞り込まない', () => {
    expect(filterCoursesForGrade([fixedCourse, freeCourse], undefined)).toHaveLength(2);
  });
});

describe('hasFixedWeeklySlot', () => {
  it('曜日・コマの両方が入っているときだけ開催枠固定とみなす', () => {
    expect(hasFixedWeeklySlot(fixedCourse)).toBe(true);
    expect(hasFixedWeeklySlot(freeCourse)).toBe(false);
    // 片方だけの中途半端な状態は「未固定」扱い（絞れないため生徒ごとに選ばせる）
    expect(hasFixedWeeklySlot({ day_of_week: 2, time_slot_id: null })).toBe(false);
    expect(hasFixedWeeklySlot({ day_of_week: null, time_slot_id: 'slot-x' })).toBe(false);
  });
});

describe('resolveCourseSlot / resolveCourseSubjectIds', () => {
  it('開催枠固定の講座はフォームの値を無視して講座の曜日・コマを使う', () => {
    expect(resolveCourseSlot(fixedCourse, 4, 'slot-individual-1')).toEqual({
      dayOfWeek: 1,
      timeSlotId: 'slot-group-3',
    });
  });

  it('時間未固定の講座はフォームで選んだ曜日・コマを使う', () => {
    expect(resolveCourseSlot(freeCourse, 4, 'slot-hal-2')).toEqual({
      dayOfWeek: 4,
      timeSlotId: 'slot-hal-2',
    });
  });

  it('講座に科目があれば講座の科目、無ければフォームの科目', () => {
    expect(resolveCourseSubjectIds(fixedCourse, ['subject-math'])).toEqual(['subject-science']);
    expect(resolveCourseSubjectIds(freeCourse, ['subject-programming'])).toEqual([
      'subject-programming',
    ]);
    expect(resolveCourseSubjectIds(freeCourse, [])).toEqual([]);
  });
});

describe('buildFormationClassParams', () => {
  it('開催枠固定の講座は講座の曜日・コマ・科目で組み立てる', () => {
    const params = buildFormationClassParams({
      schoolId: 'school-1',
      studentId: 'student-1',
      course: fixedCourse,
      dayOfWeek: 4,
      timeSlotId: 'slot-individual-1',
      teacherId: 'teacher-1',
      subjectIds: ['subject-math'],
      applyMode: 'now',
      effectiveFrom: '2026-09-01',
      capacityDefaults,
    });
    expect(params).toEqual({
      schoolId: 'school-1',
      formation: 'group',
      timeSlotId: 'slot-group-3',
      dayOfWeek: 1,
      teacherId: 'teacher-1',
      subjectIds: ['subject-science'],
      studentIds: ['student-1'],
      specialCourseId: 'course-kokurisha',
      // 'now' は API 側が今日を入れるので未指定
      effectiveFrom: undefined,
      maxStudentsPerGroup: 8,
      maxConcurrentGroups: 1,
    });
  });

  it('時間未固定の講座はフォームの値を使い、担当未決定は null で渡す', () => {
    const params = buildFormationClassParams({
      schoolId: 'school-1',
      studentId: 'student-2',
      course: freeCourse,
      dayOfWeek: 4,
      timeSlotId: 'slot-hal-2',
      teacherId: '',
      subjectIds: ['subject-programming'],
      applyMode: 'future',
      effectiveFrom: '2026-09-01',
      capacityDefaults: { maxStudentsPerGroup: 3, maxConcurrentGroups: 2 },
    });
    expect(params).toEqual({
      schoolId: 'school-1',
      formation: 'f_hal12345',
      timeSlotId: 'slot-hal-2',
      dayOfWeek: 4,
      teacherId: null,
      subjectIds: ['subject-programming'],
      studentIds: ['student-2'],
      specialCourseId: 'course-hal50',
      effectiveFrom: '2026-09-01',
      maxStudentsPerGroup: 3,
      maxConcurrentGroups: 2,
    });
  });
});

describe('resolveFormationForSlots', () => {
  it('新規は選んだ講座の形態、講座なしは個別', () => {
    expect(resolveFormationForSlots(freeCourse)).toBe('f_hal12345');
    expect(resolveFormationForSlots(null)).toBe('individual');
  });

  it('編集はパターン自身の形態が正（講座が候補に無くても崩れない）', () => {
    expect(resolveFormationForSlots(null, 'f_hal12345')).toBe('f_hal12345');
  });
});
