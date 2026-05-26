/**
 * 講習期間 (course_prep_periods) と申込集計の統合 API
 *
 * 用途：
 *  - 座席表の講習配置パネル (KoushuPlacementPanel) が「現在/直近の春期/夏期/冬期」を
 *    起点に「申込コマ vs 配置済みコマ」を集計するための情報を集める。
 *  - seasonal_courses は course_id 単位だが、ユーザーの mental model は
 *    「春期/夏期/冬期 (期間つき)」なので season + year で集約する。
 *
 * 仕様:
 *  - 期間ソース: course_prep_periods.schedule_start_date / schedule_end_date
 *  - 申込ソース: koushu_enrollments (seasonal_courses.season = 該当 season を満たすコース配下)
 *  - 配置済みソース: schedule_entries (kind='koushu', 期間内, student in 申込済み)
 */

import { supabase } from '@/lib/supabase';
import type { SeasonType } from '@/types/database';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface KoushuPeriodInfo {
  /** course_prep_periods.id */
  id: string;
  school_id: string;
  season: SeasonType;
  year: number;
  schedule_start_date: string;
  schedule_end_date: string;
  label: string; // 例: "2026 夏期講習"
}

const SEASON_LABEL_JA: Record<SeasonType, string> = {
  spring: '春期',
  summer: '夏期',
  winter: '冬期',
};

/**
 * 学校の「設定済み講習期間」一覧。
 * schedule_start_date / schedule_end_date が両方入っているレコードだけ採用（未設定のものは座席表用途では役に立たないため）。
 * 並び順は新しい期間が先頭。
 */
export async function getKoushuPeriods(schoolId: string): Promise<KoushuPeriodInfo[]> {
  const { data, error } = await db
    .from('course_prep_periods')
    .select('id, school_id, season, year, schedule_start_date, schedule_end_date')
    .eq('school_id', schoolId)
    .not('schedule_start_date', 'is', null)
    .not('schedule_end_date', 'is', null)
    .order('year', { ascending: false })
    .order('season', { ascending: true });

  if (error) {
    console.error('Error fetching koushu periods:', error);
    throw new Error('講習期間の取得に失敗しました');
  }
  return ((data || []) as Array<{
    id: string;
    school_id: string;
    season: SeasonType;
    year: number;
    schedule_start_date: string;
    schedule_end_date: string;
  }>).map((p) => ({
    id: p.id,
    school_id: p.school_id,
    season: p.season,
    year: p.year,
    schedule_start_date: p.schedule_start_date,
    schedule_end_date: p.schedule_end_date,
    label: `${p.year} ${SEASON_LABEL_JA[p.season]}講習`,
  }));
}

/** 指定日（既定は今日）に該当する講習期間。複数あれば最新優先 */
export async function getCurrentKoushuPeriod(
  schoolId: string,
  asOfDate?: string
): Promise<KoushuPeriodInfo | null> {
  const today = asOfDate ?? new Date().toISOString().slice(0, 10);
  const periods = await getKoushuPeriods(schoolId);
  // 今日が期間内にあるものを最新優先で返す
  const hits = periods.filter(
    (p) => p.schedule_start_date <= today && today <= p.schedule_end_date
  );
  return hits[0] ?? null;
}

/**
 * 期間 (season + year + school_id) に該当する生徒別申込集計と配置済みコマ数を返す。
 *
 * 戻り値: Map<student_id, { enrolled: 申込合計, placed: 配置済み, subject_ids[], student }>
 */
export async function getKoushuPlacementProgressByPeriod(
  period: KoushuPeriodInfo
): Promise<
  Map<
    string,
    {
      enrolled: number;
      placed: number;
      subject_ids: string[];
      student?: { id: string; last_name: string; first_name: string; grade: number };
    }
  >
> {
  // 1. 該当 season + school_id の seasonal_courses をすべて取得
  const { data: courses } = await db
    .from('seasonal_courses')
    .select('id')
    .eq('school_id', period.school_id)
    .eq('season', period.season)
    .eq('is_active', true);

  const courseIds = ((courses || []) as { id: string }[]).map((c) => c.id);
  if (courseIds.length === 0) return new Map();

  // 2. それらの koushu_enrollments を student_id で集約
  const { data: enrollments } = await db
    .from('koushu_enrollments')
    .select('student_id, koma_count, subject_ids, student:students(id, last_name, first_name, grade)')
    .in('course_id', courseIds);

  type EnrollmentRow = {
    student_id: string;
    koma_count: number;
    subject_ids: string[];
    student?:
      | { id: string; last_name: string; first_name: string; grade: number }
      | Array<{ id: string; last_name: string; first_name: string; grade: number }>;
  };

  type Agg = {
    enrolled: number;
    placed: number;
    subject_ids: string[];
    student?: { id: string; last_name: string; first_name: string; grade: number };
  };
  const aggregated = new Map<string, Agg>();
  for (const e of (enrollments || []) as EnrollmentRow[]) {
    const studentObj = Array.isArray(e.student) ? e.student[0] : e.student;
    const existing = aggregated.get(e.student_id);
    if (existing) {
      existing.enrolled += e.koma_count;
      // subject_ids は union（重複排除）
      const merged = new Set([...existing.subject_ids, ...(e.subject_ids ?? [])]);
      existing.subject_ids = Array.from(merged);
    } else {
      aggregated.set(e.student_id, {
        enrolled: e.koma_count,
        placed: 0,
        subject_ids: e.subject_ids ?? [],
        student: studentObj,
      });
    }
  }

  if (aggregated.size === 0) return aggregated;

  // 3. 期間内の koushu 配置済みコマ数を student_id 別にカウント
  const studentIds = Array.from(aggregated.keys());
  const { data: placedEntries } = await db
    .from('schedule_entries')
    .select('student_id')
    .eq('school_id', period.school_id)
    .eq('kind', 'koushu')
    .in('student_id', studentIds)
    .gte('entry_date', period.schedule_start_date)
    .lte('entry_date', period.schedule_end_date)
    .in('status', ['scheduled', 'completed', 'transferred_in']);

  for (const e of (placedEntries || []) as { student_id: string }[]) {
    const agg = aggregated.get(e.student_id);
    if (agg) agg.placed += 1;
  }

  return aggregated;
}
