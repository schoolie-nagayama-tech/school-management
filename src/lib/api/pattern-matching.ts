/**
 * 通塾日程パターン × 講師マッチング API
 *
 * 未割当パターン (teacher_id IS NULL) に対して
 *  - シフト一致 (その曜日・時間帯に出勤可能)
 *  - 教科対応 (teachable_subjects に該当)
 *  - 担当固定 / 指名 NG ルール
 * を考慮した候補講師を返す。
 *
 * 割当時はパターン .teacher_id を更新 + 既存の schedule_entries も同時更新
 * (担当未決定エントリ → 担当決定エントリに変える)。
 */

import { supabase } from '@/lib/supabase';
import { getCurrentTeacherShifts } from '@/lib/api/teacher-shifts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface PatternMatchCandidate {
  user_id: string;
  display_name: string | null;
  email: string | null;
  gender: 'male' | 'female' | 'other' | null;
  /** スコア。高いほど優先度が高い候補 */
  score: number;
  /** スコアの根拠ラベル（UIで「なぜこの候補か」を見せる） */
  reasons: string[];
  /** 警告ラベル（容量超過・希望ルール抵触などソフト警告） */
  warnings: string[];
}

export interface UnassignedPatternRow {
  id: string;
  school_id: string;
  student_id: string;
  day_of_week: number;
  time_slot_id: string;
  subject_ids: string[];
  period_type: string;
  student?: { id: string; last_name: string; first_name: string; grade: number };
  time_slot?: { id: string; slot_number: number; start_time: string; end_time: string };
  /** 過去その学生を担当した経験のある講師ID（過去6か月） */
  past_teacher_ids?: string[];
}

/** 未割当（teacher_id NULL）パターン一覧。学生情報付き */
export async function getUnassignedPatterns(
  schoolId: string
): Promise<UnassignedPatternRow[]> {
  const { data, error } = await db
    .from('schedule_regular_patterns')
    .select(
      'id, school_id, student_id, day_of_week, time_slot_id, subject_ids, period_type, student:students(id, last_name, first_name, grade), time_slot:schedule_time_slots(id, slot_number, start_time, end_time)'
    )
    .eq('school_id', schoolId)
    .is('teacher_id', null)
    .eq('is_active', true)
    .order('day_of_week', { ascending: true })
    .order('time_slot_id', { ascending: true });

  if (error) {
    console.error('Error fetching unassigned patterns:', error);
    throw new Error('未割当パターンの取得に失敗しました');
  }
  type Row = UnassignedPatternRow & {
    student?: UnassignedPatternRow['student'] | UnassignedPatternRow['student'][];
    time_slot?: UnassignedPatternRow['time_slot'] | UnassignedPatternRow['time_slot'][];
  };
  return ((data || []) as Row[]).map((r) => ({
    ...r,
    student: Array.isArray(r.student) ? r.student[0] : r.student,
    time_slot: Array.isArray(r.time_slot) ? r.time_slot[0] : r.time_slot,
  }));
}

/**
 * 1パターンに対する候補講師リストを返す。
 * シフト一致 + 教科対応 + 学生希望ルールで絞り込み・スコア付け。
 */
