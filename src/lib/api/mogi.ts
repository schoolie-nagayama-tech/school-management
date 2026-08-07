import { createPeriodApi, updateChargedStatusWithBilling } from './form-period-api';
import {
  createPublicFormResponse,
  getFormResponse,
  getFormResponses,
  updateFormResponseStatus,
} from './form-responses';
import type { FormResponseInsert } from '@/types/database';
import type {
  MogiPeriod,
  MogiResponse,
  MogiResponseData,
  MogiResponseFilters,
  MogiStats,
} from '@/types/forms/mogi';

// ============================================
// Vもぎ期間管理（共通の期間CRUDは createPeriodApi に集約）
// ============================================

const periodApi = createPeriodApi<'mogi', MogiPeriod>('mogi');

export const getMogiPeriods = periodApi.getPeriods;
export const getActiveMogiPeriod = periodApi.getActivePeriod;
export const getMogiPeriod = periodApi.getPeriod;
export const getMogiPeriodByKey = periodApi.getPeriodByKey;
export const createMogiPeriod = periodApi.createPeriod;
export const updateMogiPeriod = periodApi.updatePeriod;
export const deleteMogiPeriod = periodApi.deletePeriod;

/**
 * 前回の期間設定をコピーして新規作成
 */
export async function copyMogiPeriod(sourceId: string): Promise<MogiPeriod> {
  const source = await getMogiPeriod(sourceId);
  if (!source) {
    throw new Error('コピー元の期間が見つかりません');
  }

  return createMogiPeriod(
    {
      period_key: '', // 空欄（手入力）
      title: '', // 空欄（手入力）
      settings: source.settings as unknown as Record<string, unknown>,
      publish_start: null,
      publish_end: null,
      is_active: false,
      linked_application_item_id: null,
    },
    source.school_id
  );
}

// ============================================
// Vもぎ回答送信
// ============================================

/**
 * Vもぎ回答を送信
 */
export async function submitMogiResponse(data: {
  school_id: string;
  period_key: string;
  student_name: string;
  grade: number;
  email: string;
  response_data: MogiResponseData;
}): Promise<void> {
  const responseData: FormResponseInsert = {
    school_id: data.school_id,
    form_type: 'mogi',
    form_period: data.period_key,
    student_name: data.student_name,
    grade: data.grade,
    email: data.email,
    response_data: data.response_data as never,
    status_checks: {
      charged: false,
      applied: false,
    },
  };

  await createPublicFormResponse(responseData);
}

// ============================================
// Vもぎ回答一覧
// ============================================

/**
 * Vもぎ回答一覧を取得
 */
export async function getMogiResponses(
  schoolId: string | string[],
  periodKey: string,
  filters?: MogiResponseFilters
): Promise<MogiResponse[]> {
  const responses = await getFormResponses(schoolId, {
    formType: 'mogi',
    formPeriod: periodKey,
    grade: filters?.grade,
    linkedStatus: filters?.linkedStatus,
    showArchived: filters?.showArchived,
    chargedStatus: filters?.chargedStatus,
  });

  // フィルター適用
  let filtered = responses.map((r) => ({
    ...r,
    form_type: 'mogi' as const,
    response_data: r.response_data as unknown as MogiResponseData,
  }));

  // 模試種別フィルター
  if (filters?.examType) {
    filtered = filtered.filter((r) =>
      r.response_data.selections.some((s) => s.exam_type === filters.examType)
    );
  }

  // 日程フィルター
  if (filters?.dateId) {
    filtered = filtered.filter((r) =>
      r.response_data.selections.some((s) => s.date_id === filters.dateId)
    );
  }

  // 会場フィルター
  if (filters?.venueId) {
    filtered = filtered.filter((r) =>
      r.response_data.selections.some((s) => s.venue_id === filters.venueId)
    );
  }

  // 計上状態フィルター
  if (filters?.chargedStatus) {
    filtered = filtered.filter((r) => {
      const charged = r.status_checks?.charged || false;
      return filters.chargedStatus === 'charged' ? charged : !charged;
    });
  }

  // 申込状態フィルター（未設定の回答は「未申込」として扱う）
  if (filters?.appliedStatus) {
    filtered = filtered.filter((r) => {
      const applied = r.status_checks?.applied || false;
      return filters.appliedStatus === 'applied' ? applied : !applied;
    });
  }

  return filtered;
}

