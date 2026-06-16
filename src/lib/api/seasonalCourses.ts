import { supabase } from '@/lib/supabase';
import { withFetchCache } from '@/lib/utils/fetchCache';
import type {
  SeasonalCourse,
  SeasonalCourseTextbook,
  SeasonalCourseCurriculum,
  SeasonalCourseApplication,
  SeasonalCourseWithDetails,
  SeasonType,
  CurriculumItem,
  CourseCurriculumRow,
} from '@/types/database';
import type { ScheduleEntryFormation } from '@/types/schedule';

// =====================================================
// 講習機能（座席表連携）用の型定義
// =====================================================

/** seasonal_courses に追加した期間カラムを含む型 */
export interface KoushuCourse {
  id: string;
  school_id: string | null;
  name: string;
  season: string;
  target_grades: number[];
  total_koma: number;
  comment: string | null;
  is_active: boolean;
  start_date: string | null;
  end_date: string | null;
  created_at: string | null;
  updated_at: string | null;
  enrollment_count?: number;
}

/** 講習申し込み（座席表連携用: koushu_enrollments テーブル） */
export interface KoushuEnrollment {
  id: string;
  /** コース依存を廃止し期間(school+season)ベースに。直接申込は course_id=null */
  course_id: string | null;
  school_id?: string | null;
  season?: string | null;
  student_id: string;
  /** 個別 / 集団。同一生徒でも formation 別に行を持つ（UNIQUE: course_id+student_id+formation） */
  formation: ScheduleEntryFormation;
  koma_count: number;
  subject_ids: string[];
  /** 科目別コマ数 { subject_id: コマ数 }。koma_count はこの総和、subject_ids はキー集合。 */
  koma_by_subject?: Record<string, number>;
  created_at: string | null;
  updated_at: string | null;
  student?: {
    id: string;
    last_name: string;
    first_name: string;
    grade: number;
  };
}

// =====================================================
// 講習 CRUD（座席表連携）
// =====================================================

/** 学校の講習一覧を取得（start_date/end_date含む） */
export async function getSchoolKoushu(schoolId: string): Promise<KoushuCourse[]> {
  const { data, error } = await supabase
    .from('seasonal_courses')
    .select('*')
    .eq('school_id', schoolId)
    .eq('is_active', true)
    .order('start_date', { ascending: false, nullsFirst: false });

  if (error) throw error;

  const courses = (data || []) as KoushuCourse[];
  if (courses.length === 0) return [];

  // 登録人数を集計。講習ごとに count クエリを投げていた（N+1）のを、
  // 全講習分の enrollment を course_id のみで1クエリ取得し、JS で件数を数える。
  const courseIds = courses.map((c) => c.id);
  const countByCourse = new Map<string, number>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: enrollments } = await (supabase as any)
    .from('koushu_enrollments')
    .select('course_id')
    .in('course_id', courseIds);
  for (const e of (enrollments || []) as Array<{ course_id: string }>) {
    countByCourse.set(e.course_id, (countByCourse.get(e.course_id) ?? 0) + 1);
  }

  return courses.map((c) => ({ ...c, enrollment_count: countByCourse.get(c.id) ?? 0 }));
}

/** 講習を作成 */
export async function createKoushu(
  schoolId: string,
  data: {
    name: string;
    season: string;
    start_date: string | null;
    end_date: string | null;
    target_grades?: number[];
    total_koma?: number;
    comment?: string;
  }
): Promise<KoushuCourse> {
  const { data: course, error } = await supabase
    .from('seasonal_courses')
    .insert({ school_id: schoolId, ...data })
    .select()
    .single();

  if (error) throw error;
  return course as KoushuCourse;
}

/** 講習を更新 */
export async function updateKoushu(
  courseId: string,
  data: Partial<{
    name: string;
    season: string;
    start_date: string | null;
    end_date: string | null;
    target_grades: number[];
    total_koma: number;
    comment: string | null;
  }>
): Promise<KoushuCourse> {
  const { data: course, error } = await supabase
    .from('seasonal_courses')
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq('id', courseId)
    .select()
    .single();

  if (error) throw error;
  return course as KoushuCourse;
}

