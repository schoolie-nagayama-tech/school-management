import { createPeriodApi, updateStatusChecksWithBilling } from './form-period-api';
import { createPublicFormResponse, getFormResponses } from './form-responses';
import type { FormResponseInsert } from '@/types/database';
import type {
  ShukaisuPeriod,
  ShukaisuResponse,
  ShukaisuResponseData,
  ShukaisuResponseFilters,
  ShukaisuStats,
} from '@/types/forms/shukaisu';

// ============================================
// 週回数変更期間管理（共通の期間CRUDは createPeriodApi に集約）
// ============================================

const periodApi = createPeriodApi<'shukaisu', ShukaisuPeriod>('shukaisu');

export const getShukaisuPeriods = periodApi.getPeriods;
export const getActiveShukaisuPeriod = periodApi.getActivePeriod;
export const getShukaisuPeriod = periodApi.getPeriod;
export const getShukaisuPeriodByKey = periodApi.getPeriodByKey;
export const createShukaisuPeriod = periodApi.createPeriod;
export const updateShukaisuPeriod = periodApi.updatePeriod;
export const deleteShukaisuPeriod = periodApi.deletePeriod;
export const archiveShukaisuPeriod = periodApi.archive;
export const unarchiveShukaisuPeriod = periodApi.unarchive;

// ============================================
// 週回数変更回答送信
// ============================================

/**
 * 週回数変更回答を送信
 */
export async function submitShukaisuResponse(data: {
  school_id: string;
  period_key: string;
  student_name: string;
  grade: number;
  email: string;
  response_data: ShukaisuResponseData;
}): Promise<void> {
  const responseData: FormResponseInsert = {
    school_id: data.school_id,
    form_type: 'shukaisu',
    form_period: data.period_key,
    student_name: data.student_name,
    grade: data.grade,
    email: data.email,
    response_data: data.response_data as never,
    status_checks: {
      charged: false,
      seated: false,
    },
  };

  await createPublicFormResponse(responseData);
}

// ============================================
// 週回数変更回答一覧
// ============================================

/**
 * 週回数変更回答一覧を取得
 */
export async function getShukaisuResponses(
  schoolId: string | string[],
  periodKey: string,
  filters?: ShukaisuResponseFilters
): Promise<ShukaisuResponse[]> {
  const responses = await getFormResponses(schoolId, {
    formType: 'shukaisu',
    formPeriod: periodKey,
    grade: filters?.grade,
    linkedStatus: filters?.linkedStatus,
    showArchived: filters?.showArchived,
    search: filters?.search,
  });

  // フィルター適用
  let filtered = responses.map((r) => ({
    ...r,
    form_type: 'shukaisu' as const,
    response_data: r.response_data as unknown as ShukaisuResponseData,
  }));

  // 対応状況フィルター（計上・座席の両方済みを「対応済み」とする）
  if (filters?.handledStatus && filters.handledStatus !== 'all') {
    if (filters.handledStatus === 'handled') {
      filtered = filtered.filter(
        (r) => r.status_checks?.charged === true && r.status_checks?.seated === true
      );
    } else {
      filtered = filtered.filter(
        (r) => !(r.status_checks?.charged === true && r.status_checks?.seated === true)
      );
    }
  }

  return filtered;
}

/**
 * 週回数変更集計データを取得
 */
export async function getShukaisuStats(
  schoolId: string | string[],
  periodKey: string
): Promise<ShukaisuStats> {
  const responses = await getShukaisuResponses(schoolId, periodKey);

  const handledCount = responses.filter(
    (r) => r.status_checks?.charged === true && r.status_checks?.seated === true
  ).length;
  const linkedCount = responses.filter((r) => r.linked_student_id !== null).length;

  return {
    total_responses: responses.length,
    handled_count: handledCount,
    linked_count: linkedCount,
  };
}

/**
 * 週回数変更回答の計上・座席状態を更新（既存の status_checks とマージ）
 */
export const updateShukaisuStatusCheck = updateStatusChecksWithBilling;

/**
 * 週回数変更期間の回答数を取得
 */
export async function getShukaisuResponseCount(
  schoolId: string,
  periodKey: string
): Promise<number> {
  const responses = await getShukaisuResponses(schoolId, periodKey);
  return responses.length;
}
