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
import { fetchAllPaged, fetchAllInChunks } from '@/lib/utils/supabasePaging';
import type { SeasonType } from '@/types/database';
import type { ScheduleEntryFormation } from '@/types/schedule';
import { normalizeKomaBySubject, type KomaSpec } from '@/lib/utils/komaBySubject';
// Phase A: 講習は個別のみ対象。'individual' 直値を定数参照に置換（意図は現状維持）。
import { INDIVIDUAL_FORMATION } from '@/types/schedule';

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
  return (
    (data || []) as Array<{
      id: string;
      school_id: string;
      season: SeasonType;
      year: number;
      schedule_start_date: string;
      schedule_end_date: string;
    }>
  ).map((p) => ({
    id: p.id,
    school_id: p.school_id,
    season: p.season,
    year: p.year,
    schedule_start_date: p.schedule_start_date,
    schedule_end_date: p.schedule_end_date,
    label: `${p.year} ${SEASON_LABEL_JA[p.season]}講習`,
  }));
}

/**
 * 講習期間中に発生する「通常授業の回数」を概算する。
 * 申込入力で個別コマ数の初期値（＝講習期間中も従来どおり通う想定の最低ライン）として使う。
 * 算出 = その生徒の有効な個別の通塾日程パターン数（≒週あたりのコマ数）× 期間の週数（端数切り上げ）。
 * あくまで初期表示用の概算。室長が手で調整する前提。
 */
export async function estimateRegularKomaInPeriod(
  studentId: string,
  period: KoushuPeriodInfo
): Promise<number> {
  const start = new Date(period.schedule_start_date + 'T00:00:00');
  const end = new Date(period.schedule_end_date + 'T00:00:00');
  const days = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
  const weeks = Math.max(1, Math.ceil(days / 7));

  // 個別の通塾日程パターン数 = 週あたりの個別コマ数。effective 厳密判定はせず概算でよい。
  const { data } = await db
    .from('schedule_regular_patterns')
    .select('id')
    .eq('student_id', studentId)
    // 講習の増コマ概算は個別コマ数を基準にする（講習は個別のみ対象）
    .eq('formation', INDIVIDUAL_FORMATION);
  const weekly = (data ?? []).length;
  return weekly * weeks;
}

/**
 * 生徒の通塾日程サマリ（個別の有効な通塾日程パターン）を取得。
 * 講習配置時に「この生徒は普段いつ来ているか」を見て落とし込む判断材料にする。
 */
export async function getStudentRegularSchedule(studentId: string): Promise<
  Array<{
    day_of_week: number;
    slot_number: number;
    start_time: string;
    end_time: string;
    subject_ids: string[];
  }>
