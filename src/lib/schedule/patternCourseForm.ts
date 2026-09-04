/**
 * 通塾日程フォーム（生徒詳細）から講座（通年講座）へ生徒を入れるための純ロジック。
 *
 * 背景:
 *  個別指導は生徒詳細の通塾日程から入れるのに、講座（HAL・国理社）は座席表の形態ボードの
 *  「＋講座の枠」からしか入れられない、という非対称を解消する（正典 docs/special-courses-plan.md）。
 *  DB アクセスや React に依存する部分はモーダル側に残し、
 *  「どの曜日・コマ・科目・講師で作るか」の組み立てだけをここに置いてテストする。
 */
import { INDIVIDUAL_FORMATION } from '@/types/schedule';
import type { CreateFormationClassParams } from '@/lib/api/formation-patterns';

/**
 * 講座候補として必要な最小形（lib/api の SpecialCourse の部分集合）。
 * API 型に依存させないことで、この関数群を DB 抜きでテストできる。
 */
export interface PatternCourseChoice {
  id: string;
  name: string;
  /** schedule_formations.key（個別以外） */
  formation: string;
  /** 対象学年（1-12）。空配列=全学年 */
  target_grades: number[];
  /** 講座の科目。HAL のように枠側で選ぶ講座は null */
  subject_id: string | null;
  /** 定例開催曜日。null=時間未固定（HAL型） */
  day_of_week: number | null;
  /** 定例開催コマ。null=時間未固定（HAL型） */
  time_slot_id: string | null;
}

/** 形態の既定定員（school_formation_capacity 由来。講座に定員があれば API 側で講座が優先される） */
export interface FormationCapacityDefaults {
  maxStudentsPerGroup: number;
  maxConcurrentGroups: number;
}

/**
 * その生徒が受講できる講座だけに絞る。
 * target_grades が空配列の講座は「全学年」なので常に候補に残す。
 * 学年が分からない場合（studentGrade 未指定）は絞り込まず全件返す
 * （科目フィルタと同じ方針。黙って候補を空にしない）。
 */
export function filterCoursesForGrade<T extends { target_grades: number[] }>(
  courses: T[],
  grade: number | undefined | null
): T[] {
  if (grade == null) return courses;
  return courses.filter((c) => c.target_grades.length === 0 || c.target_grades.includes(grade));
}

/**
 * 開催枠が固定された講座か（国理社型）。
 * 曜日・コマの両方が入っているときだけ固定扱いにする。片方だけの中途半端な状態は
 * 「時間未固定（HAL型）」と同じく生徒ごとに選ばせる（filterCoursesForCell と同じ判断）。
 */
export function hasFixedWeeklySlot(course: {
  day_of_week: number | null;
  time_slot_id: string | null;
}): boolean {
  return course.day_of_week != null && course.time_slot_id != null;
}

/**
 * 実際に登録する曜日・コマを決める。
 * 開催枠固定の講座は講座の値が正（フォームで別の曜日を選べないよう UI 側も disabled にする）。
 */
export function resolveCourseSlot(
  course: PatternCourseChoice,
  formDayOfWeek: number,
  formTimeSlotId: string
): { dayOfWeek: number; timeSlotId: string } {
  if (hasFixedWeeklySlot(course)) {
    return { dayOfWeek: course.day_of_week as number, timeSlotId: course.time_slot_id as string };
  }
  return { dayOfWeek: formDayOfWeek, timeSlotId: formTimeSlotId };
}

/**
 * 講座に登録するときの科目。
 * 講座に科目があればそれが正（UI では変更不可）。無ければフォームで選んだ科目
 * （HAL は学年帯別の科目を枠側で選ぶ運用）。
 */
export function resolveCourseSubjectIds(
  course: PatternCourseChoice,
  formSubjectIds: string[]
): string[] {
  return course.subject_id ? [course.subject_id] : formSubjectIds;
}

/** モーダルのフォーム値（講座を選んだ状態） */
export interface PatternCourseFormInput {
  schoolId: string;
  studentId: string;
  course: PatternCourseChoice;
  /** フォームで選んだ曜日（開催枠固定の講座では講座の値が優先される） */
  dayOfWeek: number;
  /** フォームで選んだコマ（同上） */
  timeSlotId: string;
  /** '' = 担当未決定（講座では未決定のまま登録できる） */
  teacherId: string;
  /** フォームで選んだ科目（講座に科目があればそちらが優先される） */
  subjectIds: string[];
  /** 'now' = 今日から / 'future' = effectiveFrom から */
  applyMode: 'now' | 'future';
  effectiveFrom: string;
  capacityDefaults: FormationCapacityDefaults;
}

/**
 * createFormationClassPatterns に渡す引数を組み立てる。
 *
 * 定員・同時刻枠数・講師重複・生徒の時間帯重複のバリデーションは全て API 側にあるので、
 * ここでは「どの値を渡すか」だけを決める（自前で insert しないこと）。
 */
export function buildFormationClassParams(
  input: PatternCourseFormInput
): CreateFormationClassParams {
  const { course, capacityDefaults } = input;
  const { dayOfWeek, timeSlotId } = resolveCourseSlot(course, input.dayOfWeek, input.timeSlotId);
  return {
    schoolId: input.schoolId,
    formation: course.formation,
    timeSlotId,
    dayOfWeek,
    teacherId: input.teacherId || null,
    subjectIds: resolveCourseSubjectIds(course, input.subjectIds),
    studentIds: [input.studentId],
    specialCourseId: course.id,
    // 'now' は未指定（API 側が今日を入れる）。'future' のときだけ指定日を渡す。
    effectiveFrom: input.applyMode === 'future' ? input.effectiveFrom : undefined,
    maxStudentsPerGroup: capacityDefaults.maxStudentsPerGroup,
    maxConcurrentGroups: capacityDefaults.maxConcurrentGroups,
  };
}

/**
 * 授業セレクトで選択中の値から、コマ候補を出す形態キーを決める。
 * 個別（講座なし）は 'individual'、講座は講座の形態。
 * 編集時はパターン自身の形態が正（講座が無効化・学年対象外で候補に無くても崩れないように）。
 */
export function resolveFormationForSlots(
  course: PatternCourseChoice | null,
  patternFormation?: string | null
): string {
  if (patternFormation) return patternFormation;
  return course?.formation ?? INDIVIDUAL_FORMATION;
}
