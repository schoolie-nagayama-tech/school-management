import { supabase } from '@/lib/supabase';
import { createPeriodApi, updateChargedStatusWithBilling } from './form-period-api';
import {
  createPublicFormResponse,
  getFormResponses,
  getFormResponse,
  updateFormResponseStatus,
} from './form-responses';
import { getDefaultSchoolId } from './schools';
import type { FormResponseInsert } from '@/types/database';
import type {
  SoudanPeriod,
  SoudanResponse,
  SoudanResponseData,
  SoudanResponseFilters,
  SoudanStats,
} from '@/types/forms/soudan';

// ============================================
// お客様相談期間管理（共通の期間CRUDは createPeriodApi に集約）
// ============================================

const periodApi = createPeriodApi<'soudan', SoudanPeriod>('soudan');

export const getSoudanPeriods = periodApi.getPeriods;
export const getActiveSoudanPeriod = periodApi.getActivePeriod;
export const getSoudanPeriod = periodApi.getPeriod;
export const getSoudanPeriodByKey = periodApi.getPeriodByKey;
export const createSoudanPeriod = periodApi.createPeriod;
export const updateSoudanPeriod = periodApi.updatePeriod;
export const deleteSoudanPeriod = periodApi.deletePeriod;
export const archiveSoudanPeriod = periodApi.archive;
export const unarchiveSoudanPeriod = periodApi.unarchive;

// ============================================
// お客様相談回答送信
// ============================================

/**
 * お客様相談回答を送信
 */
export async function submitSoudanResponse(data: {
  school_id: string;
  period_key: string;
  student_name: string;
  grade: number;
  email: string;
  response_data: SoudanResponseData;
}): Promise<void> {
  const responseData: FormResponseInsert = {
    school_id: data.school_id,
    form_type: 'soudan',
    form_period: data.period_key,
    student_name: data.student_name || '',
    grade: data.grade || 0,
    email: data.email || '',
    response_data: data.response_data as never,
    status_checks: {
      handled: false,
    },
  };

  await createPublicFormResponse(responseData);
}

// ============================================
// お客様相談回答一覧
// ============================================

/**
 * お客様相談回答一覧を取得
 */
export async function getSoudanResponses(
  schoolId: string | string[],
  periodKey: string,
  filters?: SoudanResponseFilters
): Promise<SoudanResponse[]> {
  const responses = await getFormResponses(schoolId, {
    formType: 'soudan',
    formPeriod: periodKey,
    grade: filters?.grade,
    linkedStatus: filters?.linkedStatus,
    showArchived: filters?.showArchived,
    search: filters?.search,
  });

  // フィルター適用
  let filtered = responses.map((r) => ({
    ...r,
    form_type: 'soudan' as const,
    response_data: r.response_data as unknown as SoudanResponseData,
  }));

  // 相談区分フィルター
  if (filters?.category) {
    filtered = filtered.filter((r) => r.response_data.categories?.includes(filters.category!));
  }

  // 対応状況フィルター
  if (filters?.handledStatus && filters.handledStatus !== 'all') {
    if (filters.handledStatus === 'handled') {
      filtered = filtered.filter((r) => r.status_checks?.handled === true);
    } else {
      filtered = filtered.filter((r) => !r.status_checks?.handled);
    }
  }

  return filtered;
}

/**
 * お客様相談集計データを取得
 */
export async function getSoudanStats(
  schoolId: string | string[],
  periodKey: string
): Promise<SoudanStats> {
  const responses = await getSoudanResponses(schoolId, periodKey);

  const handledCount = responses.filter((r) => r.status_checks?.handled === true).length;
  const linkedCount = responses.filter((r) => r.linked_student_id !== null).length;

  // 相談区分別の集計
  const categoryMap = new Map<string, number>();
  responses.forEach((r) => {
    const categories = r.response_data.categories || [];
    if (categories.length === 0) {
      categoryMap.set('未分類', (categoryMap.get('未分類') || 0) + 1);
    } else {
      categories.forEach((category) => {
        categoryMap.set(category, (categoryMap.get(category) || 0) + 1);
      });
    }
  });

  const categoryCounts = Array.from(categoryMap.entries()).map(([category, count]) => ({
    category,
    count,
  }));

  return {
    total_responses: responses.length,
    handled_count: handledCount,
    linked_count: linkedCount,
    category_counts: categoryCounts,
  };
}

/**
 * お客様相談回答の対応状況を更新（既存の status_checks をマージ。請求同期はなし）
 */
export async function updateSoudanHandledStatus(
  responseId: string,
  handled: boolean
): Promise<void> {
  const response = await getFormResponse(responseId);
  const current = (response?.status_checks || {}) as Record<string, boolean>;
  await updateFormResponseStatus(responseId, { ...current, handled });
}

/**
 * お客様相談回答の計上状態を更新（既存の status_checks をマージし請求へ同期）
 */
export const updateSoudanChargedStatus = updateChargedStatusWithBilling;

/**
 * お客様相談期間の回答数を取得
 */
export async function getSoudanResponseCount(schoolId: string, periodKey: string): Promise<number> {
  const responses = await getSoudanResponses(schoolId, periodKey);
  return responses.length;
}

/**
 * 未対応のお客様相談の回答数を取得（全期間）
 */
export async function getUnhandledSoudanCount(schoolId?: string): Promise<number> {
  const targetSchoolId = schoolId || getDefaultSchoolId();

  // 非アーカイブ期間のperiod_keyを一括取得
  const periods = await getSoudanPeriods(targetSchoolId, false);
  if (periods.length === 0) return 0;

  const periodKeys = periods.map((p) => p.period_key);

  // DB側でCOUNTのみ取得（全回答データの転送不要）
  const { count } = await supabase
    .from('form_responses')
    .select('*', { count: 'exact', head: true })
    .eq('school_id', targetSchoolId)
    .eq('form_type', 'soudan')
    .in('form_period', periodKeys)
    .eq('is_archived', false)
    .or('status_checks->handled.is.null,status_checks->handled.eq.false');

  return count ?? 0;
}
