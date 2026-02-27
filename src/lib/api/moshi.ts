import {
  getFormPeriods,
  getActiveFormPeriod,
  getFormPeriod,
  getFormPeriodByKey,
  createFormPeriod,
  updateFormPeriod,
  deleteFormPeriod,
  archivePeriod,
  unarchivePeriod,
} from './form-periods';
import { createFormResponse, getFormResponses, updateFormResponseStatus } from './form-responses';
import { getDefaultSchoolId, getSchoolByCode } from './schools';
import type {
  FormPeriodInsert,
  FormPeriodUpdate,
  FormResponseInsert,
} from '@/types/database';
import type {
  MoshiPeriod,
  MoshiSettings,
  MoshiResponse,
  MoshiResponseData,
  MoshiResponseFilters,
  MoshiStats,
} from '@/types/forms/moshi';

// ============================================
// 模試期間管理
// ============================================

/**
 * 模試期間一覧を取得
 */
export async function getMoshiPeriods(
  schoolId?: string,
  includeArchived: boolean = false
): Promise<MoshiPeriod[]> {
  const targetSchoolId = schoolId || getDefaultSchoolId();
  const periods = await getFormPeriods(targetSchoolId, 'moshi', includeArchived);
  return periods.map((p) => ({
    ...p,
    form_type: 'moshi' as const,
    settings: (p.settings || {}) as unknown as MoshiSettings,
  }));
}

/**
 * 公開中の模試期間を取得（ポータル用）
 */
export async function getActiveMoshiPeriod(
  schoolCode: string
): Promise<MoshiPeriod | null> {
  const school = await getSchoolByCode(schoolCode);
  if (!school) {
    return null;
  }

  const period = await getActiveFormPeriod(school.id, 'moshi');
  if (!period) {
    return null;
  }

  return {
    ...period,
    form_type: 'moshi' as const,
    settings: (period.settings || {}) as unknown as MoshiSettings,
  };
}

/**
 * 模試期間を1件取得
 */
export async function getMoshiPeriod(id: string): Promise<MoshiPeriod | null> {
  const period = await getFormPeriod(id);
  if (!period || period.form_type !== 'moshi') {
    return null;
  }

  return {
    ...period,
    form_type: 'moshi' as const,
    settings: (period.settings || {}) as unknown as MoshiSettings,
  };
}

/**
 * 模試期間を period_key で取得（プレビュー用）
 */
export async function getMoshiPeriodByKey(
  schoolId: string,
  periodKey: string
): Promise<MoshiPeriod | null> {
  const period = await getFormPeriodByKey(schoolId, 'moshi', periodKey);
  if (!period) return null;
  return {
    ...period,
    form_type: 'moshi' as const,
    settings: (period.settings || {}) as unknown as MoshiSettings,
  };
}

/**
 * 模試期間を作成
 * @param data 期間データ（school_id / form_type 除く）
 * @param schoolId 教室ID（省略時は getDefaultSchoolId()）
 */
export async function createMoshiPeriod(
  data: Omit<FormPeriodInsert, 'school_id' | 'form_type'>,
  schoolId?: string
): Promise<MoshiPeriod> {
  const targetSchoolId = schoolId ?? getDefaultSchoolId();

  const periodData: FormPeriodInsert = {
    ...data,
    school_id: targetSchoolId,
    form_type: 'moshi',
    settings: (data.settings || {}) as unknown as Record<string, unknown>,
  };

  const period = await createFormPeriod(periodData);
  return {
    ...period,
    form_type: 'moshi' as const,
    settings: (period.settings || {}) as unknown as MoshiSettings,
  };
}

/**
 * 模試期間を更新
 */
export async function updateMoshiPeriod(
  id: string,
  data: FormPeriodUpdate
): Promise<MoshiPeriod> {
  const updateData: FormPeriodUpdate = {
    ...data,
    settings: data.settings ? (data.settings as unknown as Record<string, unknown>) : undefined,
  };

  const period = await updateFormPeriod(id, updateData);
  return {
    ...period,
    form_type: 'moshi' as const,
    settings: (period.settings || {}) as unknown as MoshiSettings,
  };
}

