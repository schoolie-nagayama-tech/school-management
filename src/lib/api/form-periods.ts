import { supabase } from '../supabase';
import type {
  FormPeriod,
  FormPeriodInsert,
  FormPeriodUpdate,
  FormType,
} from '@/types/database';
import { getDefaultSchoolId } from './schools';

// ============================================
// フォーム公開期間管理
// ============================================

/**
 * フォーム公開期間一覧を取得
 * @param orderByCreatedAt true のとき created_at 降順（期間管理ページ用）
 */
export async function getFormPeriods(
  schoolId?: string,
  formType?: FormType,
  includeArchived: boolean = false,
  orderByCreatedAt: boolean = false
): Promise<FormPeriod[]> {
  const targetSchoolId = schoolId || getDefaultSchoolId();

  let query = supabase
    .from('form_periods')
    .select('*')
    .eq('school_id', targetSchoolId);

  if (formType) {
    query = query.eq('form_type', formType);
  }

  if (!includeArchived) {
    query = query.or('is_archived.eq.false,is_archived.is.null');
  }

  query = query.order(
    orderByCreatedAt ? 'created_at' : 'period_key',
    { ascending: false }
  );

  const { data, error } = await query;

  if (error) {
    throw new Error(`フォーム公開期間一覧の取得に失敗しました: ${error.message}`);
  }

  return (data || []) as FormPeriod[];
}

/**
 * 公開中のフォーム公開期間を取得
 * 日付ベースで公開期間内の期間を取得（is_activeフラグは無視）
 */
export async function getActiveFormPeriod(
  schoolId: string,
  formType: FormType
): Promise<FormPeriod | null> {
  const now = new Date().toISOString();
  const nowDate = new Date(now);

  // 全ての期間を取得してから、日付ベースでフィルタリング（is_archived が false または null のものを対象）
  const { data, error } = await supabase
    .from('form_periods')
    .select('*')
    .eq('school_id', schoolId)
    .eq('form_type', formType)
    .or('is_archived.eq.false,is_archived.is.null')
    .order('period_key', { ascending: false });

  if (error) {
    console.error(`[getActiveFormPeriod] Error fetching periods:`, error);
    throw new Error(`フォーム公開期間の取得に失敗しました: ${error.message}`);
  }

  if (!data || data.length === 0) {
    console.log(`[getActiveFormPeriod] No periods found for schoolId: ${schoolId}, formType: ${formType}`);
    return null;
  }

  console.log(`[getActiveFormPeriod] Found ${data.length} periods for schoolId: ${schoolId}, formType: ${formType}`);
  console.log(`[getActiveFormPeriod] Current time: ${nowDate.toISOString()}`);

  // JavaScript側で公開期間をフィルタリング（日付ベース）
  const typedData = data as FormPeriod[];
  const activePeriods = typedData.filter((period) => {
    const start = period.publish_start ? new Date(period.publish_start) : null;
    const end = period.publish_end ? new Date(period.publish_end) : null;

    console.log(`[getActiveFormPeriod] Period ${period.period_key}: start=${start?.toISOString() ?? 'null'}, end=${end?.toISOString() ?? 'null'}`);

    // 公開開始日が設定されていて、現在時刻より後の場合は除外
    if (start && start > nowDate) {
      console.log(`[getActiveFormPeriod] Period ${period.period_key}: Not started yet`);
      return false;
    }
    // 公開開始日が未設定の場合は「制限なし」として扱い、終了日のみチェック
    // 公開終了日が設定されていて、現在時刻より前の場合は除外
    if (end && end < nowDate) {
      console.log(`[getActiveFormPeriod] Period ${period.period_key}: Already ended`);
      return false;
    }
    // 公開中（開始日未設定＝常時公開、または開始日以降 & 終了日未設定または終了日以内）
    console.log(`[getActiveFormPeriod] Period ${period.period_key}: ACTIVE${!start ? ' (開始日未設定)' : ''}${!end ? ' (永続公開)' : ''}`);
    return true;
  });

  if (activePeriods.length === 0) {
    console.log(`[getActiveFormPeriod] No active periods found`);
    return null;
  }

  console.log(`[getActiveFormPeriod] Returning active period: ${activePeriods[0].period_key}`);
  return activePeriods[0] as FormPeriod;
}

