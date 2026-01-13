import { supabase } from '../supabase';
import {
  getFormPeriods,
  getActiveFormPeriod,
  getFormPeriod,
  createFormPeriod,
  updateFormPeriod,
  deleteFormPeriod,
  archivePeriod,
  unarchivePeriod,
} from './form-periods';
import { createFormResponse, getFormResponses, updateFormResponseStatus, archiveResponse, unarchiveResponse, archiveResponses, getArchivedCount } from './form-responses';
import { getDefaultSchoolId, getSchoolByCode } from './schools';
import type {
  FormPeriod,
  FormPeriodInsert,
  FormPeriodUpdate,
  FormResponseInsert,
} from '@/types/database';
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
    settings: (p.settings || {}) as ShukaisuSettings,
  }));
}

/**
 * 公開中の週回数変更期間を取得（ポータル用）
 */
export async function getActiveShukaisuPeriod(
  schoolCode: string
): Promise<ShukaisuPeriod | null> {
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
    settings: (period.settings || {}) as ShukaisuSettings,
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
    settings: (period.settings || {}) as ShukaisuSettings,
  };
}

/**
 * 週回数変更期間を作成
 */
export async function createShukaisuPeriod(
  data: Omit<FormPeriodInsert, 'school_id' | 'form_type'>
): Promise<ShukaisuPeriod> {
  const schoolId = getDefaultSchoolId();

  const periodData: FormPeriodInsert = {
    ...data,
    school_id: schoolId,
    form_type: 'shukaisu',
    settings: (data.settings || {}) as ShukaisuSettings,
  };

  const period = await createFormPeriod(periodData);
  return {
    ...period,
    form_type: 'shukaisu' as const,
    settings: (period.settings || {}) as ShukaisuSettings,
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
    settings: data.settings ? (data.settings as ShukaisuSettings) : undefined,
  };

  const period = await updateFormPeriod(id, updateData);
  return {
    ...period,
    form_type: 'shukaisu' as const,
    settings: (period.settings || {}) as ShukaisuSettings,
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
export async function submitShukaisuResponse(
  data: {
    school_id: string;
    period_key: string;
    student_name: string;
    grade: number;
    email: string;
    response_data: ShukaisuResponseData;
  }
): Promise<void> {
  const responseData: FormResponseInsert = {
    school_id: data.school_id,
    form_type: 'shukaisu',
    form_period: data.period_key,
    student_name: data.student_name,
    grade: data.grade,
    email: data.email,
    response_data: data.response_data as never,
    status_checks: {
      handled: false,
    },
  };

  await createFormResponse(responseData);
}

// ============================================
// 週回数変更回答一覧
// ============================================

/**
 * 週回数変更回答一覧を取得
 */
export async function getShukaisuResponses(
  schoolId: string,
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
    response_data: r.response_data as ShukaisuResponseData,
  }));

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
 * 週回数変更集計データを取得
 */
export async function getShukaisuStats(
  schoolId: string,
  periodKey: string
): Promise<ShukaisuStats> {
  const responses = await getShukaisuResponses(schoolId, periodKey);

  const handledCount = responses.filter(
    (r) => r.status_checks?.handled === true
  ).length;
  const linkedCount = responses.filter((r) => r.linked_student_id !== null).length;

  return {
    total_responses: responses.length,
    handled_count: handledCount,
    linked_count: linkedCount,
  };
}

/**
 * 週回数変更回答の対応状況を更新
 */
export async function updateShukaisuHandledStatus(
  responseId: string,
  handled: boolean
): Promise<void> {
  await updateFormResponseStatus(responseId, { handled });
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
