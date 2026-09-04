/**
 * 特別講座（special_courses）の API。
 *
 * 正典: docs/special-courses-plan.md
 *  - 通年講座 (scope='year_round') … 通常期も講習期も開催。時間割は
 *    schedule_regular_patterns.special_course_id で表現する（曜日×コマ）。
 *    講習期だけ日時を上書きできる（special_course_koushu_overrides）。
 *  - 講習講座 (scope='koushu')     … その講習期だけ。session_dates で日付指定。
 *    旧 koushu_special_courses から id ごと移行済み。
 *
 * special_courses / special_course_koushu_overrides は生成型（src/types/database.ts）に
 * 未反映のため、schedule-formations.ts と同じ流儀で db を any にしてクエリする。
 */
import { supabase } from '@/lib/supabase';
import type {
  SpecialCourseKoushuOverride,
  SpecialCourseScope,
  SpecialCourseSession,
} from '@/lib/utils/specialCourses';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export type { SpecialCourseSession, SpecialCourseScope, SpecialCourseKoushuOverride };

export interface SpecialCourse {
  id: string;
  school_id: string;
  scope: SpecialCourseScope;
  /** schedule_formations.key。個別以外（小集団・プログラミング等） */
  formation: string;
  name: string;
  /** 対象学年（1-13）。空配列=全学年 */
  target_grades: number[];
  /** 科目。総合・プログラミング等の科目に紐づかない講座は null */
  subject_id: string | null;
  /** 1回あたりの単価（円・税込）。未設定は null */
  unit_price: number | null;
  /** 定員。null=制限なし */
  capacity: number | null;
  /** 講習講座のみ必須。通年講座は null */
  season: string | null;
  year: number | null;
  /** 講習講座の開催予定。通年講座は空配列（時間割は講座の枠側が持つ） */
  session_dates: SpecialCourseSession[];
  /**
   * 通年講座の定例開催曜日（0=日〜6=土）。未設定=null。
   * 講習講座は常に null（開催日は session_dates で指定するため）。
   */
  day_of_week: number | null;
  /** 通年講座の定例開催コマ（schedule_time_slots.id）。未設定=null。講習講座は常に null。 */
  time_slot_id: string | null;
  is_active: boolean;
}

/** 作成時の入力。id / created_at 等は DB 側で採番する。 */
export type SpecialCourseInput = Omit<SpecialCourse, 'id'>;

/** 編集フォームが返す値（school_id / scope / season / year は画面側の文脈で決まるので含めない） */
export type SpecialCourseFormValues = Pick<
  SpecialCourse,
  | 'name'
  | 'formation'
  | 'target_grades'
  | 'subject_id'
  | 'unit_price'
  | 'capacity'
  | 'session_dates'
  | 'day_of_week'
  | 'time_slot_id'
  | 'is_active'
>;

const SELECT_COLUMNS =
  'id, school_id, scope, formation, name, target_grades, subject_id, unit_price, capacity, season, year, session_dates, day_of_week, time_slot_id, is_active';

/**
 * 通年講座の一覧（教室単位）。
 * 並び順は形態→講座名（形態タブごとにまとまって見える方が編集しやすいため）。
 */
export async function getYearRoundCourses(schoolId: string): Promise<SpecialCourse[]> {
  const { data, error } = await db
    .from('special_courses')
    .select(SELECT_COLUMNS)
    .eq('school_id', schoolId)
    .eq('scope', 'year_round')
    .order('formation', { ascending: true })
    .order('name', { ascending: true });
  if (error) {
    console.error('Error fetching year-round special courses:', error);
    throw new Error('通年講座の取得に失敗しました');
  }
  return (data ?? []) as SpecialCourse[];
}

/** 教室×講習期間（season+year）の講習講座一覧。 */
export async function getKoushuCourses(
  schoolId: string,
  season: string,
  year: number
): Promise<SpecialCourse[]> {
  const { data, error } = await db
    .from('special_courses')
    .select(SELECT_COLUMNS)
    .eq('school_id', schoolId)
    .eq('scope', 'koushu')
    .eq('season', season)
    .eq('year', year)
    .order('formation', { ascending: true })
    .order('name', { ascending: true });
  if (error) {
    console.error('Error fetching koushu special courses:', error);
    throw new Error('講習講座の取得に失敗しました');
  }
  return (data ?? []) as SpecialCourse[];
}