/**
 * 同一の school_id / form_type / period_key の期間を取得（存在しなければ null）
 */
export async function getFormPeriodByKey(
  schoolId: string,
  formType: FormType,
  periodKey: string
): Promise<FormPeriod | null> {
  const { data, error } = await supabase
    .from('form_periods')
    .select('*')
    .eq('school_id', schoolId)
    .eq('form_type', formType)
    .eq('period_key', periodKey)
    .maybeSingle();

  if (error) {
    throw new Error(`フォーム公開期間の取得に失敗しました: ${error.message}`);
  }
  return data as FormPeriod | null;
}

/**
 * フォーム公開期間を作成（同一の school_id / form_type / period_key が既にある場合は更新）
 */
export async function createFormPeriod(
  data: FormPeriodInsert
): Promise<FormPeriod> {
  const existing = await getFormPeriodByKey(
    data.school_id,
    data.form_type,
    data.period_key
  );

  if (existing) {
    const updateData: FormPeriodUpdate = {
      title: data.title,
      settings: data.settings as unknown as Record<string, unknown>,
      publish_start: data.publish_start,
      publish_end: data.publish_end,
      is_active: data.is_active ?? true,
      linked_application_item_id: data.linked_application_item_id ?? null,
    };
    return updateFormPeriod(existing.id, updateData);
  }

  const insertData = {
    ...data,
    settings: data.settings != null ? (data.settings as unknown as Record<string, unknown>) : undefined,
    is_active: data.is_active ?? false, // 新規作成時は非公開
  };
  const { data: created, error } = await supabase
    .from('form_periods')
    .insert(insertData)
    .select()
    .single();

  if (error) {
    throw new Error(`フォーム公開期間の作成に失敗しました: ${error.message}`);
  }

  return created as FormPeriod;
}

/**
 * フォーム公開期間を更新
 */
export async function updateFormPeriod(
  id: string,
  data: FormPeriodUpdate
): Promise<FormPeriod> {
  const { data: updated, error } = await supabase
    .from('form_periods')
    .update(data)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw new Error(`フォーム公開期間の更新に失敗しました: ${error.message}`);
  }

  return updated as FormPeriod;
}

/**
 * フォーム公開期間を1件取得
 */
export async function getFormPeriod(id: string): Promise<FormPeriod | null> {
  const { data, error } = await supabase
    .from('form_periods')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    throw new Error(`フォーム公開期間の取得に失敗しました: ${error.message}`);
  }

  return data as FormPeriod;
}

/**
 * フォーム公開期間を削除
 */
export async function deleteFormPeriod(id: string): Promise<void> {
  const { error } = await supabase.from('form_periods').delete().eq('id', id);

  if (error) {
    throw new Error(`フォーム公開期間の削除に失敗しました: ${error.message}`);
  }
}

/**
 * is_active が true の公開中期間を1件取得（同一 form_type で1つのみ想定）
 */
export async function getActivePeriodByFlag(
  schoolId: string,
  formType: FormType
): Promise<FormPeriod | null> {
  const { data, error } = await supabase
    .from('form_periods')
    .select('*')
    .eq('school_id', schoolId)
    .eq('form_type', formType)
    .eq('is_active', true)
    .or('is_archived.eq.false,is_archived.is.null')
    .maybeSingle();

  if (error) {
    throw new Error(`公開中期間の取得に失敗しました: ${error.message}`);
  }
  return data as FormPeriod | null;
}

/**
 * 期間を公開する（同一 form_type の他期間は自動で非公開に）
 */