/**
 * 模試期間を削除
 */
export async function deleteMoshiPeriod(id: string): Promise<void> {
  await deleteFormPeriod(id);
}

/**
 * 模試期間をアーカイブ
 */
export async function archiveMoshiPeriod(
  id: string,
  schoolId: string,
  periodKey: string
): Promise<{ periodArchived: boolean; responsesArchived: number }> {
  return archivePeriod(id, schoolId, 'moshi', periodKey);
}

/**
 * 模試期間のアーカイブを解除
 */
export async function unarchiveMoshiPeriod(
  id: string,
  schoolId: string,
  periodKey: string
): Promise<{ periodUnarchived: boolean; responsesUnarchived: number }> {
  return unarchivePeriod(id, schoolId, 'moshi', periodKey);
}

// ============================================
// 模試回答送信
// ============================================

/**
 * 模試回答を送信
 */
export async function submitMoshiResponse(
  data: {
    school_id: string;
    period_key: string;
    student_name: string;
    grade: number;
    email: string;
    response_data: MoshiResponseData;
  }
): Promise<void> {
  const responseData: FormResponseInsert = {
    school_id: data.school_id,
    form_type: 'moshi',
    form_period: data.period_key,
    student_name: data.student_name,
    grade: data.grade,
    email: data.email,
    response_data: data.response_data as never,
    status_checks: {
      charged: false,
    },
  };

  await createFormResponse(responseData);
}

// ============================================
// 模試回答一覧
// ============================================

/**
 * 模試回答一覧を取得
 */
export async function getMoshiResponses(
  schoolId: string,
  periodKey: string,
  filters?: MoshiResponseFilters
): Promise<MoshiResponse[]> {
  const responses = await getFormResponses(schoolId, {
    formType: 'moshi',
    formPeriod: periodKey,
    grade: filters?.grade,
    linkedStatus: filters?.linkedStatus,
    showArchived: filters?.showArchived,
    chargedStatus: filters?.chargedStatus,
    search: filters?.search,
  });

  // フィルター適用
  let filtered = responses.map((r) => ({
    ...r,
    form_type: 'moshi' as const,
    response_data: r.response_data as unknown as MoshiResponseData,
  }));

  // 受験方法フィルター
  if (filters?.examType && filters.examType !== 'all') {
    filtered = filtered.filter((r) => r.response_data.exam_type === filters.examType);
  }

  return filtered;
}

/**
 * 模試集計データを取得
 */
export async function getMoshiStats(
  schoolId: string,
  periodKey: string
): Promise<MoshiStats> {
  const responses = await getMoshiResponses(schoolId, periodKey);

  const regularCount = responses.filter(
    (r) => r.response_data.exam_type === 'regular'
  ).length;
  const furikaeCount = responses.filter(
    (r) => r.response_data.exam_type === 'furikae'
  ).length;
  const chargedCount = responses.filter(
    (r) => r.status_checks?.charged === true
  ).length;
  const linkedCount = responses.filter((r) => r.linked_student_id !== null).length;

  return {
    total_responses: responses.length,
    regular_count: regularCount,
    furikae_count: furikaeCount,
    charged_count: chargedCount,
    linked_count: linkedCount,
  };
}

/**
 * 模試回答の計上状態を更新
 */
export async function updateMoshiChargedStatus(
  responseId: string,
  charged: boolean
): Promise<void> {
  await updateFormResponseStatus(responseId, { charged });
}

/**
 * 模試期間の回答数を取得
 */
export async function getMoshiResponseCount(
  schoolId: string,
  periodKey: string
): Promise<number> {
  const responses = await getMoshiResponses(schoolId, periodKey);
  return responses.length;
}
