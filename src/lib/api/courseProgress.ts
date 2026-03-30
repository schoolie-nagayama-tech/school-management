import { supabase } from '../supabase';
import type {
  CourseProgressItem,
  StudentCourseProgress,
  CoursePrepPeriod,
  ApplicationStatus,
  ApplicationColumnType,
  SeasonType,
} from '@/types/database';

// 新規テーブルは生成型に未反映のため any キャスト
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

// =============================================
// 講習期間メタ
// =============================================

export async function getCoursePrepPeriod(
  schoolId: string,
  season: SeasonType,
  year: number
): Promise<CoursePrepPeriod | null> {
  const { data, error } = await db
    .from('course_prep_periods')
    .select('*')
    .eq('school_id', schoolId)
    .eq('season', season)
    .eq('year', year)
    .maybeSingle();

  if (error) {
    throw new Error(`講習期間の取得に失敗しました: ${error.message}`);
  }
  return data as CoursePrepPeriod | null;
}

export async function upsertCoursePrepPeriod(
  schoolId: string,
  season: SeasonType,
  year: number,
  updates: Partial<Pick<CoursePrepPeriod, 'budget_koma' | 'schedule_start_date' | 'schedule_end_date'>>
): Promise<CoursePrepPeriod> {
  const { data, error } = await db
    .from('course_prep_periods')
    .upsert(
      {
        school_id: schoolId,
        season,
        year,
        ...updates,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'school_id,season,year' }
    )
    .select()
    .single();

  if (error) {
    throw new Error(`講習期間の更新に失敗しました: ${error.message}`);
  }
  return data as CoursePrepPeriod;
}

// =============================================
// 進捗管理項目
// =============================================

export async function getCourseProgressItems(
  schoolId: string,
  season: SeasonType,
  year: number,
  includeHidden: boolean = false
): Promise<CourseProgressItem[]> {
  let query = supabase
    .from('course_prep_progress_items')
    .select('*')
    .eq('school_id', schoolId)
    .eq('season', season)
    .eq('year', year)
    .order('sort_order', { ascending: true });

  if (!includeHidden) {
    query = query.or('is_hidden.eq.false,is_hidden.is.null');
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`進捗項目の取得に失敗しました: ${error.message}`);
  }

  return (data || []).map((item: Record<string, unknown>) => ({
    ...item,
    column_type: (item.column_type as string) || 'check',
    manager_only: item.manager_only === true,
    is_hidden: item.is_hidden === true,
  })) as CourseProgressItem[];
}

export async function createCourseProgressItem(
  item: {
    name: string;
    column_type?: ApplicationColumnType;
    manager_only?: boolean;
    column_group?: string | null;
  },
  schoolId: string,
  season: SeasonType,
  year: number
): Promise<CourseProgressItem> {
  const { data: existingItems } = await db
    .from('course_prep_progress_items')
    .select('sort_order')
    .eq('school_id', schoolId)
    .eq('season', season)
    .eq('year', year)
    .order('sort_order', { ascending: false })
    .limit(1);

  const maxSortOrder = existingItems && existingItems.length > 0
    ? existingItems[0].sort_order
    : -1;

  const { data, error } = await db
    .from('course_prep_progress_items')
    .insert({
      name: item.name,
      column_type: item.column_type || 'check',
      manager_only: item.manager_only || false,
      column_group: item.column_group || null,
      school_id: schoolId,
      season,
      year,
      sort_order: maxSortOrder + 1,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`進捗項目の作成に失敗しました: ${error.message}`);
  }

  return data as CourseProgressItem;
}

export async function updateCourseProgressItem(
  id: string,
  updates: Partial<Pick<CourseProgressItem, 'name' | 'column_type' | 'manager_only' | 'column_group' | 'is_hidden' | 'sort_order'>>
): Promise<CourseProgressItem> {
  const { data, error } = await db
    .from('course_prep_progress_items')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw new Error(`進捗項目の更新に失敗しました: ${error.message}`);
  }

  return data as CourseProgressItem;
}

