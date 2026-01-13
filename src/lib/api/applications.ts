import { supabase } from '../supabase';
import type {
  ApplicationItem,
  ApplicationItemInsert,
  ApplicationItemUpdate,
  StudentApplication,
  StudentApplicationInsert,
  ApplicationStatus,
} from '@/types/database';
import { getDefaultSchoolId } from './schools';

/**
 * 申込項目一覧を取得
 */
export async function getApplicationItems(
  schoolId?: string,
  includeHidden: boolean = false
): Promise<ApplicationItem[]> {
  const targetSchoolId = schoolId || getDefaultSchoolId();
  
  let query = supabase
    .from('application_items')
    .select('*')
    .eq('school_id', targetSchoolId)
    .order('sort_order', { ascending: true });

  if (!includeHidden) {
    // is_hiddenがfalseまたはnullのものを取得
    query = query.or('is_hidden.eq.false,is_hidden.is.null');
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`申込項目の取得に失敗しました: ${error.message}`);
  }

  return (data || []) as ApplicationItem[];
}

/**
 * 申込項目を作成
 */
export async function createApplicationItem(
  item: Omit<ApplicationItemInsert, 'school_id' | 'sort_order'>
): Promise<ApplicationItem> {
  const schoolId = getDefaultSchoolId();

  // 最大のsort_orderを取得
  const { data: existingItems } = await supabase
    .from('application_items')
    .select('sort_order')
    .eq('school_id', schoolId)
    .order('sort_order', { ascending: false })
    .limit(1);

  const maxSortOrder = existingItems && existingItems.length > 0 
    ? existingItems[0].sort_order 
    : -1;

  const { data, error } = await supabase
    .from('application_items')
    .insert({
      ...item,
      school_id: schoolId,
      sort_order: maxSortOrder + 1,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`申込項目の作成に失敗しました: ${error.message}`);
  }

  return data;
}

/**
 * 申込項目を更新
 */
export async function updateApplicationItem(
  id: string,
  updates: ApplicationItemUpdate
): Promise<ApplicationItem> {
  const { data, error } = await supabase
    .from('application_items')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw new Error(`申込項目の更新に失敗しました: ${error.message}`);
  }

  return data;
}

/**
 * 申込項目を非表示にする
 */
export async function hideApplicationItem(id: string): Promise<void> {
  const { error } = await supabase
    .from('application_items')
    .update({
      is_hidden: true,
      ended_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) {
    throw new Error(`申込項目の非表示に失敗しました: ${error.message}`);
  }
}

/**
 * 申込項目を再表示する
 */
export async function unhideApplicationItem(id: string): Promise<void> {
  const { error } = await supabase
    .from('application_items')
    .update({
      is_hidden: false,
      ended_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) {
    throw new Error(`申込項目の再表示に失敗しました: ${error.message}`);
  }
}

/**
 * 申込項目を削除
 */
export async function deleteApplicationItem(id: string): Promise<void> {
  const { error } = await supabase
    .from('application_items')
    .delete()
    .eq('id', id);

  if (error) {
    throw new Error(`申込項目の削除に失敗しました: ${error.message}`);
  }
}

/**
 * 申込項目の並び順を更新
 */
export async function updateApplicationItemSortOrder(
  items: { id: string; sort_order: number }[]
): Promise<void> {
  const schoolId = getDefaultSchoolId();

  // トランザクション的に更新（Supabaseでは個別に更新）
  const updates = items.map((item) =>
    supabase
      .from('application_items')
      .update({ sort_order: item.sort_order })
      .eq('id', item.id)
      .eq('school_id', schoolId)
  );

  const results = await Promise.all(updates);
  const errors = results.filter((r) => r.error);

  if (errors.length > 0) {
    throw new Error(`並び順の更新に失敗しました: ${errors[0].error?.message}`);
  }
}

/**
 * 全生徒の申込状況を取得
 */
export async function getStudentApplications(schoolId?: string): Promise<StudentApplication[]> {
  const targetSchoolId = schoolId || getDefaultSchoolId();

  const { data, error } = await supabase
    .from('student_applications')
    .select('*')
    .eq('school_id', targetSchoolId);

  if (error) {
    throw new Error(`申込状況の取得に失敗しました: ${error.message}`);
  }

  return data || [];
}

/**
 * 生徒の申込状況を更新（または作成）
 */
export async function updateStudentApplication(
  studentId: string,
  itemId: string,
  status: ApplicationStatus | null
): Promise<StudentApplication | null> {
  const schoolId = getDefaultSchoolId();

  if (status === null) {
    // 削除（未登録状態に戻す）
    const { error } = await supabase
      .from('student_applications')
      .delete()
      .eq('student_id', studentId)
      .eq('item_id', itemId);

    if (error) {
      throw new Error(`申込状況の削除に失敗しました: ${error.message}`);
    }

    return null;
  }

  // 既存レコードを確認
  const { data: existing } = await supabase
    .from('student_applications')
    .select('id')
    .eq('student_id', studentId)
    .eq('item_id', itemId)
    .single();

  if (existing) {
    // 更新
    const { data, error } = await supabase
      .from('student_applications')
      .update({ status })
      .eq('id', existing.id)
      .select()
      .single();

    if (error) {
      throw new Error(`申込状況の更新に失敗しました: ${error.message}`);
    }

    return data;
  } else {
    // 作成
    const { data, error } = await supabase
      .from('student_applications')
      .insert({
        school_id: schoolId,
        student_id: studentId,
        item_id: itemId,
        status,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`申込状況の作成に失敗しました: ${error.message}`);
    }

    return data;
  }
}
