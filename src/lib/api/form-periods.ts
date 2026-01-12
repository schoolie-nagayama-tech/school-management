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
  formType?: FormType
): Promise<FormPeriod[]> {
  const targetSchoolId = schoolId || getDefaultSchoolId();

  let query = supabase
    .from('form_periods')
    .select('*')
    .eq('school_id', targetSchoolId);

  if (formType) {
    query = query.eq('form_type', formType);
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

  // 全ての期間を取得してから、日付ベースでフィルタリング
  const { data, error } = await supabase
    .from('form_periods')
    .select('*')
    .eq('school_id', schoolId)
    .eq('form_type', formType)
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

    console.log(`[getActiveFormPeriod] Period ${period.period_key}: start=${start?.toISOString()}, end=${end?.toISOString()}`);

    // 公開開始日が設定されていて、現在時刻より後の場合は除外
    if (start && start > nowDate) {
      console.log(`[getActiveFormPeriod] Period ${period.period_key}: Not started yet`);
      return false;
    }
    // 公開終了日が設定されていて、現在時刻より前の場合は除外
    if (end && end < nowDate) {
      console.log(`[getActiveFormPeriod] Period ${period.period_key}: Already ended`);
      return false;
    }
    // 公開開始日・終了日が未設定の場合は除外（公開期間が設定されていない）
    if (!start || !end) {
      console.log(`[getActiveFormPeriod] Period ${period.period_key}: No publish dates set`);
      return false;
    }
    // 公開期間内
    console.log(`[getActiveFormPeriod] Period ${period.period_key}: ACTIVE`);
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
 * フォーム公開期間を作成
 */
export async function createFormPeriod(
  data: FormPeriodInsert
): Promise<FormPeriod> {
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