export async function getPatternMatchCandidates(
  schoolId: string,
  pattern: UnassignedPatternRow,
  asOfDate?: string
): Promise<PatternMatchCandidate[]> {
  // 1. 当該曜日に出勤可能な講師IDを取得（期間考慮）
  const shifts = await getCurrentTeacherShifts(schoolId, asOfDate);
  const dowAvailable = shifts.byDayOfWeek.get(pattern.day_of_week) ?? [];
  if (dowAvailable.length === 0) return [];

  // 2. 学生の希望ルールを取得
  const { data: student } = await db
    .from('students')
    .select('preferred_teacher_gender, fixed_teacher_ids, excluded_teacher_ids')
    .eq('id', pattern.student_id)
    .maybeSingle();
  const stu = (student ?? {}) as {
    preferred_teacher_gender: 'male' | 'female' | null;
    fixed_teacher_ids: string[] | null;
    excluded_teacher_ids: string[] | null;
  };
  const fixedSet = new Set(stu.fixed_teacher_ids ?? []);
  const excludedSet = new Set(stu.excluded_teacher_ids ?? []);

  // 3. 該当生徒の過去担当講師（過去 6 か月）
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const pastFrom = sixMonthsAgo.toISOString().slice(0, 10);
  const { data: pastEntries } = await db
    .from('schedule_entries')
    .select('teacher_id')
    .eq('student_id', pattern.student_id)
    .gte('entry_date', pastFrom)
    .not('teacher_id', 'is', null);
  const pastTeacherSet = new Set(
    ((pastEntries || []) as Array<{ teacher_id: string }>).map((p) => p.teacher_id)
  );

  // 4. 該当曜日で出勤可能な講師の profile を一括取得
  const { data: profiles } = await db
    .from('user_profiles')
    .select('id, display_name, email, gender, teachable_subject_ids')
    .in('id', dowAvailable)
    .eq('is_active', true);

  type Profile = {
    id: string;
    display_name: string | null;
    email: string | null;
    gender: 'male' | 'female' | 'other' | null;
    teachable_subject_ids: string[] | null;
  };

  // 5. 候補をスコア付け
  const candidates: PatternMatchCandidate[] = [];
  for (const p of (profiles || []) as Profile[]) {
    // ハード除外：指名NG
    if (excludedSet.has(p.id)) continue;
    // 希望性別フィルタ（指定があってマッチしない場合は除外）
    if (stu.preferred_teacher_gender && p.gender && p.gender !== stu.preferred_teacher_gender) {
      continue;
    }

    let score = 0;
    const reasons: string[] = [];
    const warnings: string[] = [];

    // +50: 担当固定リストに含まれている
    if (fixedSet.has(p.id)) {
      score += 50;
      reasons.push('担当固定');
    }
    // +30: 過去6か月でこの生徒を見たことがある
    if (pastTeacherSet.has(p.id)) {
      score += 30;
      reasons.push('過去担当');
    }
    // +20: 教科対応 (パターンの subject_ids と1つ以上重複)
    const teachable = new Set(p.teachable_subject_ids ?? []);
    const teachableMatch = pattern.subject_ids.some((sid) => teachable.has(sid));
    if (teachableMatch) {
      score += 20;
      reasons.push('教科対応');
    } else if (pattern.subject_ids.length > 0 && teachable.size > 0) {
      warnings.push('教科未対応');
    }
    // +10: 性別希望に合致 (希望ありの場合)
    if (stu.preferred_teacher_gender && p.gender === stu.preferred_teacher_gender) {
      reasons.push('希望性別一致');
      score += 10;
    }
    // +5: 出勤可能 (前提条件、ベースライン)
    score += 5;
    reasons.push('出勤可能');

    candidates.push({
      user_id: p.id,
      display_name: p.display_name,
      email: p.email,
      gender: p.gender,
      score,
      reasons,
      warnings,
    });
  }

  // 高スコア順
  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

/**
 * パターンに講師を割り当てる。
 * pattern.teacher_id を更新し、既存の「担当未決定」エントリ (teacher_id NULL かつ
 * regular_pattern_id = pattern.id) を新講師に書き換える。
 * 過去日付のエントリは触らず、今日以降のものだけ更新。
 */
export async function assignTeacherToPattern(
  patternId: string,
  teacherId: string,
  options?: { updateFutureEntriesOnly?: boolean }
): Promise<{ patternUpdated: boolean; entriesUpdated: number }> {
  // 1. パターン更新
  const { error: patUpdErr } = await db
    .from('schedule_regular_patterns')
    .update({ teacher_id: teacherId })
    .eq('id', patternId);
  if (patUpdErr) {
    console.error('Failed to update pattern teacher_id:', patUpdErr);
    throw new Error('パターンの講師更新に失敗しました');
  }

  // 2. 既存エントリ更新（今日以降の担当未決定エントリのみ）
  const today = new Date().toISOString().slice(0, 10);
  let query = db
    .from('schedule_entries')
    .update({ teacher_id: teacherId })
    .eq('regular_pattern_id', patternId)
    .is('teacher_id', null);
  if (options?.updateFutureEntriesOnly !== false) {
    query = query.gte('entry_date', today);
  }
  const { data: updated, error: entUpdErr } = await query.select('id');
  if (entUpdErr) {
    console.warn('Failed to update entries (pattern saved, but entries left unassigned):', entUpdErr);
    return { patternUpdated: true, entriesUpdated: 0 };
  }
  return {
    patternUpdated: true,
    entriesUpdated: (updated as Array<{ id: string }>)?.length ?? 0,
  };
}
