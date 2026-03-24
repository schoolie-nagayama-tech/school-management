import { supabase } from '../supabase';
import type {
  BillingPeriod,
  BillingPeriodInsert,
  BillingPeriodUpdate,
  BillingItem,
  BillingItemInsert,
  BillingItemUpdate,
  StudentBilling,
} from '@/types/database';
import { getDefaultSchoolId } from './schools';

// ============================================
// 請求期間 (Billing Periods)
// ============================================

/**
 * 請求期間一覧を取得
 */
export async function getBillingPeriods(
  schoolIds?: string | string[]
): Promise<BillingPeriod[]> {
  const targetSchoolIds = Array.isArray(schoolIds)
    ? schoolIds
    : schoolIds
    ? [schoolIds]
    : [getDefaultSchoolId()];

  const { data, error } = await supabase
    .from('billing_periods')
    .select('*')
    .in('school_id', targetSchoolIds)
    .order('start_date', { ascending: false });

  if (error) {
    if (error.code === 'PGRST116' || error.code === '42501' || error.message.includes('schema cache')) {
      console.warn('billing_periodsテーブルの取得に失敗しました（無視します）:', error);
      return [];
    }
    throw new Error(`請求期間の取得に失敗しました: ${error.message}`);
  }

  return (data || []) as BillingPeriod[];
}

/**
 * 請求期間を作成
 */
export async function createBillingPeriod(
  period: { name: string; start_date: string; end_date: string },
  schoolId?: string
): Promise<BillingPeriod> {
  const targetSchoolId = schoolId || getDefaultSchoolId();

  const insertData: BillingPeriodInsert = {
    school_id: targetSchoolId,
    name: period.name,
    start_date: period.start_date,
    end_date: period.end_date,
    is_active: true,
  };

  const { data, error } = await supabase
    .from('billing_periods')
    .insert(insertData)
    .select()
    .single();

  if (error) {
    throw new Error(`請求期間の作成に失敗しました: ${error.message}`);
  }

  return data as BillingPeriod;
}

/**
 * 請求期間を更新
 */
export async function updateBillingPeriod(
  id: string,
  updates: Partial<BillingPeriodUpdate>
): Promise<BillingPeriod> {
  const { data, error } = await supabase
    .from('billing_periods')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw new Error(`請求期間の更新に失敗しました: ${error.message}`);
  }

  return data as BillingPeriod;
}

/**
 * 請求期間を削除
 */
export async function deleteBillingPeriod(id: string): Promise<void> {
  const { error } = await supabase
    .from('billing_periods')
    .delete()
    .eq('id', id);

  if (error) {
    throw new Error(`請求期間の削除に失敗しました: ${error.message}`);
  }
}

// ============================================
// 請求項目 (Billing Items)
// ============================================

/**
 * 請求項目一覧を取得
 */
export async function getBillingItems(
  periodId: string,
  schoolIds?: string | string[]
): Promise<BillingItem[]> {
  const targetSchoolIds = Array.isArray(schoolIds)
    ? schoolIds
    : schoolIds
    ? [schoolIds]
    : [getDefaultSchoolId()];

  const { data, error } = await supabase
    .from('billing_items')
    .select('*')
    .eq('billing_period_id', periodId)
    .in('school_id', targetSchoolIds)
    .order('sort_order', { ascending: true });

  if (error) {
    if (error.code === 'PGRST116' || error.code === '42501' || error.message.includes('schema cache')) {
      console.warn('billing_itemsテーブルの取得に失敗しました（無視します）:', error);
      return [];
    }
    throw new Error(`請求項目の取得に失敗しました: ${error.message}`);
  }

  return (data || []) as BillingItem[];
}

/**
 * 請求項目を作成
 */
export async function createBillingItem(
  item: { billing_period_id: string; name: string; source_type?: string },
  schoolId?: string
): Promise<BillingItem> {
  const targetSchoolId = schoolId || getDefaultSchoolId();

  // 最大のsort_orderを取得
  const { data: existingItems } = await supabase
    .from('billing_items')
    .select('sort_order')
    .eq('billing_period_id', item.billing_period_id)
    .eq('school_id', targetSchoolId)
    .order('sort_order', { ascending: false })
    .limit(1);

  const maxSortOrder = existingItems && existingItems.length > 0
    ? existingItems[0].sort_order
    : -1;

  const insertData: BillingItemInsert = {
    school_id: targetSchoolId,
    billing_period_id: item.billing_period_id,
    name: item.name,
    source_type: (item.source_type as BillingItem['source_type']) || 'free',
    sort_order: maxSortOrder + 1,
    is_active: true,
  };

  const { data, error } = await supabase
    .from('billing_items')
    .insert(insertData)
    .select()
    .single();

  if (error) {
    throw new Error(`請求項目の作成に失敗しました: ${error.message}`);
  }

  return data as BillingItem;
}

