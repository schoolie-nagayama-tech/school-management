import { supabase } from '@/lib/supabase';
import {
  getTimeSlotById,
  getRegularPatterns,
  createRegularPattern,
  checkStudentTimeConflict,
} from '@/lib/api/schedule';
import type { ScheduleRegularPattern } from '@/types/schedule';
import { resolveClassCapacity } from '@/lib/schedule/classCapacity';
import { fetchAllPaged } from '@/lib/utils/supabasePaging';

// schedule_regular_patterns は Database 型に未定義のため any でクエリ（schedule.ts と同じ流儀）。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/** 今日の YYYY-MM-DD（JST 想定） */
function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** 前日の YYYY-MM-DD */
function prevDay(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** 時間帯が重複するか（endA > startB && endB > startA） */
function timeRangesOverlap(startA: string, endA: string, startB: string, endB: string): boolean {
  const sA = startA.slice(0, 8);
  const eA = endA.slice(0, 8);
  const sB = startB.slice(0, 8);
  const eB = endB.slice(0, 8);
  return eA > sB && eB > sA;
}

export interface CreateFormationClassParams {
  schoolId: string;
  /** 形態キー（ユーザー定義形態の 'f_xxxxxxxx' 等） */
  formation: string;
  timeSlotId: string;
  dayOfWeek: number;
  /** 講師（1名）。null=担当未決定 */
  teacherId: string | null;
  subjectIds: string[];
  /** 追加する生徒（複数） */
  studentIds: string[];
  /** 適用開始日。未指定なら今日 */
  effectiveFrom?: string;
  /**
   * 1枠あたり生徒数上限の「形態の既定値」
   * （school_formation_capacity / school_class_capacity の max_students_per_group）。
   * 講座に定員（special_courses.capacity）があれば講座を優先する（resolveClassCapacity）。
   */
  maxStudentsPerGroup: number;
  /** 同時刻の枠数上限（school_formation_capacity.max_concurrent_groups） */
  maxConcurrentGroups: number;
  /**
   * 所属させる特別講座（通年講座）の id。
   * 新規に枠を作るとき（create）は必須。既存クラスへの生徒追加（add）では
   * undefined を渡し、同じ枠の既存メンバーが属する講座を引き継ぐ。
   */
  specialCourseId?: string | null;
}

/**
 * その形態の週次パターンの「パターンid → 講座id」対応表を取得する。
 *
 * 座席表の形態ボードは枠の定員（＝空席行の数・満席表示）を講座ごとに変えたいが、
 * schedule_entries に special_course_id は無い。entry.regular_pattern_id からこの表を引いて
 * 講座に辿る。定員表示のためだけなので id 2列に絞った軽いクエリにする。
 * （履歴行も混ざるが、id をキーに引くだけなので実害は無い）
 */
export async function getFormationPatternCourseMap(
  schoolId: string,
  formation: string
): Promise<Map<string, string | null>> {
  type Row = { id: string; special_course_id: string | null };
  try {
    const rows = await fetchAllPaged<Row>((from, to) =>
      db
        .from('schedule_regular_patterns')
        .select('id, special_course_id')
        .eq('school_id', schoolId)
        .eq('formation', formation)
        .eq('is_active', true)
        .order('id', { ascending: true })
        .range(from, to)
    );
    return new Map(rows.map((r) => [r.id, r.special_course_id ?? null]));
  } catch (e) {
    console.error('Error fetching formation pattern course map:', e);
    return new Map();
  }
}

/** 定員解決に必要な講座の最小情報（name はエラーメッセージ用） */
interface CourseCapacityInfo {
  name: string;
  capacity: number | null;
}

/**
 * 講座1件の定員と名前を取得する。見つからなければ null（＝形態の既定値で判定）。
 * 定員チェックのためだけの軽いクエリなので、SpecialCourse 全体は引かない。
 */
async function fetchCourseCapacity(courseId: string): Promise<CourseCapacityInfo | null> {
  const { data, error } = await db
    .from('special_courses')
    .select('name, capacity')
    .eq('id', courseId)
    .maybeSingle();
  if (error) {
    console.error('Error fetching special course capacity:', error);
    return null;
  }
  return (data as CourseCapacityInfo | null) ?? null;
}

/**
 * 形態ボードの「講座の枠」の週次パターンを一括作成する（Phase C）。
 *
 * クラス概念は持たず「曜日×コマ×講師×形態」の行群を暗黙のクラスとして扱う。
 * 選択生徒ごとに schedule_regular_patterns 行（formation=キー・special_course_id=講座）を作成する。
 * 枠は必ずどれかの特別講座に属する（正典 docs/special-courses-plan.md §2）。
 *
 * バリデーション（DB 書き込み前に全部まとめてチェックし、通ったものだけ挿入）:
 *  1. 定員: 同一 (曜日×コマ×講師) の既存メンバー + 追加数 <= 枠の定員
 *     枠の定員 = 講座の定員（special_courses.capacity）優先、無ければ形態の既定値
 *     （maxStudentsPerGroup）。判定は resolveClassCapacity に一元化する。
 *  2. 同時刻の枠数: 新規に講師枠を増やす場合、同一 (曜日×コマ) の講師枠数 < max_concurrent_groups
 *  3. 講師の別枠時間帯重複: 同一講師が別コマ（時間帯オーバーラップ）に既にいれば不可（同一コマは複数生徒OK）
 *  4. 生徒: 生徒ごとに checkStudentTimeConflict（形態横断・同一時間帯の二重登録禁止）
 */
export async function createFormationClassPatterns(
  params: CreateFormationClassParams
): Promise<ScheduleRegularPattern[]> {
  const {
    schoolId,
    formation,
    timeSlotId,
    dayOfWeek,
    teacherId,
    subjectIds,
    studentIds,
    maxStudentsPerGroup,
    maxConcurrentGroups,
    specialCourseId,
  } = params;
  const effectiveFrom = params.effectiveFrom || todayStr();

  if (studentIds.length === 0) {
    throw new Error('生徒を1名以上選択してください');
  }

  const slot = await getTimeSlotById(timeSlotId);
  if (!slot) throw new Error('コマ時間が見つかりません');

  // 適用開始日時点で有効な、その曜日の全パターン（全形態）を取得。
  // 講師の別枠重複判定は形態横断で行うため、あえて formation で絞らずに引く。
  const dayPatterns = await getRegularPatterns(schoolId, {
    dayOfWeek,
    asOfDate: effectiveFrom,
  });

  // ── 1 & 2. 定員 / 同時刻の枠数 ──
  // この形態・このコマの既存パターン（講師ごとにグルーピング）
  const sameSlotFormation = dayPatterns.filter(
    (p) => p.formation === formation && p.time_slot_id === timeSlotId
  );
  const groupKeyOf = (tid: string | null) => tid ?? '__unassigned__';
  const membersByGroup = new Map<string, number>();
  for (const p of sameSlotFormation) {
    const k = groupKeyOf(p.teacher_id);
    membersByGroup.set(k, (membersByGroup.get(k) ?? 0) + 1);
  }
  const targetGroupKey = groupKeyOf(teacherId);
  const existingInGroup = membersByGroup.get(targetGroupKey) ?? 0;

  // ── 講座の決定 ──
  // 生徒追加（specialCourseId 未指定）のときは、同じ枠に既にいるメンバーの講座を引き継ぐ。
  // 枠ごとに講座が混ざると名簿・請求が破綻するので、ここで1つに揃える。
  const inheritedCourseId =
    sameSlotFormation.find(
      (p) => groupKeyOf(p.teacher_id) === targetGroupKey && p.special_course_id
    )?.special_course_id ?? null;
  const resolvedCourseId = specialCourseId !== undefined ? specialCourseId : inheritedCourseId;

  // ── 枠の定員を解決（講座の定員 > 形態の既定値） ──
  // create は params.specialCourseId、add は枠から引き継いだ講座の capacity を見る。
  // 枠内で講座が混在することは想定しない（inheritedCourseId は先頭の非NULLを採用）。
  const courseInfo = resolvedCourseId ? await fetchCourseCapacity(resolvedCourseId) : null;
  const capacityLimit = resolveClassCapacity({
    courseCapacity: courseInfo?.capacity,
    formationDefault: maxStudentsPerGroup,
  });
  // 講座の定員が実際に採用されたときだけ、どの講座の定員かをメッセージに出す
  const isCourseCapacity = !!courseInfo && courseInfo.capacity === capacityLimit;
  if (existingInGroup + studentIds.length > capacityLimit) {
    const prefix = isCourseCapacity ? `「${courseInfo!.name}」の` : '';
    throw new Error(
      `${prefix}定員を超えます（現在 ${existingInGroup} 名 + 追加 ${studentIds.length} 名 > 上限 ${capacityLimit} 名）`
    );
  }
  // 新規に講師枠を増やす場合のみ同時刻の枠数を検査（既存枠への追加はカウント増にならない）
  const isNewGroup = !membersByGroup.has(targetGroupKey);
  if (isNewGroup && membersByGroup.size >= maxConcurrentGroups) {
    throw new Error(
      `同時刻の枠数が上限です（このコマは最大 ${maxConcurrentGroups} 枠まで。既存 ${membersByGroup.size} 枠）`
    );
  }

  // ── 3. 講師の別枠時間帯重複（同一コマは除外＝複数生徒OK） ──
  if (teacherId) {
    for (const p of dayPatterns) {
      if (p.teacher_id !== teacherId) continue;
      if (p.time_slot_id === timeSlotId) continue; // 同一コマは容量側で扱う
      const st = p.time_slot?.start_time;
      const et = p.time_slot?.end_time;
      if (!st || !et) continue;
      if (timeRangesOverlap(slot.start_time, slot.end_time, st, et)) {
        throw new Error('この講師は同じ時間帯に別のコマを担当しているため登録できません');
      }
    }
  }

  // ── 4. 生徒ごとの時間重複（形態横断）を事前チェック（挿入前に全員分） ──
  for (const studentId of studentIds) {
    const conflict = await checkStudentTimeConflict(
      studentId,
      dayOfWeek,
      slot.start_time,
      slot.end_time
    );
    if (conflict) throw new Error(conflict.message);
  }

  // ── 挿入（createRegularPattern を再利用。formation を渡す） ──
  const created: ScheduleRegularPattern[] = [];
  for (const studentId of studentIds) {
    const row = await createRegularPattern(schoolId, {
      student_id: studentId,
      day_of_week: dayOfWeek,
      time_slot_id: timeSlotId,
      teacher_id: teacherId,
      subject_ids: subjectIds,
      seat_label: '',
      period_type: 'regular',
      effective_from: effectiveFrom,
      formation,
      special_course_id: resolvedCourseId,
    });
    created.push(row);
  }
  return created;
}

/**
 * 講座の枠から生徒1名を「通塾日程から外す」。
 * effective_until を昨日にセットして週次生成の対象外にする（履歴は保持）。
 * fromDate 未指定なら今日を境界に、その前日を effective_until にする。
 */
export async function removeStudentFromFormationClass(
  regularPatternId: string,
  fromDate?: string
): Promise<void> {
  const until = prevDay(fromDate || todayStr());
  const { error } = await db
    .from('schedule_regular_patterns')
    .update({ effective_until: until })
    .eq('id', regularPatternId);
  if (error) {
    console.error('Error removing student from formation class:', error);
    throw new Error('通塾日程からの除外に失敗しました');
  }
}