export async function publishPeriod(
  periodId: string,
  schoolId: string,
  formType: FormType
): Promise<void> {
  const period = await getFormPeriod(periodId);
  if (!period || period.form_type !== formType || period.school_id !== schoolId) {
    throw new Error('指定した期間が見つかりません');
  }

  // 同一 form_type の他期間を非公開に
  const { error: updateOthersError } = await supabase
    .from('form_periods')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('school_id', schoolId)
    .eq('form_type', formType)
    .neq('id', periodId);

  if (updateOthersError) {
    throw new Error(`他期間の非公開処理に失敗しました: ${updateOthersError.message}`);
  }

  // 指定期間を公開に
  const { error: updateError } = await supabase
    .from('form_periods')
    .update({ is_active: true, updated_at: new Date().toISOString() })
    .eq('id', periodId);

  if (updateError) {
    throw new Error(`期間の公開に失敗しました: ${updateError.message}`);
  }
}

/**
 * 期間を非公開にする
 */
export async function unpublishPeriod(periodId: string): Promise<void> {
  const { error } = await supabase
    .from('form_periods')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', periodId);

  if (error) {
    throw new Error(`期間の非公開に失敗しました: ${error.message}`);
  }
}

/**
 * 指定期間の回答件数を取得
 */
export async function getResponseCountByPeriod(
  schoolId: string,
  formType: FormType,
  periodKey: string
): Promise<number> {
  const { count, error } = await supabase
    .from('form_responses')
    .select('*', { count: 'exact', head: true })
    .eq('school_id', schoolId)
    .eq('form_type', formType)
    .eq('form_period', periodKey);

  if (error) {
    throw new Error(`回答件数の取得に失敗しました: ${error.message}`);
  }
  return count ?? 0;
}

/**
 * 期間を削除（回答が1件以上ある場合はエラー。その場合はアーカイブを推奨）
 */
export async function deletePeriodWithCheck(
  periodId: string,
  periodKey: string,
  formType: FormType,
  schoolId: string
): Promise<void> {
  const count = await getResponseCountByPeriod(schoolId, formType, periodKey);
  if (count > 0) {
    throw new Error(
      'この期間には回答があるため削除できません。アーカイブしてください。'
    );
  }
  await deleteFormPeriod(periodId);
}

/**
 * 期間をアーカイブ（回答も含めて）
 */
export async function archivePeriod(
  id: string,
  schoolId: string,
  formType: FormType,
  periodKey: string
): Promise<{ periodArchived: boolean; responsesArchived: number }> {
  // 期間をアーカイブ
  const { error: periodError } = await supabase
    .from('form_periods')
    .update({
      is_archived: true,
      archived_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (periodError) {
    throw new Error(`期間のアーカイブに失敗しました: ${periodError.message}`);
  }

  // 期間内の回答もアーカイブ
  const { archiveResponsesByPeriod } = await import('./form-responses');
  const responsesArchived = await archiveResponsesByPeriod(
    schoolId,
    formType,
    periodKey
  );

  return { periodArchived: true, responsesArchived };
}

/**
 * 期間のアーカイブを解除
 */
export async function unarchivePeriod(
  id: string,
  schoolId: string,
  formType: FormType,
  periodKey: string
): Promise<{ periodUnarchived: boolean; responsesUnarchived: number }> {
  // 期間のアーカイブを解除
  const { error: periodError } = await supabase
    .from('form_periods')
    .update({
      is_archived: false,
      archived_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (periodError) {
    throw new Error(`期間のアーカイブ解除に失敗しました: ${periodError.message}`);
  }

  // 期間内の回答もアーカイブ解除
  const { unarchiveResponsesByPeriod } = await import('./form-responses');
  const responsesUnarchived = await unarchiveResponsesByPeriod(
    schoolId,
    formType,
    periodKey
  );

  return { periodUnarchived: true, responsesUnarchived };
}
