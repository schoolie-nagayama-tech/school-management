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
import {
  createPublicFormResponse,
  getFormResponses,
  getFormResponse,
  updateFormResponseStatus,
} from './form-responses';
import { syncFormResponseToBilling } from './billing';
import { getDefaultSchoolId, getSchoolByCode } from './schools';
import type { FormPeriodInsert, FormPeriodUpdate, FormResponseInsert } from '@/types/database';
import type {
  ShukaisuPeriod,
  ShukaisuSettings,
  ShukaisuResponse,
  ShukaisuResponseData,
  ShukaisuResponseFilters,
  ShukaisuStats,
} from '@/types/forms/shukaisu';

// ============================================
// 週回数変更期間管理
// ============================================

/**
 * 週回数変更期間一覧を取得
 */
export async function getShukaisuPeriods(
  schoolId?: string,
  includeArchived: boolean = false
): Promise<ShukaisuPeriod[]> {
  const targetSchoolId = schoolId || getDefaultSchoolId();
  const periods = await getFormPeriods(targetSchoolId, 'shukaisu', includeArchived);
  return periods.map((p) => ({
    ...p,
    form_type: 'shukaisu' as const,
    settings: (p.settings || {}) as unknown as ShukaisuSettings,
  }));
}

/**
 * 公開中の週回数変更期間を取得（ポータル用）
 */
export async function getActiveShukaisuPeriod(schoolCode: string): Promise<ShukaisuPeriod | null> {
  const school = await getSchoolByCode(schoolCode);
  if (!school) {
    return null;
  }

  const period = await getActiveFormPeriod(school.id, 'shukaisu');
  if (!period) {
    return null;
  }

  return {
    ...period,
    form_type: 'shukaisu' as const,
    settings: (period.settings || {}) as unknown as ShukaisuSettings,
  };
}

/**
 * 週回数変更期間を1件取得
 */
export async function getShukaisuPeriod(id: string): Promise<ShukaisuPeriod | null> {
  const period = await getFormPeriod(id);
  if (!period || period.form_type !== 'shukaisu') {
    return null;
  }

  return {
    ...period,
    form_type: 'shukaisu' as const,
    settings: (period.settings || {}) as unknown as ShukaisuSettings,
  };
}

/**
 * 週回数変更期間を period_key で取得（プレビュー用）
 */
export async function getShukaisuPeriodByKey(
  schoolId: string,
  periodKey: string
): Promise<ShukaisuPeriod | null> {
  const period = await getFormPeriodByKey(schoolId, 'shukaisu', periodKey);
  if (!period) return null;
  return {
    ...period,
    form_type: 'shukaisu' as const,
    settings: (period.settings || {}) as unknown as ShukaisuSettings,
  };
}

/**
 * 週回数変更期間を作成
 * @param data 期間データ（school_id / form_type 除く）
 * @param schoolId 教室ID（省略時は getDefaultSchoolId()）
 */
export async function createShukaisuPeriod(
  data: Omit<FormPeriodInsert, 'school_id' | 'form_type'>,
  schoolId?: string
): Promise<ShukaisuPeriod> {
  const targetSchoolId = schoolId ?? getDefaultSchoolId();

  const periodData: FormPeriodInsert = {
    ...data,
    school_id: targetSchoolId,
    form_type: 'shukaisu',
    settings: (data.settings || {}) as unknown as Record<string, unknown>,
  };

  const period = await createFormPeriod(periodData);
  return {
    ...period,
    form_type: 'shukaisu' as const,
    settings: (period.settings || {}) as unknown as ShukaisuSettings,
  };
}

/**
 * 週回数変更期間を更新
 */
export async function updateShukaisuPeriod(
  id: string,
  data: FormPeriodUpdate
): Promise<ShukaisuPeriod> {
  const updateData: FormPeriodUpdate = {
    ...data,
    settings: data.settings ? (data.settings as unknown as Record<string, unknown>) : undefined,
  };

  const period = await updateFormPeriod(id, updateData);
  return {
    ...period,
    form_type: 'shukaisu' as const,
    settings: (period.settings || {}) as unknown as ShukaisuSettings,
  };
}

/**
 * 週回数変更期間を削除
 */
export async function deleteShukaisuPeriod(id: string): Promise<void> {
  await deleteFormPeriod(id);
}

/**
 * 週回数変更期間をアーカイブ
 */
export async function archiveShukaisuPeriod(
  id: string,
  schoolId: string,
  periodKey: string
): Promise<{ periodArchived: boolean; responsesArchived: number }> {
  return archivePeriod(id, schoolId, 'shukaisu', periodKey);
}

/**
 * 週回数変更期間のアーカイブを解除
 */
export async function unarchiveShukaisuPeriod(
  id: string,
  schoolId: string,
  periodKey: string
): Promise<{ periodUnarchived: boolean; responsesUnarchived: number }> {
  return unarchivePeriod(id, schoolId, 'shukaisu', periodKey);
}

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
export async function updateShukaisuStatusCheck(
  responseId: string,
  statusChecks: { charged?: boolean; seated?: boolean }
): Promise<void> {
  const response = await getFormResponse(responseId);
  if (!response) throw new Error('回答が見つかりません');
  const current = (response.status_checks || {}) as Record<string, boolean>;
  await updateFormResponseStatus(responseId, { ...current, ...statusChecks });
  // charged が含まれる場合のみ請求側へ同期
  if (statusChecks.charged !== undefined) {
    try {
      await syncFormResponseToBilling(responseId);
    } catch (err) {
      console.warn('請求への計上同期に失敗:', err);
    }
  }
}

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