export async function hideCourseProgressItem(id: string): Promise<void> {
  const { error } = await db
    .from('course_prep_progress_items')
    .update({
      is_hidden: true,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) {
    throw new Error(`進捗項目の非表示に失敗しました: ${error.message}`);
  }
}

export async function unhideCourseProgressItem(id: string): Promise<void> {
  const { error } = await db
    .from('course_prep_progress_items')
    .update({
      is_hidden: false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) {
    throw new Error(`進捗項目の再表示に失敗しました: ${error.message}`);
  }
}

export async function deleteCourseProgressItem(id: string): Promise<void> {
  const { error } = await db
    .from('course_prep_progress_items')
    .delete()
    .eq('id', id);

  if (error) {
    throw new Error(`進捗項目の削除に失敗しました: ${error.message}`);
  }
}

export async function updateCourseProgressItemSortOrder(
  items: { id: string; sort_order: number }[]
): Promise<void> {
  const updates = items.map((item) =>
    db
      .from('course_prep_progress_items')
      .update({ sort_order: item.sort_order })
      .eq('id', item.id)
  );

  const results = await Promise.all(updates);
  const errors = results.filter((r) => r.error);

  if (errors.length > 0) {
    throw new Error(`並び順の更新に失敗しました: ${errors[0].error?.message}`);
  }
}

// =============================================
// 生徒進捗データ
// =============================================

export async function getStudentCourseProgress(
  schoolId: string,
  season: SeasonType,
  year: number
): Promise<StudentCourseProgress[]> {
  // まず該当期間の項目IDを取得
  const { data: items } = await db
    .from('course_prep_progress_items')
    .select('id')
    .eq('school_id', schoolId)
    .eq('season', season)
    .eq('year', year);

  if (!items || items.length === 0) return [];

  const itemIds = items.map((i: { id: string }) => i.id);

  const { data, error } = await db
    .from('course_prep_student_progress')
    .select('*')
    .eq('school_id', schoolId)
    .in('item_id', itemIds);

  if (error) {
    if (error.code === 'PGRST116' || error.code === '42501') {
      return [];
    }
    throw new Error(`進捗データの取得に失敗しました: ${error.message}`);
  }

  return (data || []).map((d: Record<string, unknown>) => ({
    ...d,
    number_value: d.number_value ?? null,
    date_value: d.date_value ?? null,
  })) as StudentCourseProgress[];
}

export async function updateStudentProgress(
  studentId: string,
  itemId: string,
  status: ApplicationStatus | null
): Promise<StudentCourseProgress | null> {
  const { data: student, error: studentError } = await db
    .from('students')
    .select('school_id')
    .eq('id', studentId)
    .single();

  if (studentError || !student) {
    throw new Error(`生徒情報の取得に失敗しました: ${studentError?.message || '生徒が見つかりません'}`);
  }

  const schoolId = student.school_id;

  if (status === null) {
    const { error } = await db
      .from('course_prep_student_progress')
      .delete()
      .eq('student_id', studentId)
      .eq('item_id', itemId)
      .eq('school_id', schoolId);

    if (error) {
      throw new Error(`進捗データの削除に失敗しました: ${error.message}`);
    }
    return null;
  }

  const { data: existing } = await db
    .from('course_prep_student_progress')
    .select('id')
    .eq('student_id', studentId)
    .eq('item_id', itemId)
    .eq('school_id', schoolId)
    .maybeSingle();

  if (existing) {
    const { data, error } = await db
      .from('course_prep_student_progress')
      .update({ status })
      .eq('id', existing.id)
      .select()
      .single();

    if (error) throw new Error(`進捗データの更新に失敗しました: ${error.message}`);
    return { ...(data as any), number_value: (data as any).number_value ?? null, date_value: (data as any).date_value ?? null } as StudentCourseProgress;
  } else {
    const { data, error } = await db
      .from('course_prep_student_progress')
      .insert({ school_id: schoolId, student_id: studentId, item_id: itemId, status })
      .select()
      .single();

    if (error) throw new Error(`進捗データの作成に失敗しました: ${error.message}`);
    return { ...(data as any), number_value: (data as any).number_value ?? null, date_value: (data as any).date_value ?? null } as StudentCourseProgress;
  }
}

export async function updateStudentProgressNumber(
  studentId: string,
  itemId: string,
  numberValue: number | null
): Promise<StudentCourseProgress | null> {
  const { data: student, error: studentError } = await db
    .from('students')
    .select('school_id')
    .eq('id', studentId)
    .single();

  if (studentError || !student) {
    throw new Error(`生徒情報の取得に失敗しました: ${studentError?.message || '生徒が見つかりません'}`);
  }

  const schoolId = student.school_id;

  if (numberValue === null) {
    const { error } = await db
      .from('course_prep_student_progress')
      .delete()
      .eq('student_id', studentId)
      .eq('item_id', itemId)
      .eq('school_id', schoolId);

    if (error) throw new Error(`進捗データの削除に失敗しました: ${error.message}`);
    return null;
  }

  const { data: existing } = await db
    .from('course_prep_student_progress')
    .select('id')
    .eq('student_id', studentId)
    .eq('item_id', itemId)
    .eq('school_id', schoolId)
    .maybeSingle();

  if (existing) {
    const { data, error } = await db
      .from('course_prep_student_progress')
      .update({ number_value: numberValue } as any)
      .eq('id', existing.id)
      .select()
      .single();

    if (error) throw new Error(`進捗データの更新に失敗しました: ${error.message}`);
    return { ...(data as any), number_value: (data as any).number_value ?? null, date_value: (data as any).date_value ?? null } as StudentCourseProgress;
  } else {
    const { data, error } = await db
      .from('course_prep_student_progress')
      .insert({ school_id: schoolId, student_id: studentId, item_id: itemId, status: null as any, number_value: numberValue } as any)
      .select()
      .single();

    if (error) throw new Error(`進捗データの作成に失敗しました: ${error.message}`);
    return { ...(data as any), number_value: (data as any).number_value ?? null, date_value: (data as any).date_value ?? null } as StudentCourseProgress;
  }
}

export async function updateStudentProgressDate(
  studentId: string,
  itemId: string,
  dateValue: string | null
): Promise<StudentCourseProgress | null> {
  const { data: student, error: studentError } = await db
    .from('students')
    .select('school_id')
    .eq('id', studentId)
    .single();

  if (studentError || !student) {
    throw new Error(`生徒情報の取得に失敗しました: ${studentError?.message || '生徒が見つかりません'}`);
  }

  const schoolId = student.school_id;

  if (dateValue === null) {
    const { error } = await db
      .from('course_prep_student_progress')
      .delete()
      .eq('student_id', studentId)
      .eq('item_id', itemId)
      .eq('school_id', schoolId);

    if (error) throw new Error(`進捗データの削除に失敗しました: ${error.message}`);
    return null;
  }

  const { data: existing } = await db
    .from('course_prep_student_progress')
    .select('id')
    .eq('student_id', studentId)
    .eq('item_id', itemId)
    .eq('school_id', schoolId)
    .maybeSingle();

  if (existing) {
    const { data, error } = await db
      .from('course_prep_student_progress')
      .update({ date_value: dateValue } as any)
      .eq('id', existing.id)
      .select()
      .single();

    if (error) throw new Error(`進捗データの更新に失敗しました: ${error.message}`);
    return { ...(data as any), number_value: (data as any).number_value ?? null, date_value: (data as any).date_value ?? null } as StudentCourseProgress;
  } else {
    const { data, error } = await db
      .from('course_prep_student_progress')
      .insert({ school_id: schoolId, student_id: studentId, item_id: itemId, status: null as any, date_value: dateValue } as any)
      .select()
      .single();

    if (error) throw new Error(`進捗データの作成に失敗しました: ${error.message}`);
    return { ...(data as any), number_value: (data as any).number_value ?? null, date_value: (data as any).date_value ?? null } as StudentCourseProgress;
  }
}