/** 講習を削除（論理削除） */
export async function deleteKoushu(courseId: string): Promise<void> {
  const { error } = await supabase
    .from('seasonal_courses')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', courseId);

  if (error) throw error;
}

// =====================================================
// 講習申し込み管理（koushu_enrollments）
// =====================================================

/**
 * 講習申し込みの「残数」を取得：申し込みコマ数に対し、座席表に何コマ配置済みかを集計。
 *
 * 用途：座席表の「講習配置パネル」で「Aさん 5コマ中 3コマ配置済み」のように表示する。
 *
 * @returns Map<student_id, { enrolled: 申込コマ数, placed: 座席表配置済み, subject_ids }>
 */
export async function getKoushuPlacementProgress(
  course: KoushuCourse
): Promise<Map<string, { enrolled: number; placed: number; subject_ids: string[]; student: KoushuEnrollment['student'] }>> {
  if (!course.start_date || !course.end_date) {
    return new Map();
  }
  const enrollments = await getKoushuEnrollments(course.id);
  if (enrollments.length === 0) return new Map();

  // 該当期間 × 該当生徒 × kind='koushu' の schedule_entries を取得して集計
  const studentIds = enrollments.map((e) => e.student_id);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: entries } = await (supabase as any)
    .from('schedule_entries')
    .select('student_id')
    .eq('school_id', course.school_id)
    .eq('kind', 'koushu')
    .in('student_id', studentIds)
    .gte('entry_date', course.start_date)
    .lte('entry_date', course.end_date)
    .in('status', ['scheduled', 'completed', 'transferred_in']);

  const placedMap = new Map<string, number>();
  for (const e of (entries || []) as { student_id: string }[]) {
    placedMap.set(e.student_id, (placedMap.get(e.student_id) ?? 0) + 1);
  }

  const result = new Map<string, { enrolled: number; placed: number; subject_ids: string[]; student: KoushuEnrollment['student'] }>();
  for (const en of enrollments) {
    result.set(en.student_id, {
      enrolled: en.koma_count,
      placed: placedMap.get(en.student_id) ?? 0,
      subject_ids: en.subject_ids,
      student: en.student,
    });
  }
  return result;
}

/** 講習の申し込み一覧（生徒情報付き）を取得 */
export async function getKoushuEnrollments(courseId: string): Promise<KoushuEnrollment[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('koushu_enrollments')
    .select('*, student:students(id, last_name, first_name, grade)')
    .eq('course_id', courseId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data || []) as KoushuEnrollment[];
}

/**
 * 申し込みを登録・更新（upsert）。期間(school+season)＋生徒＋formation で1行。
 * 科目別コマ数（komaBySubject）で受け取り、koma_count（総和）と subject_ids（キー集合）は自動算出。
 * koma_by_subject が空（全0）の場合はその行を削除する（=申込なし）。
 */
