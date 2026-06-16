import { callCoursePrepApi, fetchCoursePrepApi } from './coursePrepApi';
import type {
  CourseProgressItem,
  StudentCourseProgress,
  CoursePrepPeriod,
  ApplicationStatus,
  ApplicationColumnType,
  SeasonType,
} from '@/types/database';

// =============================================
// 講習期間メタ
// =============================================

export async function getCoursePrepPeriod(
  schoolId: string,
  season: SeasonType,
  year: number
): Promise<CoursePrepPeriod | null> {
  const result = await fetchCoursePrepApi('get_period', {
    schoolId,
    season,
    year: String(year),
  });
  return (result.data as CoursePrepPeriod) || null;
}

export async function upsertCoursePrepPeriod(
  schoolId: string,
  season: SeasonType,
  year: number,
  updates: Partial<Pick<CoursePrepPeriod, 'budget_koma' | 'target_koma' | 'expected_rate' | 'schedule_start_date' | 'schedule_end_date'>>
): Promise<void> {
  await callCoursePrepApi('upsert_period', schoolId, {
    season,
    year,
    budgetKoma: updates.budget_koma,
    targetKoma: updates.target_koma,
    expectedRate: updates.expected_rate,
    scheduleStartDate: updates.schedule_start_date,
    scheduleEndDate: updates.schedule_end_date,
  });
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
  const result = await fetchCoursePrepApi('get_progress_items', {
    schoolId,
    season,
    year: String(year),
    includeHidden: String(includeHidden),
  });

  return ((result.data as Record<string, unknown>[]) || []).map((item) => ({
    ...item,
    column_type: (item.column_type as string) || 'check',
    manager_only: item.manager_only === true,
    is_hidden: item.is_hidden === true,
    deadline: (item.deadline as string) || null,
    auto_source: (item.auto_source as string) || null,
  })) as CourseProgressItem[];
}

export async function createCourseProgressItem(
  item: {
    name: string;
    column_type?: ApplicationColumnType;
    manager_only?: boolean;
    column_group?: string | null;
    auto_source?: string | null;
  },
  schoolId: string,
  season: SeasonType,
  year: number
): Promise<CourseProgressItem> {
  const items = await getCourseProgressItems(schoolId, season, year, true);
  const maxSortOrder = items.length > 0
    ? Math.max(...items.map(i => i.sort_order))
    : -1;

  const result = await callCoursePrepApi('create_progress_item', schoolId, {
    season,
    year,
    name: item.name,
    columnType: item.column_type || 'check',
    columnGroup: item.column_group || null,
    autoSource: item.auto_source || null,
    sortOrder: maxSortOrder + 1,
  });

  return result.data as CourseProgressItem;
}

export async function updateCourseProgressItem(
  id: string,
  schoolId: string,
  updates: Partial<Pick<CourseProgressItem, 'name' | 'column_type' | 'deadline' | 'auto_source' | 'sort_order' | 'column_group'>>
): Promise<CourseProgressItem> {
  const result = await callCoursePrepApi('update_progress_item', schoolId, {
    itemId: id,
    updates,
  });
  return result.data as CourseProgressItem;
}

export async function hideCourseProgressItem(id: string, schoolId: string): Promise<void> {
  await callCoursePrepApi('hide_progress_item', schoolId, { itemId: id, isHidden: true });
}

export async function unhideCourseProgressItem(id: string, schoolId: string): Promise<void> {
  await callCoursePrepApi('hide_progress_item', schoolId, { itemId: id, isHidden: false });
}

export async function deleteCourseProgressItem(id: string, schoolId: string): Promise<void> {
  await callCoursePrepApi('delete_progress_item', schoolId, { itemId: id });
}

// =============================================
// 生徒進捗データ
// =============================================

export async function getStudentCourseProgress(
  schoolId: string,
  season: SeasonType,
  year: number
): Promise<StudentCourseProgress[]> {
  const result = await fetchCoursePrepApi('get_student_progress', {
    schoolId,
    season,
    year: String(year),
  });

  return ((result.data as Record<string, unknown>[]) || []).map((d) => ({
    ...d,
    number_value: d.number_value ?? null,
    date_value: d.date_value ?? null,
  })) as StudentCourseProgress[];
}

export async function updateStudentProgress(
  studentId: string,
  itemId: string,
  status: ApplicationStatus | null,
  schoolId?: string
): Promise<void> {
  if (!schoolId) throw new Error('school_idが必要です');
  await callCoursePrepApi('update_student_progress', schoolId, {
    studentId,
    itemId,
    status,
  });
}

export async function updateStudentProgressNumber(
  studentId: string,
  itemId: string,
  numberValue: number | null,
  schoolId?: string
): Promise<void> {
  if (!schoolId) throw new Error('school_idが必要です');
  await callCoursePrepApi('update_student_number', schoolId, {
    studentId,
    itemId,
    numberValue,
  });
}

export async function updateStudentProgressDate(
  studentId: string,
  itemId: string,
  dateValue: string | null,
  schoolId?: string
): Promise<void> {
  if (!schoolId) throw new Error('school_idが必要です');
  await callCoursePrepApi('update_student_date', schoolId, {
    studentId,
    itemId,
    dateValue,
  });
}

// =============================================
// 自動計算値（通常週回数・講習回数）
// =============================================

export type AutoValues = Record<string, { regular_weekly: number; course_sessions: number; proposal_total?: number; subject_proposals?: Record<string, number>; applied_total?: number; subject_applied?: Record<string, number> }>;
// 単独取得関数 getAutoValues は廃止。batchFetchCoursePrepApi で 'auto_values' ターゲットを使うこと。
