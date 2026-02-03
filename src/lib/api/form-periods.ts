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
 */
export async function getFormPeriods(
  schoolId?: string,
  formType?: FormType,
  includeArchived: boolean = false
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

  query = query.order('period_key', { ascending: false });

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
  const activePeriods = data.filter((period) => {
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
      settings: data.settings,
      publish_start: data.publish_start,
      publish_end: data.publish_end,
      is_active: data.is_active ?? true,
      linked_application_item_id: data.linked_application_item_id ?? null,
    };
    return updateFormPeriod(existing.id, updateData);
  }

  const { data: created, error } = await supabase
    .from('form_periods')
    .insert(data)
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