/**
 * 請求項目を更新
 */
export async function updateBillingItem(
  id: string,
  updates: Partial<BillingItemUpdate>
): Promise<BillingItem> {
  const { data, error } = await supabase
    .from('billing_items')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw new Error(`請求項目の更新に失敗しました: ${error.message}`);
  }

  return data as BillingItem;
}

/**
 * 請求項目を削除
 */
export async function deleteBillingItem(id: string): Promise<void> {
  const { error } = await supabase
    .from('billing_items')
    .delete()
    .eq('id', id);

  if (error) {
    throw new Error(`請求項目の削除に失敗しました: ${error.message}`);
  }
}

/**
 * 請求項目の並び順を更新
 */
export async function updateBillingItemSortOrder(
  items: { id: string; sort_order: number }[]
): Promise<void> {
  const updates = items.map((item) =>
    supabase
      .from('billing_items')
      .update({ sort_order: item.sort_order })
      .eq('id', item.id)
  );

  const results = await Promise.all(updates);
  const errors = results.filter((r) => r.error);

  if (errors.length > 0) {
    throw new Error(`並び順の更新に失敗しました: ${errors[0].error?.message}`);
  }
}

// ============================================
// 生徒請求 (Student Billings)
// ============================================

/**
 * 生徒の請求状況を取得
 */
export async function getStudentBillings(
  periodId: string,
  schoolIds?: string | string[]
): Promise<StudentBilling[]> {
  const targetSchoolIds = Array.isArray(schoolIds)
    ? schoolIds
    : schoolIds
    ? [schoolIds]
    : [getDefaultSchoolId()];

  // まず対象期間の請求項目IDを取得
  const { data: billingItems, error: itemsError } = await supabase
    .from('billing_items')
    .select('id')
    .eq('billing_period_id', periodId)
    .in('school_id', targetSchoolIds);

  if (itemsError) {
    if (itemsError.code === 'PGRST116' || itemsError.code === '42501' || itemsError.message.includes('schema cache')) {
      console.warn('billing_itemsテーブルの取得に失敗しました（無視します）:', itemsError);
      return [];
    }
    throw new Error(`請求項目の取得に失敗しました: ${itemsError.message}`);
  }

  if (!billingItems || billingItems.length === 0) {
    return [];
  }

  const itemIds = billingItems.map((i) => i.id);

  const { data, error } = await supabase
    .from('student_billings')
    .select('*')
    .in('billing_item_id', itemIds)
    .in('school_id', targetSchoolIds);

  if (error) {
    if (error.code === 'PGRST116' || error.code === '42501' || error.message.includes('schema cache')) {
      console.warn('student_billingsテーブルの取得に失敗しました（無視します）:', error);
      return [];
    }
    throw new Error(`請求状況の取得に失敗しました: ${error.message}`);
  }

  return (data || []) as StudentBilling[];
}

/**
 * 生徒の請求状況をトグル（upsert）
 */
export async function toggleStudentBilling(
  studentId: string,
  billingItemId: string,
  isBilled: boolean,
  schoolId?: string
): Promise<StudentBilling> {
  // 生徒IDからschool_idを取得（schoolIdが指定されていない場合）
  let targetSchoolId = schoolId;
  if (!targetSchoolId) {
    const { data: student, error: studentError } = await supabase
      .from('students')
      .select('school_id')
      .eq('id', studentId)
      .single();

    if (studentError || !student) {
      throw new Error(`生徒情報の取得に失敗しました: ${studentError?.message || '生徒が見つかりません'}`);
    }
    targetSchoolId = student.school_id;
  }

  // 既存レコードを確認
  const { data: existing, error: existingError } = await supabase
    .from('student_billings')
    .select('id')
    .eq('student_id', studentId)
    .eq('billing_item_id', billingItemId)
    .eq('school_id', targetSchoolId)
    .maybeSingle();

  if (existingError && existingError.code !== 'PGRST116' && existingError.code !== '42501' && existingError.code !== 'PGRST202') {
    console.warn('既存レコードの確認に失敗しました（新規作成として処理します）:', existingError);
  }

  if (existing) {
    // 更新
    const { data, error } = await supabase
      .from('student_billings')
      .update({ is_billed: isBilled, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
      .select()
      .single();

    if (error) {
      throw new Error(`請求状況の更新に失敗しました: ${error.message}`);
    }

    return data as StudentBilling;
  } else {
    // 作成
    const { data, error } = await supabase
      .from('student_billings')
      .insert({
        school_id: targetSchoolId,
        student_id: studentId,
        billing_item_id: billingItemId,
        is_billed: isBilled,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`請求状況の作成に失敗しました: ${error.message}`);
    }

    return data as StudentBilling;
  }
}
