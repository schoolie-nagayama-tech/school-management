/**
 * 講習（個別）自動マッチング — 提案生成
 *
 * 役割：講習期間の「生徒別の個別残コマ」を、出勤可能講師・席数・1日上限を考慮して
 *       期間内の (日付 × 個別コマ) に貪欲配置し、schedule_match_proposals に下書きとして保存する。
 *       本格的な自動マッチングは個別のみ（集団は手動編成）。
 *
 * 重要：schedule_match_proposals.teacher_id は NOT NULL。
 *       → 候補講師がいないコマは提案を作らず unmatched として報告する（担当未決定の提案は作れない）。
 *
 * スコア／配置の重みはすべて暫定値。MATCH_CONFIG に集約し、実運用しながら調整する想定。
 */

import { supabase } from '@/lib/supabase';
import { getActiveTimeSlots } from '@/lib/api/schedule';
import { getAvailabilityDayMap } from '@/lib/api/teacher-availability';
import { getKoushuPlacementProgressByPeriod, type KoushuPeriodInfo } from '@/lib/api/koushu-period';
import { getClassCapacity, DEFAULT_CLASS_CAPACITY } from '@/lib/api/school-class-capacity';
import { createMatchBatch } from '@/lib/api/schedule-match';
import type { MatchBatchMode } from '@/types/schedule-match';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/**
 * マッチングの調整パラメータ。※すべて暫定値。実運用しながら調整する。
 * weights は pattern-matching.ts（通塾日程マッチング）と揃えている。
 */
export const MATCH_CONFIG = {
  weights: {
    fixedTeacher: 50, // 担当固定リストに含まれる
    pastHistory: 30, // 過去6か月にこの生徒を担当
    subjectMatch: 20, // 指導科目が生徒の科目と一致
    genderPref: 10, // 性別希望に合致
    available: 5, // 出勤可能（ベースライン）
  },
  maxKomaPerStudentPerDay: 2, // 1生徒1日あたりの講習コマ上限
} as const;

export interface KoushuMatchInput {
  schoolId: string;
  period: KoushuPeriodInfo;
  executedBy: string;
  mode?: MatchBatchMode;
  /** 生徒の通塾可能日（seasonal_shift_settings.id）。指定時のみ生徒側の可否でフィルタ（現状は未配線） */
  settingId?: string | null;
  /** 休講日（YYYY-MM-DD）。これらの日付は配置対象から除外 */
  closedDates?: string[];
  options?: {
    maxKomaPerStudentPerDay?: number;
  };
}

export interface KoushuMatchResult {
  batchId: string | null;
  proposalsCreated: number;
  unmatched: Array<{
    student_id: string;
    student_name?: string;
    remaining: number;
    reason: string;
  }>;
}

interface TeacherProfile {
  id: string;
  display_name: string | null;
  email: string | null;
  gender: 'male' | 'female' | 'other' | null;
  teachable_subject_ids: string[] | null;
}

interface ScoredTeacher {
  teacherId: string;
  score: number;
  reasons: string[];
  conflicts: string[];
  subjectOut: boolean;
}

