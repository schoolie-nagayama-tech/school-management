import { createPeriodApi, updateStatusChecksWithBilling } from './form-period-api';
import { createPublicFormResponse, getFormResponses } from './form-responses';
import type { FormResponseInsert } from '@/types/database';
import type {
  YoubiPeriod,
  YoubiResponse,
  YoubiResponseData,
  YoubiResponseFilters,
  YoubiStats,
} from '@/types/forms/youbi';

// ============================================
// 曜日変更期間管理（共通の期間CRUDは createPeriodApi に集約）
// ============================================

const periodApi = createPeriodApi<'youbi', YoubiPeriod>('youbi');

export const getYoubiPeriods = periodApi.getPeriods;
export const getActiveYoubiPeriod = periodApi.getActivePeriod;
export const getYoubiPeriod = periodApi.getPeriod;
export const getYoubiPeriodByKey = periodApi.getPeriodByKey;
export const createYoubiPeriod = periodApi.createPeriod;
export const updateYoubiPeriod = periodApi.updatePeriod;
export const deleteYoubiPeriod = periodApi.deletePeriod;
export const archiveYoubiPeriod = periodApi.archive;
export const unarchiveYoubiPeriod = periodApi.unarchive;

// ============================================
// 曜日変更回答送信
// ============================================

/**
 * 曜日変更回答を送信
 */
export async function submitYoubiResponse(data: {
  school_id: string;
  period_key: string;
  student_name: string;
  grade: number;
  email: string;
  response_data: YoubiResponseData;
}): Promise<void> {
  const responseData: FormResponseInsert = {
    school_id: data.school_id,
    form_type: 'youbi',
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
// 曜日変更回答一覧
// ============================================

/**
 * 曜日変更回答一覧を取得
 */
export async function getYoubiResponses(
  schoolId: string | string[],
  periodKey: string,
  filters?: YoubiResponseFilters
): Promise<YoubiResponse[]> {
  const responses = await getFormResponses(schoolId, {
    formType: 'youbi',
    formPeriod: periodKey,
    grade: filters?.grade,
    linkedStatus: filters?.linkedStatus,
    showArchived: filters?.showArchived,
    search: filters?.search,
  });

  // フィルター適用
  let filtered = responses.map((r) => ({
    ...r,
    form_type: 'youbi' as const,
    response_data: r.response_data as unknown as YoubiResponseData,
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
 * 曜日変更集計データを取得
 */
export async function getYoubiStats(
  schoolId: string | string[],
  periodKey: string
): Promise<YoubiStats> {
  const responses = await getYoubiResponses(schoolId, periodKey);

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
 * 曜日変更回答の計上・座席状態を更新（既存の status_checks とマージ）
 */
export const updateYoubiStatusCheck = updateStatusChecksWithBilling;

/**
 * 曜日変更期間の回答数を取得
 */
export async function getYoubiResponseCount(schoolId: string, periodKey: string): Promise<number> {
  const responses = await getYoubiResponses(schoolId, periodKey);
  return responses.length;
}
