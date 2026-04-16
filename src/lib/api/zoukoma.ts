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
  getFormResponses,
  createPublicFormResponse,
  updateFormResponseStatus,
} from './form-responses';
import { syncFormResponseToBilling } from './billing';
import { getDefaultSchoolId, getSchoolByCode } from './schools';
import type {
  FormPeriodInsert,
  FormPeriodUpdate,
  FormResponseInsert,
} from '@/types/database';
import type {
  ZoukomaPeriod,
  ZoukomaSettings,
  ZoukomaResponseData,
  ZoukomaResponse,
  ZoukomaStats,
  ZoukomaResponseFilters,
} from '@/types/forms/zoukoma';

// ============================================
// 増コマ申込フォーム API
// ============================================

/**
 * 増コマ申込期間一覧を取得
 */
export async function getZoukomaPeriods(
  schoolId?: string,
  includeArchived: boolean = false
): Promise<ZoukomaPeriod[]> {
  const periods = await getFormPeriods(schoolId, 'zoukoma', includeArchived);
  return periods.map((period) => ({
    ...period,
    settings: (period.settings as unknown as ZoukomaSettings) || {},
  })) as ZoukomaPeriod[];
}

/**
 * 増コマ申込期間をアーカイブ
 */
export async function archiveZoukomaPeriod(
  id: string,
  schoolId: string,
  periodKey: string
): Promise<{ periodArchived: boolean; responsesArchived: number }> {
  return archivePeriod(id, schoolId, 'zoukoma', periodKey);
}

/**
 * 増コマ申込期間のアーカイブを解除
 */
export async function unarchiveZoukomaPeriod(
  id: string,
  schoolId: string,
  periodKey: string
): Promise<{ periodUnarchived: boolean; responsesUnarchived: number }> {
  return unarchivePeriod(id, schoolId, 'zoukoma', periodKey);
}

/**
 * 公開中の増コマ申込期間を取得（ポータル用）
 */
export async function getActiveZoukomaPeriod(
  schoolCode: string
): Promise<ZoukomaPeriod | null> {
  const school = await getSchoolByCode(schoolCode);
  if (!school) {
    return null;
  }

  const period = await getActiveFormPeriod(school.id, 'zoukoma');
  if (!period) {
    return null;
  }

  return {
    ...period,
    settings: (period.settings as unknown as ZoukomaSettings) || {},
  } as ZoukomaPeriod;
}

/**
 * 増コマ申込期間を1件取得
 */
export async function getZoukomaPeriod(
  id: string
): Promise<ZoukomaPeriod | null> {
  const period = await getFormPeriod(id);
  if (!period || period.form_type !== 'zoukoma') {
    return null;
  }

  return {
    ...period,
    settings: (period.settings as unknown as ZoukomaSettings) || {},
  } as ZoukomaPeriod;
}

/**
 * 増コマ申込期間を period_key で取得（プレビュー用）
 */
export async function getZoukomaPeriodByKey(
  schoolId: string,
  periodKey: string
): Promise<ZoukomaPeriod | null> {
  const period = await getFormPeriodByKey(schoolId, 'zoukoma', periodKey);
  if (!period) return null;

  return {
    ...period,
    settings: (period.settings as unknown as ZoukomaSettings) || {},
  } as ZoukomaPeriod;
}

/**
 * 増コマ申込期間を作成
 * @param data 期間データ（school_id / form_type 除く）
 * @param schoolId 教室ID（省略時は getDefaultSchoolId()）
 */
export async function createZoukomaPeriod(
  data: Omit<FormPeriodInsert, 'school_id' | 'form_type'>,
  schoolId?: string
): Promise<ZoukomaPeriod> {
  let targetSchoolId: string;
  try {
    targetSchoolId = schoolId ?? getDefaultSchoolId();
  } catch (error) {
    console.error('Error getting default school ID:', error);
    throw new Error(
      '教室IDの取得に失敗しました。環境変数NEXT_PUBLIC_DEFAULT_SCHOOL_IDが設定されているか確認してください。'
    );
  }

  if (!targetSchoolId || targetSchoolId.trim() === '') {
    throw new Error(
      'school_idが空です。環境変数NEXT_PUBLIC_DEFAULT_SCHOOL_IDが正しく設定されているか確認してください。'
    );
  }

  const periodData: FormPeriodInsert = {
    ...data,
    school_id: targetSchoolId,
    form_type: 'zoukoma',
    settings: (data.settings != null ? data.settings : {}) as unknown as Record<string, unknown>,
  };

  const period = await createFormPeriod(periodData);
  return {
    ...period,
    settings: (period.settings as unknown as ZoukomaSettings) || {},
  } as ZoukomaPeriod;
}

/**
 * 増コマ申込期間を更新
 */
export async function updateZoukomaPeriod(
  id: string,
  data: Omit<FormPeriodUpdate, 'form_type'> & {
    settings?: ZoukomaSettings;
  }
): Promise<ZoukomaPeriod> {
  const updateData: FormPeriodUpdate = {
    ...data,
    settings: data.settings != null ? (data.settings as unknown as Record<string, unknown>) : undefined,
  };

  const period = await updateFormPeriod(id, updateData);
  return {
    ...period,
    settings: (period.settings as unknown as ZoukomaSettings) || {},
  } as ZoukomaPeriod;
}