/** 期間内の日付一覧（YYYY-MM-DD）。休講日は除外。 */
function enumeratePeriodDates(start: string, end: string, closed: Set<string>): string[] {
  const dates: string[] = [];
  const cur = new Date(start + 'T12:00:00');
  const last = new Date(end + 'T12:00:00');
  while (cur <= last) {
    const ds = cur.toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' });
    if (!closed.has(ds)) dates.push(ds);
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

/** YYYY-MM-DD の曜日（0=日〜6=土）。JST 正午基準でズレを防ぐ。 */
function dowOf(dateStr: string): number {
  return new Date(dateStr + 'T12:00:00').getDay();
}

/**
 * 1生徒に対する1講師のスコアを算出（pattern-matching.ts 準拠）。
 * ハード除外（指名NG / 性別希望不一致）の場合は null。
 * 指導科目外は subjectOut=true で返し（除外はしない）、呼び出し側が科目一致を優先する。
 */
function scoreTeacher(opts: {
  teacher: TeacherProfile;
  fixedSet: Set<string>;
  excludedSet: Set<string>;
  preferredGender: 'male' | 'female' | null;
  pastSet: Set<string>;
  subjectIds: string[];
}): ScoredTeacher | null {
  const { teacher, fixedSet, excludedSet, preferredGender, pastSet, subjectIds } = opts;
  if (excludedSet.has(teacher.id)) return null; // 指名NG
  if (preferredGender && teacher.gender && teacher.gender !== preferredGender) return null;

  const w = MATCH_CONFIG.weights;
  let score = 0;
  const reasons: string[] = [];
  const conflicts: string[] = [];

  if (fixedSet.has(teacher.id)) {
    score += w.fixedTeacher;
    reasons.push('担当固定');
  }
  if (pastSet.has(teacher.id)) {
    score += w.pastHistory;
    reasons.push('過去担当');
  }

  const teachable = new Set(teacher.teachable_subject_ids ?? []);
  const subjectKnown = teachable.size > 0 && subjectIds.length > 0;
  const subjectOut = subjectKnown && !subjectIds.some((sid) => teachable.has(sid));
  if (subjectKnown && !subjectOut) {
    score += w.subjectMatch;
    reasons.push('教科対応');
  }
  if (subjectOut) conflicts.push('教科外');

  if (preferredGender && teacher.gender === preferredGender) {
    score += w.genderPref;
    reasons.push('希望性別一致');
  }

  score += w.available;
  reasons.push('出勤可能');

  return { teacherId: teacher.id, score, reasons, conflicts, subjectOut };
}

/**
 * 講習（個別）の提案を生成して下書きバッチに保存する。
 * 戻り値に作成件数と未マッチ（残コマ）を返す。
 */
export async function generateKoushuIndividualProposals(
  input: KoushuMatchInput
): Promise<KoushuMatchResult> {
  const { schoolId, period, executedBy } = input;
  const maxPerDay = input.options?.maxKomaPerStudentPerDay ?? MATCH_CONFIG.maxKomaPerStudentPerDay;
  const closed = new Set(input.closedDates ?? []);

  // --- 入力収集 ---
  // 過去日付には配置しない（配置時の過去日付ガードと整合）。期間開始が過去でも今日以降のみ。
  const todayJst = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' });
  const effectiveStart =
    period.schedule_start_date > todayJst ? period.schedule_start_date : todayJst;
  const dates = enumeratePeriodDates(effectiveStart, period.schedule_end_date, closed);
  const slots = (await getActiveTimeSlots(schoolId, 'individual')).sort(
    (a, b) => a.slot_number - b.slot_number
  );
  const dayMap = await getAvailabilityDayMap(schoolId, period.schedule_start_date);
  const capacity = (await getClassCapacity(schoolId)) ?? DEFAULT_CLASS_CAPACITY;
  const maxPerTeacher = capacity.max_students_per_teacher_individual;
  const totalSeats = capacity.total_individual_seats;

  // 生徒×科目別の個別残コマ（placed=既存の published を尊重）。1タスク=（生徒,科目）の残コマ。
  const progress = await getKoushuPlacementProgressByPeriod(period, 'individual');
  const tasks: Array<{
    student_id: string;
    subjectId: string;
    remaining: number;
    student?: { id: string; last_name: string; first_name: string; grade: number };
  }> = [];
  for (const [student_id, v] of Array.from(progress.entries())) {
    for (const [subjectId, b] of Object.entries(v.bySubject)) {
      const rem = b.enrolled - b.placed;
      if (rem > 0) tasks.push({ student_id, subjectId, remaining: rem, student: v.student });
    }
  }
  // 残コマの多い（生徒,科目）から処理
  tasks.sort((a, b) => b.remaining - a.remaining);

  if (tasks.length === 0 || slots.length === 0 || dates.length === 0) {
    return { batchId: null, proposalsCreated: 0, unmatched: [] };
  }

  const studentIds = Array.from(new Set(tasks.map((t) => t.student_id)));

  // 生徒の希望ルール（指名固定/NG/性別）を一括取得
  const { data: studentRows } = await db
    .from('students')
    .select('id, preferred_teacher_gender, fixed_teacher_ids, excluded_teacher_ids')
    .in('id', studentIds);
  const rulesByStudent = new Map<
    string,
    { fixed: Set<string>; excluded: Set<string>; gender: 'male' | 'female' | null }
  >();
  for (const r of (studentRows ?? []) as Array<{
    id: string;
    preferred_teacher_gender: 'male' | 'female' | null;
    fixed_teacher_ids: string[] | null;
    excluded_teacher_ids: string[] | null;
  }>) {
    rulesByStudent.set(r.id, {
      fixed: new Set(r.fixed_teacher_ids ?? []),
      excluded: new Set(r.excluded_teacher_ids ?? []),
      gender: r.preferred_teacher_gender ?? null,
    });
  }

  // 過去6か月の担当講師（生徒別）
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const pastFrom = sixMonthsAgo.toISOString().slice(0, 10);
  const { data: pastEntries } = await db
    .from('schedule_entries')
    .select('student_id, teacher_id')
    .in('student_id', studentIds)
    .gte('entry_date', pastFrom)
    .not('teacher_id', 'is', null);
  const pastByStudent = new Map<string, Set<string>>();
  for (const e of (pastEntries ?? []) as Array<{ student_id: string; teacher_id: string }>) {
    if (!pastByStudent.has(e.student_id)) pastByStudent.set(e.student_id, new Set());
    pastByStudent.get(e.student_id)!.add(e.teacher_id);
  }

  // 出勤可能講師の profile を一括取得
  const allTeacherIds = Array.from(new Set(Array.from(dayMap.byDayOfWeek.values()).flat()));
  const profileById = new Map<string, TeacherProfile>();
  if (allTeacherIds.length > 0) {
    const { data: profiles } = await db
      .from('user_profiles')
      .select('id, display_name, email, gender, teachable_subject_ids')
      .in('id', allTeacherIds)
      .eq('is_active', true);
    for (const p of (profiles ?? []) as TeacherProfile[]) profileById.set(p.id, p);
  }

  // 既存の個別講習エントリで占有状況を初期化（席数 / 講師あたり / 生徒の使用済みコマ）
  const seatsUsed = new Map<string, number>(); // `${date}|${slotId}` -> 人数
  const teacherOccupancy = new Map<string, number>(); // `${date}|${slotId}|${teacherId}` -> 人数
  const studentSlotsUsed = new Map<string, Set<string>>(); // studentId -> Set(`${date}|${slotId}`)
  const studentKomaPerDay = new Map<string, number>(); // `${studentId}|${date}` -> 数
  const { data: existing } = await db
    .from('schedule_entries')
    .select('student_id, teacher_id, entry_date, time_slot_id')
    .eq('school_id', schoolId)
    .eq('kind', 'koushu')
    .eq('formation', 'individual')
    .gte('entry_date', period.schedule_start_date)
    .lte('entry_date', period.schedule_end_date)
    .in('status', ['scheduled', 'completed', 'transferred_in']);
  for (const e of (existing ?? []) as Array<{
    student_id: string;
    teacher_id: string | null;
    entry_date: string;
    time_slot_id: string;
  }>) {
    const cell = `${e.entry_date}|${e.time_slot_id}`;
    seatsUsed.set(cell, (seatsUsed.get(cell) ?? 0) + 1);
    if (e.teacher_id)
      teacherOccupancy.set(
        `${cell}|${e.teacher_id}`,
        (teacherOccupancy.get(`${cell}|${e.teacher_id}`) ?? 0) + 1
      );
    if (!studentSlotsUsed.has(e.student_id)) studentSlotsUsed.set(e.student_id, new Set());
    studentSlotsUsed.get(e.student_id)!.add(cell);
    const k = `${e.student_id}|${e.entry_date}`;
    studentKomaPerDay.set(k, (studentKomaPerDay.get(k) ?? 0) + 1);
  }

  // --- 配置（貪欲・ラウンド方式で期間内に均等分散） ---
  const proposals: Array<{
    student_id: string;
    teacher_id: string;
    proposal_date: string;
    time_slot_id: string;
    subject_ids: string[];
    formation: 'individual';
    kind: 'koushu';
    match_meta: { score: number; reasons: string[]; conflicts: string[] };
  }> = [];
  const unmatched: KoushuMatchResult['unmatched'] = [];

  for (const task of tasks) {
    const sid = task.student_id;
    const rules = rulesByStudent.get(sid) ?? {
      fixed: new Set<string>(),
      excluded: new Set<string>(),
      gender: null,
    };
    const pastSet = pastByStudent.get(sid) ?? new Set<string>();
    const subjectIds = [task.subjectId]; // この (生徒,科目) タスクは単一科目で配置
    let need = task.remaining;

    // ラウンド方式：日付を1周しながら1日1コマずつ置く → 期間に均等分散しつつ1日上限を尊重。
    // studentKomaPerDay / studentSlotsUsed は生徒単位なので、同生徒の他科目の配置も込みで上限を尊重する。
    let progressed = true;
    while (need > 0 && progressed) {
      progressed = false;
      for (const date of dates) {
        if (need <= 0) break;
        const perDayKey = `${sid}|${date}`;
        if ((studentKomaPerDay.get(perDayKey) ?? 0) >= maxPerDay) continue;

        const dow = dowOf(date);
        const dowTeachers = dayMap.byDayOfWeek.get(dow) ?? [];
        if (dowTeachers.length === 0) continue;

        for (const slot of slots) {
          const cell = `${date}|${slot.id}`;
          if (studentSlotsUsed.get(sid)?.has(cell) ?? false) continue; // 同生徒同コマ重複回避
          if ((seatsUsed.get(cell) ?? 0) >= totalSeats) continue; // 教室席数

          // 候補講師：この曜日に出勤可能 ∩ このコマで担当上限未満
          const scored: ScoredTeacher[] = [];
          for (const tid of dowTeachers) {
            if ((teacherOccupancy.get(`${cell}|${tid}`) ?? 0) >= maxPerTeacher) continue;
            const prof = profileById.get(tid);
            if (!prof) continue;
            const s = scoreTeacher({
              teacher: prof,
              fixedSet: rules.fixed,
              excludedSet: rules.excluded,
              preferredGender: rules.gender,
              pastSet,
              subjectIds,
            });
            if (s) scored.push(s);
          }
          if (scored.length === 0) continue;

          // 科目一致を優先（subjectOut=false を上位に）。同条件ならスコア降順。
          scored.sort((a, b) => Number(a.subjectOut) - Number(b.subjectOut) || b.score - a.score);
          const best = scored[0];

          proposals.push({
            student_id: sid,
            teacher_id: best.teacherId,
            proposal_date: date,
            time_slot_id: slot.id,
            subject_ids: subjectIds, // 単一科目
            formation: 'individual',
            kind: 'koushu',
            match_meta: { score: best.score, reasons: best.reasons, conflicts: best.conflicts },
          });
          // 状態更新
          seatsUsed.set(cell, (seatsUsed.get(cell) ?? 0) + 1);
          teacherOccupancy.set(
            `${cell}|${best.teacherId}`,
            (teacherOccupancy.get(`${cell}|${best.teacherId}`) ?? 0) + 1
          );
          if (!studentSlotsUsed.has(sid)) studentSlotsUsed.set(sid, new Set());
          studentSlotsUsed.get(sid)!.add(cell);
          studentKomaPerDay.set(perDayKey, (studentKomaPerDay.get(perDayKey) ?? 0) + 1);
          need -= 1;
          progressed = true;
          break; // この日付はこのラウンドでは1コマだけ
        }
      }
    }
    if (need > 0) {
      unmatched.push({
        student_id: sid,
        student_name: task.student
          ? `${task.student.last_name}${task.student.first_name}`
          : undefined,
        remaining: need,
        reason: '出勤可能な講師・空きコマが不足',
      });
    }
  }

  if (proposals.length === 0) {
    return { batchId: null, proposalsCreated: 0, unmatched };
  }

  const batch = await createMatchBatch({
    school_id: schoolId,
    setting_id: input.settingId ?? null,
    executed_by: executedBy,
    mode: input.mode ?? 'partial',
    notes: `講習個別マッチング ${period.label}`,
    proposals,
  });

  return { batchId: batch.id, proposalsCreated: proposals.length, unmatched };
}