/**
 * 形態ボードの「＋講座の枠」で選ばせる通年講座。
 * その形態で有効な通年講座だけを返す（0件なら画面側で講座作成へ誘導する）。
 * クリックしたセル（曜日×コマ）への絞り込みは呼び出し側で
 * filterCoursesForCell（lib/utils/specialCourses）に通す。
 */
export async function getActiveYearRoundCoursesByFormation(
  schoolId: string,
  formation: string
): Promise<SpecialCourse[]> {
  const { data, error } = await db
    .from('special_courses')
    .select(SELECT_COLUMNS)
    .eq('school_id', schoolId)
    .eq('scope', 'year_round')
    .eq('formation', formation)
    .eq('is_active', true)
    .order('name', { ascending: true });
  if (error) {
    console.error('Error fetching year-round courses by formation:', error);
    throw new Error('通年講座の取得に失敗しました');
  }
  return (data ?? []) as SpecialCourse[];
}

/**
 * 教室の有効な通年講座を全形態ぶん取得する。
 * 生徒詳細の通塾日程フォームは形態タブを持たない（生徒から見れば授業は「個別か講座か」だけ）ので、
 * 形態で絞らずまとめて引き、対象学年での絞り込みは画面側（filterCoursesForGrade）で行う。
 */
export async function getActiveYearRoundCourses(schoolId: string): Promise<SpecialCourse[]> {
  const { data, error } = await db
    .from('special_courses')
    .select(SELECT_COLUMNS)
    .eq('school_id', schoolId)
    .eq('scope', 'year_round')
    .eq('is_active', true)
    .order('formation', { ascending: true })
    .order('name', { ascending: true });
  if (error) {
    console.error('Error fetching active year-round courses:', error);
    throw new Error('通年講座の取得に失敗しました');
  }
  return (data ?? []) as SpecialCourse[];
}

/** 特別講座を新規作成。id は DB 側で自動採番。 */
export async function createSpecialCourse(input: SpecialCourseInput): Promise<SpecialCourse> {
  const { data, error } = await db
    .from('special_courses')
    .insert({ ...input })
    .select(SELECT_COLUMNS)
    .single();
  if (error) {
    console.error('Error creating special course:', error);
    throw new Error('特別講座の作成に失敗しました');
  }
  return data as SpecialCourse;
}

/** 特別講座を部分更新。school_id / scope の張り替えは想定しない（別教室・別種別への移動はできない）。 */
export async function updateSpecialCourse(
  id: string,
  patch: Partial<SpecialCourseFormValues>
): Promise<void> {
  const { error } = await db.from('special_courses').update(patch).eq('id', id);
  if (error) {
    console.error('Error updating special course:', error);
    throw new Error('特別講座の更新に失敗しました');
  }
}

/**
 * 特別講座を削除。
 * koushu_enrollments.course_id は RESTRICT でこのテーブルを参照しているため、
 * 申込が1件でもあると 23503（foreign_key_violation）で失敗する。
 * その場合はユーザーに分かる日本語メッセージへ変換して投げ直す。
 * （通年講座に紐づく枠は ON DELETE SET NULL なので削除を妨げない＝
 *   講座を消しても生徒の通塾日程は残る。座席表が静かに欠けるのを防ぐため）
 */
export async function deleteSpecialCourse(id: string): Promise<void> {
  const { error } = await db.from('special_courses').delete().eq('id', id);
  if (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String((error as { code: string }).code)
        : '';
    if (code === '23503') {
      throw new Error('この講座には申込があるため削除できません');
    }
    console.error('Error deleting special course:', error);
    throw new Error('特別講座の削除に失敗しました');
  }
}

// ============================================================
// 通年講座の講習期上書き（special_course_koushu_overrides）
// ============================================================

/** 講座1件分の上書き一覧（講習期ごと）。行が無い講習期は「通常どおり開催」。 */
export async function getKoushuOverrides(courseId: string): Promise<SpecialCourseKoushuOverride[]> {
  const { data, error } = await db
    .from('special_course_koushu_overrides')
    .select('course_id, season, year, session_dates')
    .eq('course_id', courseId)
    .order('year', { ascending: false })
    .order('season', { ascending: true });
  if (error) {
    console.error('Error fetching special course koushu overrides:', error);
    throw new Error('講習期の上書き設定の取得に失敗しました');
  }
  return (data ?? []) as SpecialCourseKoushuOverride[];
}