/**
 * 前回の期間設定をコピーして新規作成
 */
export async function copyZoukomaPeriod(
  sourceId: string
): Promise<ZoukomaPeriod> {
  const sourcePeriod = await getZoukomaPeriod(sourceId);
  if (!sourcePeriod) {
    throw new Error('コピー元の期間が見つかりません');
  }

  // 新しい期間キーを生成（YYYY-MM形式）
  const now = new Date();
  const newPeriodKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const newPeriodData = {
    period_key: newPeriodKey,
    title: '',
    settings: sourcePeriod.settings as unknown as Record<string, unknown>,
    publish_start: null,
    publish_end: null,
    is_active: false,
    linked_application_item_id: sourcePeriod.linked_application_item_id,
  };

  return await createZoukomaPeriod(newPeriodData);
}

/**
 * 増コマ申込回答を送信
 */
export async function submitZoukomaResponse(data: {
  school_id: string;
  form_period: string;
  student_name: string;
  grade: number;
  email: string;
  response_data: ZoukomaResponseData;
}): Promise<ZoukomaResponse> {
  const responseData: FormResponseInsert = {
    school_id: data.school_id,
    form_type: 'zoukoma',
    form_period: data.form_period,
    student_name: data.student_name,
    grade: data.grade,
    email: data.email,
    response_data: data.response_data as unknown as Record<string, unknown>,
    status_checks: {
      charged: false,
      seated: false,
    },
  };

  const response = await createPublicFormResponse(responseData);
  return {
    ...response,
    response_data: response.response_data as unknown as ZoukomaResponseData,
  } as ZoukomaResponse;
}

/**
 * 増コマ申込回答一覧を取得
 */
export async function getZoukomaResponses(
  schoolId: string | string[],
  periodKey: string,
  filters?: ZoukomaResponseFilters
): Promise<ZoukomaResponse[]> {
  const formFilters = {
    formType: 'zoukoma' as const,
    formPeriod: periodKey,
    grade: filters?.grade,
    linkedStatus: filters?.linkedStatus,
  };

  const responses = await getFormResponses(schoolId, formFilters);

  // status_checksでフィルタリング
  let filtered = responses.map((r) => ({
    ...r,
    response_data: r.response_data as unknown as ZoukomaResponseData,
  }));

  if (filters?.chargedStatus === 'charged') {
    filtered = filtered.filter(
      (r) => r.status_checks && r.status_checks['charged'] === true
    );
  } else if (filters?.chargedStatus === 'not_charged') {
    filtered = filtered.filter(
      (r) => !r.status_checks || r.status_checks['charged'] !== true
    );
  }

  if (filters?.seatedStatus === 'seated') {
    filtered = filtered.filter(
      (r) => r.status_checks && r.status_checks['seated'] === true
    );
  } else if (filters?.seatedStatus === 'not_seated') {
    filtered = filtered.filter(
      (r) => !r.status_checks || r.status_checks['seated'] !== true
    );
  }

  return filtered as ZoukomaResponse[];
}

/**
 * 増コマ申込集計データを取得
 */
export async function getZoukomaStats(
  schoolId: string | string[],
  periodKey: string
): Promise<ZoukomaStats> {
  const responses = await getZoukomaResponses(schoolId, periodKey);

  const stats: ZoukomaStats = {
    total_responses: responses.length,
    total_koma: 0,
    total_fee: 0,
    charged_count: 0,
    seated_count: 0,
    linked_count: 0,
  };

  responses.forEach((response) => {
    stats.total_koma += response.response_data.total_koma || 0;
    stats.total_fee += response.response_data.total_fee || 0;

    if (response.status_checks?.charged === true) {
      stats.charged_count++;
    }
    if (response.status_checks?.seated === true) {
      stats.seated_count++;
    }
    if (response.linked_student_id) {
      stats.linked_count++;
    }
  });

  return stats;
}

/**
 * 増コマ申込回答のステータスチェックを更新
 */
export async function updateZoukomaResponseStatus(
  responseId: string,
  statusChecks: { charged?: boolean; seated?: boolean }
): Promise<ZoukomaResponse> {
  const response = await getFormResponses(undefined, {
    formType: 'zoukoma',
  }).then((responses) => responses.find((r) => r.id === responseId));

  if (!response) {
    throw new Error('回答が見つかりません');
  }

  const currentStatus = response.status_checks || {};
  const newStatus = {
    ...currentStatus,
    ...statusChecks,
  };

  const updated = await updateFormResponseStatus(responseId, newStatus);
  // charged が含まれる場合のみ請求側へ同期
  if (statusChecks.charged !== undefined) {
    try {
      await syncFormResponseToBilling(responseId);
    } catch (err) {
      console.warn('請求への計上同期に失敗:', err);
    }
  }
  return {
    ...updated,
    response_data: updated.response_data as unknown as ZoukomaResponseData,
  } as ZoukomaResponse;
}

/**
 * 増コマ申込期間を削除
 */
export async function deleteZoukomaPeriod(id: string): Promise<void> {
  await deleteFormPeriod(id);
}
