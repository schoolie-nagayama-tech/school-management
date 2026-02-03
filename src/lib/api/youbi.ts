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
import { createFormResponse, getFormResponses, updateFormResponseStatus } from './form-responses';
import { getDefaultSchoolId, getSchoolByCode } from './schools';
import type {
  FormPeriodInsert,
  FormPeriodUpdate,
  FormResponseInsert,
} from '@/types/database';
import type {
  YoubiPeriod,
  YoubiSettings,
  YoubiResponse,
  YoubiResponseData,
  YoubiResponseFilters,
  YoubiStats,
} from '@/types/forms/youbi';

// ============================================
// 曜日変更期間管理
// ============================================

/**
 * 曜日変更期間一覧を取得
 */
export async function getYoubiPeriods(
  schoolId?: string,
  includeArchived: boolean = false
): Promise<YoubiPeriod[]> {
  const targetSchoolId = schoolId || getDefaultSchoolId();
  const periods = await getFormPeriods(targetSchoolId, 'youbi', includeArchived);
  return periods.map((p) => ({
    ...p,
    form_type: 'youbi' as const,
    settings: (p.settings || {}) as YoubiSettings,
  }));
}

/**
 * 公開中の曜日変更期間を取得（ポータル用）
 */
export async function getActiveYoubiPeriod(
  schoolCode: string
): Promise<YoubiPeriod | null> {
  const school = await getSchoolByCode(schoolCode);
  if (!school) {
    return null;
  }

  const period = await getActiveFormPeriod(school.id, 'youbi');
  if (!period) {
    return null;
  }

  return {
    ...period,
    form_type: 'youbi' as const,
    settings: (period.settings || {}) as YoubiSettings,
  };
}

/**
 * 曜日変更期間を1件取得
 */
export async function getYoubiPeriod(id: string): Promise<YoubiPeriod | null> {
  const period = await getFormPeriod(id);
  if (!period || period.form_type !== 'youbi') {
    return null;
  }

  return {
    ...period,
    form_type: 'youbi' as const,
    settings: (period.settings || {}) as YoubiSettings,
  };
}

/**
 * 曜日変更期間を作成
 * @param data 期間データ（school_id / form_type 除く）
 * @param schoolId 教室ID（省略時は getDefaultSchoolId()）
 */
export async function createYoubiPeriod(
  data: Omit<FormPeriodInsert, 'school_id' | 'form_type'>,
  schoolId?: string
): Promise<YoubiPeriod> {
  const targetSchoolId = schoolId ?? getDefaultSchoolId();

  const periodData: FormPeriodInsert = {
    ...data,
    school_id: targetSchoolId,
    form_type: 'youbi',
    settings: (data.settings || {}) as YoubiSettings,
  };

  const period = await createFormPeriod(periodData);
  return {
    ...period,
    form_type: 'youbi' as const,
    settings: (period.settings || {}) as YoubiSettings,
  };
}

/**
 * 曜日変更期間を更新
 */
export async function updateYoubiPeriod(
  id: string,
  data: FormPeriodUpdate
): Promise<YoubiPeriod> {
  const updateData: FormPeriodUpdate = {
    ...data,
    settings: data.settings ? (data.settings as YoubiSettings) : undefined,
  };

  const period = await updateFormPeriod(id, updateData);
  return {
    ...period,
    form_type: 'youbi' as const,
    settings: (period.settings || {}) as YoubiSettings,
  };
}

/**
 * 曜日変更期間を削除
 */
export async function deleteYoubiPeriod(id: string): Promise<void> {
  await deleteFormPeriod(id);
}

/**
 * 曜日変更期間をアーカイブ
 */
export async function archiveYoubiPeriod(
  id: string,
  schoolId: string,
  periodKey: string
): Promise<{ periodArchived: boolean; responsesArchived: number }> {
  return archivePeriod(id, schoolId, 'youbi', periodKey);
}

/**
 * 曜日変更期間のアーカイブを解除
 */
export async function unarchiveYoubiPeriod(
  id: string,
  schoolId: string,
  periodKey: string
): Promise<{ periodUnarchived: boolean; responsesUnarchived: number }> {
  return unarchivePeriod(id, schoolId, 'youbi', periodKey);
}

// ============================================
// 曜日変更回答送信
// ============================================

/**
 * 曜日変更回答を送信
 */
export async function submitYoubiResponse(
  data: {
    school_id: string;
    period_key: string;
    student_name: string;
    grade: number;
    email: string;
    response_data: YoubiResponseData;
  }
): Promise<void> {
  const responseData: FormResponseInsert = {
    school_id: data.school_id,
    form_type: 'youbi',
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
// 曜日変更回答一覧
// ============================================

/**
 * 曜日変更回答一覧を取得
 */
export async function getYoubiResponses(
  schoolId: string,
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
    response_data: r.response_data as YoubiResponseData,
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
 * 曜日変更集計データを取得
 */
export async function getYoubiStats(
  schoolId: string,
  periodKey: string
): Promise<YoubiStats> {
  const responses = await getYoubiResponses(schoolId, periodKey);

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
 * 曜日変更回答の対応状況を更新
 */
export async function updateYoubiHandledStatus(
  responseId: string,
  handled: boolean
): Promise<void> {
  await updateFormResponseStatus(responseId, { handled });
}

/**
 * 曜日変更期間の回答数を取得
 */
export async function getYoubiResponseCount(
  schoolId: string,
  periodKey: string
): Promise<number> {
  const responses = await getYoubiResponses(schoolId, periodKey);
  return responses.length;
}
