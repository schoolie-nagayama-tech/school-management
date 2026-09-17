// コース（PS1／PS2／キッズ）と実際の登録の食い違いを拾う。
//
// なぜブロックだけでは足りないか:
//   登録時には canPlaceEntry が「1対1の隣に人を入れる」を弾くが、弾けない経路がある。
//    - 振替・臨時で後からコマを動かす
//    - コースを変更したとき、既に入っている授業は変わらない（意図的にそうしている。
//      過去の登録を書き換えると、実際には1対2で受けた授業が画面上だけ1対1に見えてしまう）
//    - 講師が座席表からコース未設定の科目を登録する
//   これらは止められないので、拾って教室長に見せる場所が要る。
//
// ★直すのは登録のほう。
//   保護者に見せているのは実登録(schedule_entries.ratio)なので、コース側に合わせて
//   画面表示を切り替えると、表示が誤りを覆い隠す装置になる。

import { supabase } from '@/lib/supabase';
import { courseDetail, type CourseDuration, type CourseRatio } from '@/lib/utils/studentCourse';
import { INDIVIDUAL_FORMATION } from '@/types/schedule';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export type CourseMismatchKind =
  /** コースと登録の比率が違う（PS1なのに1対2で入っている等）。 */
  | 'ratio'
  /** コースと登録の授業時間が違う（45分コースなのに90分で入っている等）。 */
  | 'duration'
  /** コースが未設定のまま授業だけ入っている。 */
  | 'no_course'
  /** 1対1の登録の隣に別の生徒がいる（振替・臨時で後から入った）。 */
  | 'one_to_one_shared';

export interface CourseMismatch {
  kind: CourseMismatchKind;
  studentId: string;
  studentName: string;
  schoolId: string;
  subjectId: string | null;
  subjectName: string;
  /** コース側の値（no_course では null）。 */
  courseRatio: CourseRatio | null;
  courseDuration: CourseDuration;
  /** 実登録の値。 */
  entryRatio: CourseRatio;
  entryDuration: CourseDuration;
  /** 該当するコマの件数と、いちばん近い日付。 */
  count: number;
  nearestDate: string;
  /** one_to_one_shared のときの相手（表示用）。 */
  sharedWith?: string;
}

interface EntryRow {
  id: string;
  school_id: string;
  entry_date: string;
  time_slot_id: string;
  teacher_id: string | null;
  student_id: string | null;
  subject_ids: string[] | null;
  ratio: number | null;
  duration_minutes: number | null;
  status: string;
  formation: string | null;
  student: { last_name: string; first_name: string; is_test: boolean | null } | null;
}

function norm(d: number | null | undefined): CourseDuration {
  return d === 45 ? 45 : d === 90 ? 90 : null;
}

/**
 * 今日以降の個別授業を、コースと突き合わせる。
 *
 * 過去のコマは出さない（もう直せないので、出しても行動につながらずノイズになる）。
 * 研修生徒 is_test・デモ教室 is_demo は除外する。
 */
