import { createPeriodApi, updateChargedStatusWithBilling } from './form-period-api';
import {
  createPublicFormResponse,
  getFormResponses,
  getFormResponse,
  updateFormResponseStatus,
} from './form-responses';
import type { FormResponseInsert } from '@/types/database';
import type {
  MoshiExamDateCount,
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

  // 試験日程フィルター（通常受験のみが対象。振替は日程を選ばないので除外される）
  if (filters?.examDateId && filters.examDateId !== 'all') {
    filtered = filtered.filter((r) => r.response_data.selected_exam_date_id === filters.examDateId);
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

  // 試験日程ごとの申込数。回答に焼き込まれた値で集計するので期間設定の取得は不要
  const countsById = new Map<string, MoshiExamDateCount>();
  for (const r of responses) {
    const d = r.response_data;
    if (d.exam_type !== 'regular' || !d.selected_exam_date_id) continue;
    const existing = countsById.get(d.selected_exam_date_id);
    if (existing) {
      existing.count += 1;
    } else {
      countsById.set(d.selected_exam_date_id, {
        id: d.selected_exam_date_id,
        date: d.selected_exam_date || '',
        label: d.selected_exam_date_label || d.selected_exam_date || '',
        time: d.selected_exam_time,
        count: 1,
      });
    }
  }

  return {
    total_responses: responses.length,
    regular_count: regularCount,
    furikae_count: furikaeCount,
    charged_count: chargedCount,
    linked_count: linkedCount,
    exam_date_counts: Array.from(countsById.values()).sort((a, b) => a.date.localeCompare(b.date)),
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