/** 講習期の上書きを登録・更新（(course_id, season, year) が主キーなので upsert）。 */
export async function upsertKoushuOverride(
  courseId: string,
  season: string,
  year: number,
  sessionDates: SpecialCourseSession[]
): Promise<void> {
  const { error } = await db.from('special_course_koushu_overrides').upsert(
    {
      course_id: courseId,
      season,
      year,
      session_dates: sessionDates,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'course_id,season,year' }
  );
  if (error) {
    console.error('Error upserting special course koushu override:', error);
    throw new Error('講習期の上書き設定の保存に失敗しました');
  }
}

/** 上書きを解除（＝その講習期も通常の時間割どおり開催に戻す）。 */
export async function deleteKoushuOverride(
  courseId: string,
  season: string,
  year: number
): Promise<void> {
  const { error } = await db
    .from('special_course_koushu_overrides')
    .delete()
    .eq('course_id', courseId)
    .eq('season', season)
    .eq('year', year);
  if (error) {
    console.error('Error deleting special course koushu override:', error);
    throw new Error('講習期の上書き設定の解除に失敗しました');
  }
}

// ============================================================
// 名簿・時間割（講座に紐づくクラス枠 = schedule_regular_patterns）
// ============================================================

/** 講座に紐づく枠1行（＝生徒1名の週次通塾日程）。時間割表示と名簿の両方に使う。 */
export interface SpecialCourseRosterRow {
  patternId: string;
  studentId: string;
  studentName: string;
  grade: number;
  dayOfWeek: number;
  timeSlotId: string;
  slotNumber: number | null;
  startTime: string | null;
  endTime: string | null;
  teacherId: string | null;
  teacherName: string | null;
  effectiveFrom: string;
  effectiveUntil: string | null;
}

/**
 * 講座の名簿（＝講座に紐づくクラス枠の生徒一覧）を取得する。
 *
 * 名簿は手動入力（決定②）。座席表の形態ボードで枠に生徒を入れると
 * schedule_regular_patterns.special_course_id に講座が書かれ、その集合が名簿になる。
 * asOfDate を渡すとその日時点で有効な行だけに絞る（退塾・曜日変更の履歴行を除く）。
 */
export async function getSpecialCourseRoster(
  courseId: string,
  asOfDate?: string
): Promise<SpecialCourseRosterRow[]> {
  let query = db
    .from('schedule_regular_patterns')
    .select(
      `
      id, student_id, day_of_week, time_slot_id, teacher_id, effective_from, effective_until,
      time_slot:schedule_time_slots(id, slot_number, start_time, end_time),
      student:students(id, last_name, first_name, grade),
      teacher:user_profiles(id, display_name, email)
    `
    )
    .eq('special_course_id', courseId)
    .eq('is_active', true);

  if (asOfDate) {
    query = query
      .lte('effective_from', asOfDate)
      .or(`effective_until.is.null,effective_until.gte.${asOfDate}`);
  }

  const { data, error } = await query.order('day_of_week').order('time_slot_id');
  if (error) {
    console.error('Error fetching special course roster:', error);
    throw new Error('講座の名簿の取得に失敗しました');
  }

  type Rel<T> = T | T[] | null;
  const first = <T>(v: Rel<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

  interface RawRow {
    id: string;
    student_id: string;
    day_of_week: number;
    time_slot_id: string;
    teacher_id: string | null;
    effective_from: string;
    effective_until: string | null;
    time_slot: Rel<{
      id: string;
      slot_number: number;
      start_time: string;
      end_time: string;
    }>;
    student: Rel<{ id: string; last_name: string; first_name: string; grade: number }>;
    teacher: Rel<{ id: string; display_name: string | null; email: string | null }>;
  }

  return ((data ?? []) as RawRow[]).map((r) => {
    const slot = first(r.time_slot);
    const student = first(r.student);
    const teacher = first(r.teacher);
    return {
      patternId: r.id,
      studentId: r.student_id,
      studentName: student ? `${student.last_name} ${student.first_name}` : '（不明な生徒）',
      grade: student?.grade ?? 0,
      dayOfWeek: r.day_of_week,
      timeSlotId: r.time_slot_id,
      slotNumber: slot?.slot_number ?? null,
      startTime: slot?.start_time ?? null,
      endTime: slot?.end_time ?? null,
      teacherId: r.teacher_id,
      teacherName: teacher?.display_name || teacher?.email || null,
      effectiveFrom: r.effective_from,
      effectiveUntil: r.effective_until,
    };
  });
}