export async function upsertKoushuEnrollment(
  schoolId: string,
  season: string,
  studentId: string,
  komaBySubject: Record<string, number>,
  formation: ScheduleEntryFormation = 'individual'
): Promise<void> {
  const entries = Object.entries(komaBySubject).filter(([, n]) => (n ?? 0) > 0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db2 = supabase as any;

  if (entries.length === 0) {
    // 全科目0 → 申込なしとして削除
    await db2
      .from('koushu_enrollments')
      .delete()
      .eq('school_id', schoolId)
      .eq('season', season)
      .eq('student_id', studentId)
      .eq('formation', formation);
    return;
  }

  const subjectIds = entries.map(([sid]) => sid);
  const komaCount = entries.reduce((s, [, n]) => s + n, 0);
  const komaBySubjectClean = Object.fromEntries(entries);

  const { error } = await db2
    .from('koushu_enrollments')
    .upsert(
      {
        school_id: schoolId,
        season,
        course_id: null,
        student_id: studentId,
        formation,
        koma_count: komaCount,
        subject_ids: subjectIds,
        koma_by_subject: komaBySubjectClean,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'school_id,season,student_id,formation' }
    );

  if (error) throw error;
}

/** 期間(school + season)の全申込を取得（生徒情報付き）。生徒別画面・集計用。 */
export async function getKoushuEnrollmentsForPeriod(
  schoolId: string,
  season: string
): Promise<KoushuEnrollment[]> {
  // 講習申込は (生徒数 × 形態) でスケールし、大型講習では 1000 行を超えうる。
  // PostgREST のデフォルト上限で静かに切り捨てられると配置一覧から申込が欠落するため、
  // .range() で 1000 件ずつ全件ページング取得する。created_at は一意でなくページ境界で
  // 行が重複/欠落しうるので、安定化のため id を第2ソートキーに加える。
  const PAGE_SIZE = 1000;
  const all: KoushuEnrollment[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from('koushu_enrollments')
      .select('*, student:students(id, last_name, first_name, grade)')
      .eq('school_id', schoolId)
      .eq('season', season)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;
    const rows = (data || []) as KoushuEnrollment[];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return all;
}

/** 申し込みを削除 */
export async function deleteKoushuEnrollment(enrollmentId: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('koushu_enrollments')
    .delete()
    .eq('id', enrollmentId);

  if (error) throw error;
}

/**
 * 講習の配置済みコマ数を生徒ごとに集計。
 * kind='koushu' のみを数える（通常授業を混ぜない）。formation 指定時はその形態だけ。
 */
export async function getKoushuScheduledCounts(
  schoolId: string,
  startDate: string,
  endDate: string,
  studentIds: string[],
  formation?: ScheduleEntryFormation
): Promise<Map<string, number>> {
  if (studentIds.length === 0) return new Map();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase as any)
    .from('schedule_entries')
    .select('student_id, status')
    .eq('school_id', schoolId)
    .eq('kind', 'koushu')
    .gte('entry_date', startDate)
    .lte('entry_date', endDate)
    .in('student_id', studentIds);
  if (formation) query = query.eq('formation', formation);
  const { data, error } = await query;

  if (error) throw error;

  const counts = new Map<string, number>();
  for (const entry of data || []) {
    if (entry.status === 'cancelled' || entry.status === 'transferred_out') continue;
    const current = counts.get(entry.student_id) ?? 0;
    counts.set(entry.student_id, current + 1);
  }
  return counts;
}

// =====================================================
// コースCRUD
// =====================================================

// コース一覧を取得
export async function getSeasonalCourses(schoolId: string): Promise<SeasonalCourseWithDetails[]> {
  const { data, error } = await supabase
    .from('seasonal_courses')
    .select(`
      *,
      textbooks:seasonal_course_textbooks(*, textbook:textbooks(*)),
      curriculum:seasonal_course_curriculum(*, curriculum_item:curriculum_items(*))
    `)
    .eq('school_id', schoolId)
    .eq('is_active', true)
    .order('created_at', { ascending: false });

  if (error) throw error;

  const coursesTyped = (data || []) as SeasonalCourseWithDetails[];
  if (coursesTyped.length === 0) return [];

  // 適用数を一括取得（N+1解消: コース毎にcountクエリ → 全コース分を1クエリで取得しJS側で集計）
  const courseIds = coursesTyped.map((c) => c.id);
  const { data: applications, error: appsError } = await supabase
    .from('seasonal_course_applications')
    .select('course_id')
    .in('course_id', courseIds);

  if (appsError) {
    // 申込集計の失敗はメイン機能を止めない（application_count を 0 として続行）
    console.warn('Failed to fetch application counts:', appsError);
  }

  const countMap = new Map<string, number>();
  for (const app of applications || []) {
    const cid = (app as { course_id: string }).course_id;
    countMap.set(cid, (countMap.get(cid) || 0) + 1);
  }

  return coursesTyped.map((course) => ({
    ...course,
    application_count: countMap.get(course.id) || 0,
  }));
}

/** 30秒TTLのキャッシュ付き getSeasonalCourses */
export const getCachedSeasonalCourses = withFetchCache(getSeasonalCourses, {
  ttl: 30_000,
  prefix: 'seasonalCourses',
});

// コースを取得（単体）
export async function getSeasonalCourse(courseId: string): Promise<SeasonalCourseWithDetails | null> {
  const { data, error } = await supabase
    .from('seasonal_courses')
    .select(`
      *,
      textbooks:seasonal_course_textbooks(*, textbook:textbooks(*)),
      curriculum:seasonal_course_curriculum(*, curriculum_item:curriculum_items(*))
    `)
    .eq('id', courseId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }

  return data as SeasonalCourseWithDetails | null;
}

// コースを作成
export async function createSeasonalCourse(
  schoolId: string,
  data: {
    name: string;
    season: SeasonType;
    target_grades: number[];
    total_koma?: number;
    comment?: string;
  }
): Promise<SeasonalCourse> {
  const { data: course, error } = await supabase
    .from('seasonal_courses')
    .insert({
      school_id: schoolId,
      ...data,
    })
    .select()
    .single();

  if (error) throw error;
  return course as SeasonalCourse;
}

// コースを更新
export async function updateSeasonalCourse(
  courseId: string,
  data: Partial<{
    name: string;
    season: SeasonType;
    target_grades: number[];
    total_koma: number;
    comment: string | null;
    is_active: boolean;
  }>
): Promise<SeasonalCourse> {
  const { data: course, error } = await supabase
    .from('seasonal_courses')
    .update({
      ...data,
      updated_at: new Date().toISOString(),
    })
    .eq('id', courseId)
    .select()
    .single();

  if (error) throw error;
  return course as SeasonalCourse;
}

// コースを削除（論理削除）
export async function deleteSeasonalCourse(courseId: string): Promise<void> {
  const { error } = await supabase
    .from('seasonal_courses')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', courseId);

  if (error) throw error;
}

// コースを他の教室に展開（テキスト・カリキュラム設定を含む完全コピー）
export async function deployCourseToSchools(
  courseId: string,
  targetSchoolIds: string[]
): Promise<{ created: number; skipped: number }> {
  const source = await getSeasonalCourse(courseId);
  if (!source) throw new Error('コースが見つかりません');

  let created = 0;
  let skipped = 0;

  for (const schoolId of targetSchoolIds) {
    if (schoolId === source.school_id) {
      skipped++;
      continue;
    }

    // 同名・同季節の講習が既にあればスキップ
    const { data: existing } = await supabase
      .from('seasonal_courses')
      .select('id')
      .eq('school_id', schoolId)
      .eq('name', source.name)
      .eq('season', source.season)
      .eq('is_active', true)
      .maybeSingle();

    if (existing) {
      skipped++;
      continue;
    }

    // コースを作成
    const { data: newCourse, error: cErr } = await supabase
      .from('seasonal_courses')
      .insert({
        school_id: schoolId,
        name: source.name,
        season: source.season,
        target_grades: source.target_grades,
        total_koma: source.total_koma,
        comment: source.comment,
      })
      .select()
      .single();

    if (cErr) throw cErr;

    // テキスト紐付けをコピー
    if (source.textbooks?.length > 0) {
      const tbInserts = source.textbooks.map((ct) => ({
        course_id: (newCourse as { id: string }).id,
        textbook_id: ct.textbook_id,
        sort_order: ct.sort_order,
      }));
      const { error: tbErr } = await supabase
        .from('seasonal_course_textbooks')
        .insert(tbInserts);
      if (tbErr) throw tbErr;
    }

    // カリキュラム設定をコピー
    if (source.curriculum?.length > 0) {
      const curInserts = source.curriculum
        .filter((c) => c.proposal_count > 0 || c.group_number != null)
        .map((c) => ({
          course_id: (newCourse as { id: string }).id,
          textbook_id: c.textbook_id,
          curriculum_item_id: c.curriculum_item_id,
          proposal_count: c.proposal_count,
          group_number: c.group_number,
        }));
      if (curInserts.length > 0) {
        const { error: curErr } = await supabase
          .from('seasonal_course_curriculum')
          .insert(curInserts);
        if (curErr) throw curErr;
      }
    }

    created++;
  }

  return { created, skipped };
}

// =====================================================
// コース×テキスト
// =====================================================

// テキストをコースに追加
export async function addTextbookToCourse(
  courseId: string,
  textbookId: number,
  sortOrder: number = 0
): Promise<SeasonalCourseTextbook> {
  const { data, error } = await supabase
    .from('seasonal_course_textbooks')
    .insert({
      course_id: courseId,
      textbook_id: textbookId,
      sort_order: sortOrder,
    })
    .select('*, textbook:textbooks(*)')
    .single();

  if (error) throw error;
  return data;
}

// テキストをコースから削除
export async function removeTextbookFromCourse(
  courseId: string,
  textbookId: number
): Promise<void> {
  // カリキュラム設定も削除
  await supabase
    .from('seasonal_course_curriculum')
    .delete()
    .eq('course_id', courseId)
    .eq('textbook_id', textbookId);

  // テキスト紐付けを削除
  const { error } = await supabase
    .from('seasonal_course_textbooks')
    .delete()
    .eq('course_id', courseId)
    .eq('textbook_id', textbookId);

  if (error) throw error;
}

// =====================================================
// カリキュラム設定
// =====================================================

// テキストの全カリキュラム項目とコース設定を取得
export async function getCourseCurriculum(
  courseId: string,
  textbookId: number
): Promise<{ items: CurriculumItem[]; settings: SeasonalCourseCurriculum[] }> {
  // カリキュラム項目を取得
  const { data: items, error: itemsError } = await supabase
    .from('curriculum_items')
    .select('*')
    .eq('textbook_id', textbookId)
    .order('sort_order');

  if (itemsError) throw itemsError;

  // コース設定を取得
  const { data: settings, error: settingsError } = await supabase
    .from('seasonal_course_curriculum')
    .select('*')
    .eq('course_id', courseId)
    .eq('textbook_id', textbookId);

  if (settingsError) throw settingsError;

  return {
    items: (items || []) as CurriculumItem[],
    settings: (settings || []) as SeasonalCourseCurriculum[],
  };
}

// カリキュラム設定を保存（upsert）
export async function saveCourseCurriculum(
  courseId: string,
  textbookId: number,
  curriculumItemId: number,
  data: {
    proposal_count?: number;
    group_number?: number | null;
  }
): Promise<SeasonalCourseCurriculum> {
  const { data: result, error } = await supabase
    .from('seasonal_course_curriculum')
    .upsert({
      course_id: courseId,
      textbook_id: textbookId,
      curriculum_item_id: curriculumItemId,
      ...data,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'course_id,curriculum_item_id',
    })
    .select()
    .single();

  if (error) throw error;
  return result as SeasonalCourseCurriculum;
}

// 一括でカリキュラム設定を保存
export async function saveBulkCourseCurriculum(
  courseId: string,
  textbookId: number,
  settings: Array<{
    curriculum_item_id: number;
    proposal_count: number;
    group_number: number | null;
  }>
): Promise<void> {
  const records = settings.map(s => ({
    course_id: courseId,
    textbook_id: textbookId,
    curriculum_item_id: s.curriculum_item_id,
    proposal_count: s.proposal_count,
    group_number: s.group_number,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from('seasonal_course_curriculum')
    .upsert(records, {
      onConflict: 'course_id,curriculum_item_id',
    });

  if (error) throw error;
}

// グループ化
export async function groupCourseCurriculumItems(
  courseId: string,
  textbookId: number,
  curriculumItemIds: number[]
): Promise<void> {
  if (curriculumItemIds.length < 2) {
    throw new Error('グループ化には2つ以上の単元が必要です');
  }

  // 次のグループ番号を取得
  const { data: existing } = await supabase
    .from('seasonal_course_curriculum')
    .select('group_number')
    .eq('course_id', courseId)
    .not('group_number', 'is', null)
    .order('group_number', { ascending: false })
    .limit(1);

  const nextGroupNumber = (existing?.[0]?.group_number ?? 0) + 1;

  // 各単元にグループ番号を設定（単元ごとの upsert を1回のバルク upsert に集約）
  const now = new Date().toISOString();
  const { error: upsertError } = await supabase
    .from('seasonal_course_curriculum')
    .upsert(
      curriculumItemIds.map((curriculumItemId) => ({
        course_id: courseId,
        textbook_id: textbookId,
        curriculum_item_id: curriculumItemId,
        group_number: nextGroupNumber,
        updated_at: now,
      })),
      { onConflict: 'course_id,curriculum_item_id' }
    );
  if (upsertError) throw upsertError;
}

// グループ解除
export async function ungroupCourseCurriculumItems(
  courseId: string,
  curriculumItemIds: number[]
): Promise<void> {
  const { error } = await supabase
    .from('seasonal_course_curriculum')
    .update({ group_number: null, updated_at: new Date().toISOString() })
    .eq('course_id', courseId)
    .in('curriculum_item_id', curriculumItemIds);

  if (error) throw error;
}

// =====================================================
// 生徒への適用
// =====================================================

// コースを生徒に適用（下書きの提案書のみ作成）
// 進行表(student_progress)反映・student_textbooks の講師公開は行わず、
// 編集者が提案書編集画面から個別に「公開」することで初めて反映される。
// 適用履歴(seasonal_course_applications) は「下書き適用済み」の意味で記録するため残す。
// mode は呼び出し元との互換のため残しているが、下書き作成では履歴の applied_mode 値以外は未使用。
export async function applyCoursesToStudents(
  courseId: string,
  studentIds: string[],
  mode: 'overwrite' | 'add'
): Promise<void> {
  const course = await getSeasonalCourse(courseId);
  if (!course) throw new Error('コースが見つかりません');

  if (studentIds.length === 0) return;

  // 下書き作成では student_textbooks（所持教材）を作らない。
  // 提案書を公開(publishProposal → syncProposalToProgress)したタイミングで初めて
  // student_textbook を作成/有効化する。こうすることで「実際には申し込まれていない下書き」が
  // 生徒の所持教材一覧に混入しないようにする（発注→所持教材の流れは ordering 側で維持）。

  const curriculumByTextbook = new Map<number, { curriculum_item_id: number; proposal_count: number; group_number: number | null }[]>();
  for (const ct of course.textbooks) {
    const items = course.curriculum
      .filter((c) => c.textbook_id === ct.textbook_id && c.proposal_count > 0)
      .map((c) => ({ curriculum_item_id: c.curriculum_item_id, proposal_count: c.proposal_count, group_number: c.group_number }));
    curriculumByTextbook.set(ct.textbook_id, items);
  }

  // カリキュラム設定がないテキストを記録（提案書だけ作りユニットは空にする）
  const textbooksWithoutCurriculum = new Set(
    course.textbooks
      .filter((ct) => (curriculumByTextbook.get(ct.textbook_id) || []).length === 0)
      .map((ct) => ct.textbook_id)
  );

  // Step 3: 各生徒×テキストごとに seasonal_proposals + seasonal_proposal_units を作成
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fromProposals = () => supabase.from('seasonal_proposals' as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fromProposalUnits = () => supabase.from('seasonal_proposal_units' as any);

  const year = new Date().getFullYear();
  // 下書きでは student_textbook を紐付けない（null）。公開時に作成・紐付けされる。
  type ProposalRow = { student_id: string; textbook_id: number; student_textbook_id: string | null; school_id: string | null; season: string; year: number; theme: string; status: string; applied_koma: number };
  const proposalInserts: ProposalRow[] = [];

  for (const studentId of studentIds) {
    for (const ct of course.textbooks) {
      const settings = (curriculumByTextbook.get(ct.textbook_id) || []).filter((s) => s.proposal_count > 0);
      const hasCurriculum = !textbooksWithoutCurriculum.has(ct.textbook_id);

      if (settings.length === 0 && hasCurriculum) continue;

      proposalInserts.push({
        student_id: studentId,
        textbook_id: ct.textbook_id,
        student_textbook_id: null,
        school_id: course.school_id,
        season: course.season,
        year,
        theme: course.name,
        status: 'draft',
        // 下書き段階では「申込」は未確定。提案済/公開にしたタイミングで koma_count から初期化される。
        applied_koma: 0,
      });
    }
  }

  if (proposalInserts.length > 0) {
    const { data: proposals, error: pError } = await fromProposals()
      .upsert(proposalInserts, { onConflict: 'student_id,textbook_id,season,year' })
      .select('id, student_id, textbook_id');
    if (pError) throw pError;

    const proposalMap = new Map<string, string>();
    for (const p of ((proposals || []) as unknown as { id: string; student_id: string; textbook_id: number }[])) {
      proposalMap.set(`${p.student_id}:${p.textbook_id}`, p.id);
    }

    const proposalIds = Array.from(proposalMap.values());
    if (proposalIds.length > 0) {
      await fromProposalUnits().delete().in('proposal_id', proposalIds);
    }

    const unitInserts: { proposal_id: string; curriculum_item_id: number; koma_count: number; applied_koma: number; reason: string; group_id: number; intent_tag: null; sort_order: number }[] = [];
    for (const studentId of studentIds) {
      for (const ct of course.textbooks) {
        const proposalId = proposalMap.get(`${studentId}:${ct.textbook_id}`);
        if (!proposalId) continue;
        const settings = (curriculumByTextbook.get(ct.textbook_id) || []).filter((s) => s.proposal_count > 0);
        settings.forEach((s, i) => {
          unitInserts.push({
            proposal_id: proposalId,
            curriculum_item_id: s.curriculum_item_id,
            koma_count: s.proposal_count,
            // 下書きでは申込未確定。提案済/公開時に koma_count から初期化される。
            applied_koma: 0,
            reason: '',
            group_id: s.group_number ?? 0,
            intent_tag: null,
            sort_order: i,
          });
        });
      }
    }

    if (unitInserts.length > 0) {
      const { error: uError } = await fromProposalUnits().insert(unitInserts);
      if (uError) throw uError;
    }
  }

  // 下書き登録なので、進行表(student_progress)同期・student_textbooks の公開はここでは行わない。
  // 提案書編集画面から publishProposal を呼び出した時点で反映される。

  // 適用履歴を一括INSERT（「下書きとして適用済み」の意味で記録）
  await supabase.from('seasonal_course_applications').insert(
    studentIds.map((studentId) => ({
      course_id: courseId,
      student_id: studentId,
      applied_mode: mode,
    }))
  );
}

// コースの適用履歴を取得
export async function getCourseApplications(courseId: string): Promise<SeasonalCourseApplication[]> {
  const { data, error } = await supabase
    .from('seasonal_course_applications')
    .select('*, student:students(*)')
    .eq('course_id', courseId)
    .order('applied_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

// =====================================================
// 表示用データ変換
// =====================================================

// カリキュラムを表示用に変換（グループ化対応）
export function convertToCourseCurriculumRows(
  items: CurriculumItem[],
  settings: SeasonalCourseCurriculum[]
): CourseCurriculumRow[] {
  const settingsMap = new Map<number, SeasonalCourseCurriculum>();
  for (const s of settings) {
    settingsMap.set(s.curriculum_item_id, s);
  }

  // グループごとの単元リスト
  const groupItems = new Map<number, number[]>();
  for (const item of items) {
    const setting = settingsMap.get(item.id);
    if (setting?.group_number != null) {
      const existing = groupItems.get(setting.group_number) || [];
      existing.push(item.id);
      groupItems.set(setting.group_number, existing);
    }
  }

  const displayRows: CourseCurriculumRow[] = [];
  const processedGroups = new Set<number>();

  for (const item of items) {
    const setting = settingsMap.get(item.id) || null;
    const groupNumber = setting?.group_number;

    if (groupNumber != null) {
      const groupItemIds = groupItems.get(groupNumber) || [];
      const isFirstInGroup = !processedGroups.has(groupNumber);

      if (isFirstInGroup) {
        processedGroups.add(groupNumber);

        // グループ全体の提案回数を計算
        let totalProposal = 0;
        for (const itemId of groupItemIds) {
          const s = settingsMap.get(itemId);
          totalProposal += s?.proposal_count || 0;
        }

        displayRows.push({
          curriculumItem: item,
          setting,
          isGroupStart: true,
          groupRowSpan: groupItemIds.length,
          groupProposalCount: totalProposal,
        });
      } else {
        displayRows.push({
          curriculumItem: item,
          setting,
          isGroupStart: false,
          groupRowSpan: 0,
          groupProposalCount: 0,
        });
      }
    } else {
      displayRows.push({
        curriculumItem: item,
        setting,
        isGroupStart: true,
        groupRowSpan: 1,
        groupProposalCount: setting?.proposal_count || 0,
      });
    }
  }

  return displayRows;
}
