import { supabase } from '@/lib/supabase';
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
  course_id: string;
  student_id: string;
  koma_count: number;
  subject_ids: string[];
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

  // 登録人数を集計
  const withCounts = await Promise.all(
    courses.map(async (c) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { count } = await (supabase as any)
        .from('koushu_enrollments')
        .select('*', { count: 'exact', head: true })
        .eq('course_id', c.id);
      return { ...c, enrollment_count: count ?? 0 };
    })
  );

  return withCounts;
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

/** 申し込みを登録・更新（upsert） */
export async function upsertKoushuEnrollment(
  courseId: string,
  studentId: string,
  komaCount: number,
  subjectIds: string[]
): Promise<void> {
  // koushu_enrollments は生成型に含まれないため as never でキャスト
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('koushu_enrollments')
    .upsert(
      {
        course_id: courseId,
        student_id: studentId,
        koma_count: komaCount,
        subject_ids: subjectIds,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'course_id,student_id' }
    );

  if (error) throw error;
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

/** 講習期間のスケジュール済みコマ数を学生ごとに集計 */
export async function getKoushuScheduledCounts(
  schoolId: string,
  startDate: string,
  endDate: string,
  studentIds: string[]
): Promise<Map<string, number>> {
  if (studentIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from('schedule_entries')
    .select('student_id, status')
    .eq('school_id', schoolId)
    .gte('entry_date', startDate)
    .lte('entry_date', endDate)
    .in('student_id', studentIds);

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

  // 適用数を取得
  const coursesTyped = (data || []) as SeasonalCourseWithDetails[];
  const coursesWithCount = await Promise.all(
    coursesTyped.map(async (course) => {
      const { count } = await supabase
        .from('seasonal_course_applications')
        .select('*', { count: 'exact', head: true })
        .eq('course_id', course.id);
      
      return {
        ...course,
        application_count: count || 0,
      };
    })
  );

  return coursesWithCount;
}

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

  // 各単元にグループ番号を設定
  for (const curriculumItemId of curriculumItemIds) {
    await supabase
      .from('seasonal_course_curriculum')
      .upsert({
        course_id: courseId,
        textbook_id: textbookId,
        curriculum_item_id: curriculumItemId,
        group_number: nextGroupNumber,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'course_id,curriculum_item_id',
      });
  }
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

// コースを生徒に適用
export async function applyCoursesToStudents(
  courseId: string,
  studentIds: string[],
  mode: 'overwrite' | 'add'
): Promise<void> {
  // コース情報を取得
  const course = await getSeasonalCourse(courseId);
  if (!course) throw new Error('コースが見つかりません');

  if (studentIds.length === 0) return;

  const textbookIds = course.textbooks.map((ct) => ct.textbook_id);
  const now = new Date().toISOString();
  // Map key: "student_id:textbook_id"
  const stMap = new Map<string, string>();

  // Step 1: 既存 student_textbooks を一括取得
  const { data: existingStList } = await supabase
    .from('student_textbooks')
    .select('id, student_id, textbook_id')
    .in('student_id', studentIds)
    .in('textbook_id', textbookIds);

  for (const st of (existingStList || []) as { id: string; student_id: string; textbook_id: number }[]) {
    stMap.set(`${st.student_id}:${st.textbook_id}`, st.id);
  }

  // Step 2: 不足分の student_textbooks を一括INSERT
  const missingRows = [];
  for (const studentId of studentIds) {
    for (const ct of course.textbooks) {
      if (!stMap.has(`${studentId}:${ct.textbook_id}`)) {
        missingRows.push({
          school_id: course.school_id,
          student_id: studentId,
          textbook_id: ct.textbook_id,
          is_active: true,
          season: course.season,
        });
      }
    }
  }
  if (missingRows.length > 0) {
    const { data: newSts, error: stError } = await supabase
      .from('student_textbooks')
      .insert(missingRows as never)
      .select('id, student_id, textbook_id');
    if (stError) throw stError;
    for (const st of (newSts || []) as { id: string; student_id: string; textbook_id: number }[]) {
      stMap.set(`${st.student_id}:${st.textbook_id}`, st.id);
    }
  }

  // テキストIDごとのカリキュラムマップ
  const curriculumByTextbook = new Map<number, typeof course.curriculum>();
  for (const ct of course.textbooks) {
    curriculumByTextbook.set(ct.textbook_id, course.curriculum.filter((c) => c.textbook_id === ct.textbook_id));
  }

  const allStIds = Array.from(new Set(Array.from(stMap.values())));

  if (mode === 'overwrite') {
    // 上書きモード: 全 student_progress を一括 upsert
    const progressRows = [];
    for (const studentId of studentIds) {
      for (const ct of course.textbooks) {
        const stId = stMap.get(`${studentId}:${ct.textbook_id}`);
        if (!stId) continue;
        for (const setting of curriculumByTextbook.get(ct.textbook_id) || []) {
          progressRows.push({
            student_textbook_id: stId,
            curriculum_item_id: setting.curriculum_item_id,
            proposal_count: setting.proposal_count,
            group_number: setting.group_number,
            updated_at: now,
          });
        }
      }
    }
    if (progressRows.length > 0) {
      const { error } = await supabase
        .from('student_progress')
        .upsert(progressRows as never, { onConflict: 'student_textbook_id,curriculum_item_id' });
      if (error) throw error;
    }
  } else {
    // 加算モード: 既存 student_progress を一括取得してから差分計算
    const { data: existingProgress } = await supabase
      .from('student_progress')
      .select('id, student_textbook_id, curriculum_item_id, proposal_count, group_number')
      .in('student_textbook_id', allStIds);

    type ExistingProgress = { id: string; student_textbook_id: string; curriculum_item_id: number; proposal_count: number | null; group_number: number | null };
    const progressMap = new Map<string, ExistingProgress>(
      ((existingProgress || []) as ExistingProgress[]).map((p) => [
        `${p.student_textbook_id}:${p.curriculum_item_id}`,
        p,
      ])
    );

    const toInsert = [];
    const toUpdate: { id: string; proposal_count: number; group_number: number | null }[] = [];

    for (const studentId of studentIds) {
      for (const ct of course.textbooks) {
        const stId = stMap.get(`${studentId}:${ct.textbook_id}`);
        if (!stId) continue;
        for (const setting of curriculumByTextbook.get(ct.textbook_id) || []) {
          const key = `${stId}:${setting.curriculum_item_id}`;
          const existing = progressMap.get(key);
          if (existing) {
            toUpdate.push({
              id: existing.id,
              proposal_count: (existing.proposal_count || 0) + setting.proposal_count,
              group_number: setting.group_number,
            });
          } else {
            toInsert.push({
              student_textbook_id: stId,
              curriculum_item_id: setting.curriculum_item_id,
              proposal_count: setting.proposal_count,
              group_number: setting.group_number,
            });
          }
        }
      }
    }

    await Promise.all([
      toInsert.length > 0
        ? supabase.from('student_progress').insert(toInsert as never)
        : Promise.resolve(),
      ...toUpdate.map((u) =>
        supabase
          .from('student_progress')
          .update({ proposal_count: u.proposal_count, group_number: u.group_number, updated_at: now } as never)
          .eq('id', u.id)
      ),
    ]);
  }

  // Step 4: 適用履歴を一括INSERT
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