/**
 * Vもぎ集計データを取得
 */
export async function getMogiStats(
  schoolId: string | string[],
  periodKey: string
): Promise<MogiStats> {
  const responses = await getMogiResponses(schoolId, periodKey);

  // 期間設定を取得して日程・会場のマスタを取得
  const firstSchoolId = Array.isArray(schoolId) ? schoolId[0] : schoolId;
  const periods = await getMogiPeriods(firstSchoolId);
  const period = periods.find((p) => p.period_key === periodKey);

  if (!period || !period.settings.dates) {
    return {
      total_responses: responses.length,
      date_venue_counts: [],
      charged_count: 0,
      applied_count: 0,
      linked_count: 0,
    };
  }

  // 日程・会場別の集計
  const dateVenueCounts = period.settings.dates.map((date) => {
    const venueCounts = date.venues.map((venue) => {
      const count = responses.filter((r) =>
        r.response_data.selections.some((s) => s.date_id === date.id && s.venue_id === venue.id)
      ).length;
      return {
        venue_id: venue.id,
        venue_label: venue.label,
        count,
      };
    });

    const total = venueCounts.reduce((sum, v) => sum + v.count, 0);

    return {
      date_id: date.id,
      date_label: date.label,
      exam_type: date.exam_type,
      venue_counts: venueCounts,
      total,
    };
  });

  // 種別ごとの回答数（選択ベース）
  const typeBuckets: Record<string, number> = {};
  for (const r of responses) {
    for (const s of r.response_data.selections) {
      const key = s.exam_type ?? 'unclassified';
      typeBuckets[key] = (typeBuckets[key] ?? 0) + 1;
    }
  }
  const { MOGI_EXAM_TYPE_LABELS: typeLabels } = await import('@/types/forms/mogi');
  const allTypeKeys = Object.keys(typeLabels) as (keyof typeof typeLabels)[];
  const typeCounts = [
    ...allTypeKeys.map((key) => ({
      exam_type: key,
      label: typeLabels[key],
      count: typeBuckets[key] ?? 0,
    })),
    ...(typeBuckets['unclassified']
      ? [
          {
            exam_type: 'unclassified' as const,
            label: '未分類',
            count: typeBuckets['unclassified'],
          },
        ]
      : []),
  ].filter((t) => t.count > 0);

  const chargedCount = responses.filter((r) => r.status_checks?.charged === true).length;

  const appliedCount = responses.filter((r) => r.status_checks?.applied === true).length;

  const linkedCount = responses.filter((r) => r.linked_student_id !== null).length;

  return {
    total_responses: responses.length,
    date_venue_counts: dateVenueCounts,
    type_counts: typeCounts,
    charged_count: chargedCount,
    applied_count: appliedCount,
    linked_count: linkedCount,
  };
}

/**
 * Vもぎ回答の計上状態を更新（既存の status_checks をマージし請求へ同期）
 */
export const updateMogiChargedStatus = updateChargedStatusWithBilling;

/**
 * Vもぎ回答の申込状態を更新（既存の status_checks をマージ）
 * 計上とは別の進捗管理なので請求への同期は行わない。
 */
export async function updateMogiAppliedStatus(responseId: string, applied: boolean): Promise<void> {
  const response = await getFormResponse(responseId);
  const current = (response?.status_checks || {}) as Record<string, boolean>;
  await updateFormResponseStatus(responseId, { ...current, applied });
}

/**
 * Vもぎ期間の回答数を取得
 */
export async function getMogiResponseCount(schoolId: string, periodKey: string): Promise<number> {
  const responses = await getMogiResponses(schoolId, periodKey);
  return responses.length;
}