> {
  const { data } = await db
    .from('schedule_regular_patterns')
    .select(
      'day_of_week, subject_ids, time_slot:schedule_time_slots(slot_number, start_time, end_time)'
    )
    .eq('student_id', studentId)
    .eq('is_active', true)
    // 講習配置の参考にする通塾日程は個別のみ（講習は個別レーン）
    .eq('formation', INDIVIDUAL_FORMATION);
  type Row = {
    day_of_week: number;
    subject_ids: string[] | null;
    time_slot?:
      | { slot_number: number; start_time: string; end_time: string }
      | Array<{ slot_number: number; start_time: string; end_time: string }>;
  };
  return ((data ?? []) as Row[])
    .map((r) => {
      const ts = Array.isArray(r.time_slot) ? r.time_slot[0] : r.time_slot;
      return {
        day_of_week: r.day_of_week,
        slot_number: ts?.slot_number ?? 0,
        start_time: ts?.start_time ?? '',
        end_time: ts?.end_time ?? '',
        subject_ids: r.subject_ids ?? [],
      };
    })
    .sort((a, b) => a.day_of_week - b.day_of_week || a.slot_number - b.slot_number);
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
export interface KoushuPlacementRow {
  enrolled: number;
  placed: number;
  subject_ids: string[];
  /** 科目別の申込/配置 { subject_id: { enrolled, placed } } */
  bySubject: Record<string, { enrolled: number; placed: number }>;
  student?: { id: string; last_name: string; first_name: string; grade: number };
}

export async function getKoushuPlacementProgressByPeriod(
  period: KoushuPeriodInfo,
  formation?: ScheduleEntryFormation
): Promise<Map<string, KoushuPlacementRow>> {
  type EnrollmentRow = {
    student_id: string;
    koma_count: number;
    subject_ids: string[];
    // number（旧形式）/ KomaSpec（新形式）の両方が来うる。読み出しは正規化アクセサに一本化する。
    koma_by_subject?: Record<string, number | KomaSpec> | null;
    student?:
      | { id: string; last_name: string; first_name: string; grade: number }
      | Array<{ id: string; last_name: string; first_name: string; grade: number }>;
  };

  // 申込は期間(school + season)で直接取得（コース依存を廃止）。formation 指定時はその形態のみ。
  // 講習申込は (生徒数 × 科目) でスケールし1000行を超えうるため全件ページング取得する
  // （切り捨てると座席表の講習配置パネルの申込数・残数が誤る）。id 昇順で安定ページング。
  const enrollments = await fetchAllPaged<EnrollmentRow>((from, to) => {
    let q = db
      .from('koushu_enrollments')
      .select(
        'student_id, koma_count, subject_ids, koma_by_subject, student:students(id, last_name, first_name, grade)'
      )
      .eq('school_id', period.school_id)
      .eq('season', period.season);
    if (formation) q = q.eq('formation', formation);
    return q.order('id', { ascending: true }).range(from, to);
  });

  // 申込の科目別コマ数（koma_by_subject 優先。無ければ単一科目に総コマ数を寄せる後方互換）。
  // koma_by_subject は number/KomaSpec が混在しうるためアクセサで正規化してから koma だけ取り出す。
  const subjectEnrollOf = (e: EnrollmentRow): Record<string, number> => {
    const normalized = normalizeKomaBySubject(e.koma_by_subject);
    if (Object.keys(normalized).length > 0) {
      return Object.fromEntries(Object.entries(normalized).map(([sid, spec]) => [sid, spec.koma]));
    }
    // koma_by_subject が空（未設定/全滅）で単一科目申込のときだけ、総コマ数をその科目に寄せる
    // 後方互換（既存データの表示を変えないため。§9-2 では意図的に維持する挙動）。
    if ((e.subject_ids ?? []).length === 1) return { [e.subject_ids[0]]: e.koma_count };
    return {};
  };

  const aggregated = new Map<string, KoushuPlacementRow>();
  for (const e of enrollments) {
    const studentObj = Array.isArray(e.student) ? e.student[0] : e.student;
    let agg = aggregated.get(e.student_id);
    if (!agg) {
      agg = { enrolled: 0, placed: 0, subject_ids: [], bySubject: {}, student: studentObj };
      aggregated.set(e.student_id, agg);
    }
    agg.enrolled += e.koma_count;
    agg.subject_ids = Array.from(new Set([...agg.subject_ids, ...(e.subject_ids ?? [])]));
    for (const [sid, n] of Object.entries(subjectEnrollOf(e))) {
      if (!agg.bySubject[sid]) agg.bySubject[sid] = { enrolled: 0, placed: 0 };
      agg.bySubject[sid].enrolled += n;
    }
  }

  if (aggregated.size === 0) return aggregated;

  // 3. 期間内の koushu 配置済みコマ数を student_id 別にカウント
  const studentIds = Array.from(aggregated.keys());
  // 配置済みは (生徒数 × 配置コマ) でスケールし1000行を超えうる。studentIds も多いと
  // .in() の URL が長くなるため、チャンク分割 + チャンク内ページングの両対応で取得する。
  const placedEntries = await fetchAllInChunks<{
    student_id: string;
    subject_ids: string[] | null;
  }>(studentIds, (chunk, from, to) => {
    let q = db
      .from('schedule_entries')
      .select('student_id, subject_ids')
      .eq('school_id', period.school_id)
      .eq('kind', 'koushu')
      .in('student_id', chunk)
      .gte('entry_date', period.schedule_start_date)
      .lte('entry_date', period.schedule_end_date)
      .in('status', ['scheduled', 'completed', 'transferred_in']);
    if (formation) q = q.eq('formation', formation);
    return q.order('id', { ascending: true }).range(from, to);
  });

  for (const e of placedEntries) {
    const agg = aggregated.get(e.student_id);
    if (!agg) continue;
    agg.placed += 1;
    // 配置済みを科目別にも反映（新しい配置は単一科目。複数科目の旧データは各科目に計上）
    for (const sid of e.subject_ids ?? []) {
      if (!agg.bySubject[sid]) agg.bySubject[sid] = { enrolled: 0, placed: 0 };
      agg.bySubject[sid].placed += 1;
    }
  }

  return aggregated;
}
