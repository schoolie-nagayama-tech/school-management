import { createPeriodApi, updateChargedStatusWithBilling } from './form-period-api';
import {
  createPublicFormResponse,
  getFormResponses,
  getFormResponse,
  updateFormResponseStatus,
} from './form-responses';
import type { FormResponseInsert } from '@/types/database';
import type {
  MoshiPeriod,
  MoshiResponse,
  MoshiResponseData,
  MoshiResponseFilters,
  MoshiStats,
} from '@/types/forms/moshi';

// ============================================
// 模試期間管理（共通の期間CRUDは createPeriodApi に集約）
// ============================================

const periodApi = createPeriodApi<'moshi', MoshiPeriod>('moshi');

export const getMoshiPeriods = periodApi.getPeriods;
export const getActiveMoshiPeriod = periodApi.getActivePeriod;
export const getMoshiPeriod = periodApi.getPeriod;
export const getMoshiPeriodByKey = periodApi.getPeriodByKey;
export const createMoshiPeriod = periodApi.createPeriod;
export const updateMoshiPeriod = periodApi.updatePeriod;
export const deleteMoshiPeriod = periodApi.deletePeriod;
export const archiveMoshiPeriod = periodApi.archive;
export const unarchiveMoshiPeriod = periodApi.unarchive;

// ============================================
// 模試回答送信
// ============================================

/**
 * 模試回答を送信
 */
export async function submitMoshiResponse(data: {
  school_id: string;
  period_key: string;
  student_name: string;
  grade: number;
  email: string;
  response_data: MoshiResponseData;
}): Promise<void> {
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
      order: false,
    },
  };

  await createPublicFormResponse(responseData);
}

// ============================================
// 模試回答一覧
// ============================================

/**
 * 模試回答一覧を取得
 */
export async function getMoshiResponses(
  schoolId: string | string[],
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
  schoolId: string | string[],
  periodKey: string
): Promise<MoshiStats> {
  const responses = await getMoshiResponses(schoolId, periodKey);

  const regularCount = responses.filter((r) => r.response_data.exam_type === 'regular').length;
  const furikaeCount = responses.filter((r) => r.response_data.exam_type === 'furikae').length;
  const chargedCount = responses.filter((r) => r.status_checks?.charged === true).length;
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
 * 模試回答の計上状態を更新（既存の status_checks をマージし請求へ同期）
 */
export const updateMoshiChargedStatus = updateChargedStatusWithBilling;

/**
 * 模試回答の発注状態を更新（既存の status_checks をマージ）
 */
export async function updateMoshiOrderStatus(responseId: string, order: boolean): Promise<void> {
  const response = await getFormResponse(responseId);
  const current = (response?.status_checks || {}) as Record<string, boolean>;
  await updateFormResponseStatus(responseId, { ...current, order });
}

/**
 * 模試期間の回答数を取得
 */
export async function getMoshiResponseCount(schoolId: string, periodKey: string): Promise<number> {
  const responses = await getMoshiResponses(schoolId, periodKey);
  return responses.length;
}