export async function getCourseMismatches(
  schoolIds: string[],
  options?: { todayStr?: string; horizonDays?: number }
): Promise<CourseMismatch[]> {
  if (schoolIds.length === 0) return [];

  // デモ教室は除く（研修用データを運営の集計・アラートに混ぜない）。
  const { data: schoolRows } = await db.from('schools').select('id, is_demo').in('id', schoolIds);
  const targetSchoolIds = ((schoolRows ?? []) as Array<{ id: string; is_demo: boolean | null }>)
    .filter((s) => s.is_demo !== true)
    .map((s) => s.id);
  if (targetSchoolIds.length === 0) return [];

  const today = options?.todayStr ?? new Date().toISOString().slice(0, 10);
  // 既定は8週間先まで。座席表は先の週まで生成されるので、全期間を見ると件数が膨らむ。
  const horizon = new Date(`${today}T00:00:00`);
  horizon.setDate(horizon.getDate() + (options?.horizonDays ?? 56));
  const until = horizon.toISOString().slice(0, 10);

  const { data: entryData, error: entryError } = await db
    .from('schedule_entries')
    .select(
      'id, school_id, entry_date, time_slot_id, teacher_id, student_id, subject_ids, ratio, ' +
        'duration_minutes, status, formation, student:students(last_name, first_name, is_test)'
    )
    .in('school_id', targetSchoolIds)
    .eq('formation', INDIVIDUAL_FORMATION)
    .gte('entry_date', today)
    .lte('entry_date', until)
    .in('status', ['scheduled', 'completed', 'transferred_in'])
    .order('entry_date', { ascending: true })
    .limit(5000);
  if (entryError) {
    console.error('Error fetching entries for course mismatch:', entryError);
    return [];
  }
  const entries = ((entryData ?? []) as EntryRow[]).filter(
    (e) => !!e.student_id && e.student?.is_test !== true
  );
  if (entries.length === 0) return [];

  const studentIds = Array.from(new Set(entries.map((e) => e.student_id as string)));
  const { data: courseData, error: courseError } = await db
    .from('student_subject_contracts')
    .select('student_id, subject_id, ratio, duration_minutes')
    .in('student_id', studentIds);
  if (courseError) {
    console.error('Error fetching courses for mismatch:', courseError);
    return [];
  }
  const courseKey = (studentId: string, subjectId: string) => `${studentId}:${subjectId}`;
  const courses = new Map<string, { ratio: CourseRatio; duration: CourseDuration }>();
  for (const c of (courseData ?? []) as Array<{
    student_id: string;
    subject_id: string;
    ratio: number | null;
    duration_minutes: number | null;
  }>) {
    courses.set(courseKey(c.student_id, c.subject_id), {
      ratio: c.ratio === 1 ? 1 : 2,
      duration: norm(c.duration_minutes),
    });
  }

  const subjectIds = Array.from(
    new Set(entries.flatMap((e) => e.subject_ids ?? []).filter(Boolean))
  );
  const subjectNames = new Map<string, string>();
  if (subjectIds.length > 0) {
    const { data: subjData } = await db.from('subjects').select('id, name').in('id', subjectIds);
    for (const s of (subjData ?? []) as Array<{ id: string; name: string }>) {
      subjectNames.set(s.id, s.name);
    }
  }

  // 生徒×科目×種別 で畳む。1件1件出すと同じ話が毎週ぶん並んで読めなくなる。
  const grouped = new Map<string, CourseMismatch>();
  const add = (m: Omit<CourseMismatch, 'count' | 'nearestDate'>, date: string) => {
    const key = `${m.kind}:${m.studentId}:${m.subjectId ?? '-'}:${m.entryRatio}:${m.entryDuration}`;
    const hit = grouped.get(key);
    if (hit) {
      hit.count += 1;
      if (date < hit.nearestDate) hit.nearestDate = date;
      return;
    }
    grouped.set(key, { ...m, count: 1, nearestDate: date });
  };

  for (const e of entries) {
    const studentId = e.student_id as string;
    const studentName = e.student
      ? `${e.student.last_name} ${e.student.first_name}`
      : '（生徒名不明）';
    const entryRatio: CourseRatio = e.ratio === 1 ? 1 : 2;
    const entryDuration = norm(e.duration_minutes);
    // 複数科目のコマはコースの概念を持たない（比率は行全体に1つしか無い）ので突き合わせない。
    const ids = e.subject_ids ?? [];
    if (ids.length !== 1) continue;
    const subjectId = ids[0];
    const subjectName = subjectNames.get(subjectId) ?? '（科目名不明）';
    const course = courses.get(courseKey(studentId, subjectId));

    if (!course) {
      add(
        {
          kind: 'no_course',
          studentId,
          studentName,
          schoolId: e.school_id,
          subjectId,
          subjectName,
          courseRatio: null,
          courseDuration: null,
          entryRatio,
          entryDuration,
        },
        e.entry_date
      );
      continue;
    }
    if (course.ratio !== entryRatio) {
      add(
        {
          kind: 'ratio',
          studentId,
          studentName,
          schoolId: e.school_id,
          subjectId,
          subjectName,
          courseRatio: course.ratio,
          courseDuration: course.duration,
          entryRatio,
          entryDuration,
        },
        e.entry_date
      );
    } else if (course.duration !== entryDuration) {
      // 比率が合っているときだけ時間を見る（両方出すと同じ授業が2行になる）。
      add(
        {
          kind: 'duration',
          studentId,
          studentName,
          schoolId: e.school_id,
          subjectId,
          subjectName,
          courseRatio: course.ratio,
          courseDuration: course.duration,
          entryRatio,
          entryDuration,
        },
        e.entry_date
      );
    }
  }

  // 1対1の隣に人がいるコマ。登録時は canPlaceEntry が弾くが、
  // 振替・臨時・コース変更の後追いでは弾けないので、ここで拾う。
  const slotKey = (e: EntryRow) =>
    `${e.school_id}:${e.entry_date}:${e.time_slot_id}:${e.teacher_id}`;
  const bySlot = new Map<string, EntryRow[]>();
  for (const e of entries) {
    if (!e.teacher_id) continue;
    const k = slotKey(e);
    const arr = bySlot.get(k);
    if (arr) arr.push(e);
    else bySlot.set(k, [e]);
  }
  for (const rows of Array.from(bySlot.values())) {
    if (rows.length < 2) continue;
    const exclusive = rows.filter((r) => r.ratio === 1);
    if (exclusive.length === 0) continue;
    for (const e of exclusive) {
      const others = rows.filter((r) => r.id !== e.id);
      const studentId = e.student_id as string;
      add(
        {
          kind: 'one_to_one_shared',
          studentId,
          studentName: e.student
            ? `${e.student.last_name} ${e.student.first_name}`
            : '（生徒名不明）',
          schoolId: e.school_id,
          subjectId: (e.subject_ids ?? [])[0] ?? null,
          subjectName: subjectNames.get((e.subject_ids ?? [])[0] ?? '') ?? '—',
          courseRatio: 1,
          courseDuration: norm(e.duration_minutes),
          entryRatio: 1,
          entryDuration: norm(e.duration_minutes),
          sharedWith: others
            .map((o) => (o.student ? `${o.student.last_name} ${o.student.first_name}` : '別の生徒'))
            .join('・'),
        },
        e.entry_date
      );
    }
  }

  // 重い順（比率違い・1対1の同席 → 時間違い → コース未設定）に並べ、同順位は近い日付順。
  const severity: Record<CourseMismatchKind, number> = {
    ratio: 0,
    one_to_one_shared: 0,
    duration: 1,
    no_course: 2,
  };
  return Array.from(grouped.values()).sort(
    (a, b) => severity[a.kind] - severity[b.kind] || a.nearestDate.localeCompare(b.nearestDate)
  );
}

/** 一覧に出す1行の説明文。 */
export function describeMismatch(m: CourseMismatch): string {
  switch (m.kind) {
    case 'ratio':
      return `コース ${courseDetail(m.courseRatio ?? 2, m.courseDuration)} ↔ 登録 ${courseDetail(m.entryRatio, m.entryDuration)}`;
    case 'duration':
      return `コース ${m.courseDuration === 45 ? '45分' : '90分'} ↔ 登録 ${m.entryDuration === 45 ? '45分' : '90分'}`;
    case 'no_course':
      return 'コース未設定 ↔ 登録あり';
    case 'one_to_one_shared':
      return `1対1の隣に別の生徒（${m.sharedWith ?? ''}）`;
  }
}
