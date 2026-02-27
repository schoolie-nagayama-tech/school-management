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
  SoudanPeriod,
  SoudanSettings,
  SoudanResponse,
  SoudanResponseData,
  SoudanResponseFilters,
  SoudanStats,
} from '@/types/forms/soudan';

// ============================================
// お客様相談期間管理
// ============================================

/**
 * お客様相談期間一覧を取得
 */
export async function getSoudanPeriods(
  schoolId?: string,
  includeArchived: boolean = false
): Promise<SoudanPeriod[]> {
  const targetSchoolId = schoolId || getDefaultSchoolId();
  const periods = await getFormPeriods(targetSchoolId, 'soudan', includeArchived);
  return periods.map((p) => ({
    ...p,
    form_type: 'soudan' as const,
    settings: (p.settings || {}) as unknown as SoudanSettings,
  }));
}

/**
 * 公開中のお客様相談期間を取得（ポータル用）
 */
export async function getActiveSoudanPeriod(
  schoolCode: string
): Promise<SoudanPeriod | null> {
  const school = await getSchoolByCode(schoolCode);
  if (!school) {
    return null;
  }

  const period = await getActiveFormPeriod(school.id, 'soudan');
  if (!period) {
    return null;
  }

  return {
    ...period,
    form_type: 'soudan' as const,
    settings: (period.settings || {}) as unknown as SoudanSettings,
  };
}

/**
 * お客様相談期間を1件取得
 */
export async function getSoudanPeriod(id: string): Promise<SoudanPeriod | null> {
  const period = await getFormPeriod(id);
  if (!period || period.form_type !== 'soudan') {
    return null;
  }

  return {
    ...period,
    form_type: 'soudan' as const,
    settings: (period.settings || {}) as unknown as SoudanSettings,
  };
}

/**
 * お客様相談期間を period_key で取得（プレビュー用）
 */
export async function getSoudanPeriodByKey(
  schoolId: string,
  periodKey: string
): Promise<SoudanPeriod | null> {
  const period = await getFormPeriodByKey(schoolId, 'soudan', periodKey);
  if (!period) return null;
  return {
    ...period,
    form_type: 'soudan' as const,
    settings: (period.settings || {}) as unknown as SoudanSettings,
  };
}

/**
 * お客様相談期間を作成
 * @param data 期間データ（school_id / form_type 除く）
 * @param schoolId 教室ID（省略時は getDefaultSchoolId()）
 */
export async function createSoudanPeriod(
  data: Omit<FormPeriodInsert, 'school_id' | 'form_type'>,
  schoolId?: string
): Promise<SoudanPeriod> {
  const targetSchoolId = schoolId ?? getDefaultSchoolId();

  const periodData: FormPeriodInsert = {
    ...data,
    school_id: targetSchoolId,
    form_type: 'soudan',
    settings: (data.settings || {}) as unknown as Record<string, unknown>,
  };

  const period = await createFormPeriod(periodData);
  return {
    ...period,
    form_type: 'soudan' as const,
    settings: (period.settings || {}) as unknown as SoudanSettings,
  };
}

/**
 * お客様相談期間を更新
 */
export async function updateSoudanPeriod(
  id: string,
  data: FormPeriodUpdate
): Promise<SoudanPeriod> {
  const updateData: FormPeriodUpdate = {
    ...data,
    settings: data.settings ? (data.settings as unknown as Record<string, unknown>) : undefined,
  };

  const period = await updateFormPeriod(id, updateData);
  return {
    ...period,
    form_type: 'soudan' as const,
    settings: (period.settings || {}) as unknown as SoudanSettings,
  };
}

/**
 * お客様相談期間を削除
 */
export async function deleteSoudanPeriod(id: string): Promise<void> {
  await deleteFormPeriod(id);
}

/**
 * お客様相談期間をアーカイブ
 */
export async function archiveSoudanPeriod(
  id: string,
  schoolId: string,
  periodKey: string
): Promise<{ periodArchived: boolean; responsesArchived: number }> {
  return archivePeriod(id, schoolId, 'soudan', periodKey);
}

/**
 * お客様相談期間のアーカイブを解除
 */
export async function unarchiveSoudanPeriod(
  id: string,
  schoolId: string,
  periodKey: string
): Promise<{ periodUnarchived: boolean; responsesUnarchived: number }> {
  return unarchivePeriod(id, schoolId, 'soudan', periodKey);
}

// ============================================
// お客様相談回答送信
// ============================================

/**
 * お客様相談回答を送信
 */
export async function submitSoudanResponse(
  data: {
    school_id: string;
    period_key: string;
    student_name: string;
    grade: number;
    email: string;
    response_data: SoudanResponseData;
  }
): Promise<void> {
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

  await createFormResponse(responseData);
}

// ============================================
// お客様相談回答一覧
// ============================================

/**
 * お客様相談回答一覧を取得
 */
export async function getSoudanResponses(
  schoolId: string,
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
    filtered = filtered.filter((r) => 
      r.response_data.categories?.includes(filters.category!)
    );
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
  schoolId: string,
  periodKey: string
): Promise<SoudanStats> {
  const responses = await getSoudanResponses(schoolId, periodKey);

  const handledCount = responses.filter(
    (r) => r.status_checks?.handled === true
  ).length;
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
 * お客様相談回答の対応状況を更新
 */
export async function updateSoudanHandledStatus(
  responseId: string,
  handled: boolean
): Promise<void> {
  await updateFormResponseStatus(responseId, { handled });
}

/**
 * お客様相談期間の回答数を取得
 */
export async function getSoudanResponseCount(
  schoolId: string,
  periodKey: string
): Promise<number> {
  const responses = await getSoudanResponses(schoolId, periodKey);
  return responses.length;
}

/**
 * 未対応のお客様相談の回答数を取得（全期間）
 */
export async function getUnhandledSoudanCount(
  schoolId?: string
): Promise<number> {
  const targetSchoolId = schoolId || getDefaultSchoolId();
  
  // 全てのお客様相談期間を取得
  const periods = await getSoudanPeriods(targetSchoolId, false);
  
  // 各期間の未対応回答数を集計
  let totalUnhandled = 0;
  for (const period of periods) {
    const responses = await getSoudanResponses(targetSchoolId, period.period_key, {
      handledStatus: 'not_handled',
      showArchived: false,
    });
    totalUnhandled += responses.length;
  }
  
  return totalUnhandled;
}
