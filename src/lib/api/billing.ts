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
import { getFifthWeekDays, calcFifthWeekSlots } from '@/lib/utils/fifthWeek';

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
 * schoolId に配列を渡すと全ての教室に対して一括作成する
 */
export async function createBillingPeriod(
  period: { name: string; start_date: string; end_date: string },
  schoolId?: string | string[]
): Promise<BillingPeriod> {
  const targetSchoolIds = Array.isArray(schoolId)
    ? schoolId
    : [schoolId || getDefaultSchoolId()];

  const insertData: BillingPeriodInsert[] = targetSchoolIds.map((sid) => ({
    school_id: sid,
    name: period.name,
    start_date: period.start_date,
    end_date: period.end_date,
    is_active: true,
  }));

  const { data, error } = await supabase
    .from('billing_periods')
    .insert(insertData)
    .select();

  if (error) {
    throw new Error(`請求期間の作成に失敗しました: ${error.message}`);
  }

  return (data as BillingPeriod[])[0];
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
 * schoolId に配列を渡すと全ての教室に対して一括作成する
 */
export async function createBillingItem(
  item: { billing_period_id: string; name: string; source_type?: string },
  schoolId?: string | string[]
): Promise<BillingItem> {
  const targetSchoolIds = Array.isArray(schoolId)
    ? schoolId
    : [schoolId || getDefaultSchoolId()];

  // 各教室ごとに最大 sort_order を取得してデータを作成
  const insertData: BillingItemInsert[] = [];
  for (const sid of targetSchoolIds) {
    const { data: existingItems } = await supabase
      .from('billing_items')
      .select('sort_order')
      .eq('billing_period_id', item.billing_period_id)
      .eq('school_id', sid)
      .order('sort_order', { ascending: false })
      .limit(1);

    const maxSortOrder = existingItems && existingItems.length > 0
      ? existingItems[0].sort_order
      : -1;

    insertData.push({
      school_id: sid,
      billing_period_id: item.billing_period_id,
      name: item.name,
      source_type: (item.source_type as BillingItem['source_type']) || 'free',
      sort_order: maxSortOrder + 1,
      is_active: true,
    });
  }

  const { data, error } = await supabase
    .from('billing_items')
    .insert(insertData)
    .select();

  if (error) {
    throw new Error(`請求項目の作成に失敗しました: ${error.message}`);
  }

  return (data as BillingItem[])[0];
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

// ============================================
// 5週目自動計算 (Fifth Week Auto-Fill)
// ============================================

/**
 * 5週目の請求を自動計算・一括設定
 *
 * 1. 期間の月から5回ある曜日を特定
 * 2. 通塾日程(regular_patterns)からその曜日のコマ数を生徒ごとに計算
 * 3. student_billings にコマ数をupsert
 */
export async function autoFillFifthWeekBilling(
  billingItemId: string,
  periodStartDate: string,  // 'YYYY-MM-DD' format
  schoolIds: string | string[]
): Promise<{ updated: number; skipped: number }> {
  const targetSchoolIds = Array.isArray(schoolIds) ? schoolIds : [schoolIds];

  // 1. Parse year/month from period start date
  const [yearStr, monthStr] = periodStartDate.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);

  // 2. Get 5th week days
  const fifthWeekDows = getFifthWeekDays(year, month);
  if (fifthWeekDows.length === 0) {
    return { updated: 0, skipped: 0 };
  }

  // 3. Fetch regular patterns for all schools
  const { data: patterns, error: patternError } = await supabase
    .from('schedule_regular_patterns')
    .select('student_id, day_of_week, is_active')
    .in('school_id', targetSchoolIds)
    .eq('is_active', true)
    .eq('period_type', 'regular');

  if (patternError) throw new Error(`通塾日程の取得に失敗: ${patternError.message}`);
  if (!patterns || patterns.length === 0) return { updated: 0, skipped: 0 };

  // 4. Calculate slots per student
  const slotMap = calcFifthWeekSlots(patterns, fifthWeekDows);

  // 5. Upsert billing records
  let updated = 0;
  let skipped = 0;

  const entries = Array.from(slotMap.entries());
  for (let i = 0; i < entries.length; i++) {
    const studentId = entries[i][0];
    const quantity = entries[i][1];

    if (quantity <= 0) {
      skipped++;
      continue;
    }

    // Check if record exists
    const { data: existing } = await supabase
      .from('student_billings')
      .select('id')
      .eq('student_id', studentId)
      .eq('billing_item_id', billingItemId)
      .maybeSingle();

    if (existing) {
      await supabase
        .from('student_billings')
        .update({ is_billed: true, quantity })
        .eq('id', existing.id);
    } else {
      // Need school_id for insert - get from student record
      const { data: studentData } = await supabase
        .from('students')
        .select('school_id')
        .eq('id', studentId)
        .single();

      if (studentData) {
        await supabase
          .from('student_billings')
          .insert({
            school_id: studentData.school_id,
            student_id: studentId,
            billing_item_id: billingItemId,
            is_billed: true,
            quantity,
          });
      }
    }
    updated++;
  }

  return { updated, skipped };
}

// ============================================
// 申込状況・発注管理からの自動同期
// ============================================

/**
 * 申込状況（application_items / student_applications）から請求データを自動同期
 *
 * 指定された請求項目（source_type='form_charged'）に対して、
 * 申込状況で対応する項目が「申込済み（✓）」になっている生徒を
 * 請求に自動反映する。
 *
 * マッピング:
 * - 「増コマ」→ application_items で name に「増コマ」を含む項目
 * - 「模擬」→ application_items で name に「模擬」を含む項目
 * - 「模試」→ application_items で name に「模試」を含む項目
 */
export async function syncApplicationToBilling(
  billingItemId: string,
  billingItemName: string,
  schoolIds: string | string[]
): Promise<{ synced: number; total: number }> {
  const targetSchoolIds = Array.isArray(schoolIds) ? schoolIds : [schoolIds];

  // 1. Find matching application_items by name keyword
  const { data: appItems, error: appItemError } = await supabase
    .from('application_items')
    .select('id, name')
    .in('school_id', targetSchoolIds)
    .ilike('name', `%${billingItemName}%`);

  if (appItemError) throw new Error(`申込項目の取得に失敗: ${appItemError.message}`);
  if (!appItems || appItems.length === 0) return { synced: 0, total: 0 };

  const appItemIds = appItems.map(item => item.id);

  // 2. Find student_applications where these items are checked (status_value = '✓' or is checked)
  // student_applications has: student_id, application_item_id, status_value, school_id
  const { data: applications, error: appError } = await supabase
    .from('student_applications')
    .select('student_id, application_item_id, status_value, school_id')
    .in('application_item_id', appItemIds)
    .in('school_id', targetSchoolIds);

  if (appError) throw new Error(`申込状況の取得に失敗: ${appError.message}`);
  if (!applications) return { synced: 0, total: 0 };

  // 3. Filter to only checked/completed applications
  // status_value is '✓' for check type items, or a truthy value
  const checkedApps = applications.filter(app =>
    app.status_value === '✓' || app.status_value === 'true' || app.status_value === '1'
  );

  // 4. Upsert billing records
  let synced = 0;
  for (const app of checkedApps) {
    const { data: existing } = await supabase
      .from('student_billings')
      .select('id')
      .eq('student_id', app.student_id)
      .eq('billing_item_id', billingItemId)
      .maybeSingle();

    if (existing) {
      await supabase
        .from('student_billings')
        .update({ is_billed: true })
        .eq('id', existing.id);
    } else {
      await supabase
        .from('student_billings')
        .insert({
          school_id: app.school_id,
          student_id: app.student_id,
          billing_item_id: billingItemId,
          is_billed: true,
          quantity: null,
        });
    }
    synced++;
  }

  return { synced, total: checkedApps.length };
}

/**
 * 発注管理（material_orders）から請求データを自動同期
 *
 * 発注済み（pending以外）の教材発注を請求に反映。
 * 生徒ごとに発注数をquantityとして設定。
 */
export async function syncOrdersToBilling(
  billingItemId: string,
  schoolIds: string | string[],
  periodStartDate: string,
  periodEndDate: string
): Promise<{ synced: number }> {
  const targetSchoolIds = Array.isArray(schoolIds) ? schoolIds : [schoolIds];

  // Get orders within the billing period date range (excluding cancelled)
  const { data: orders, error: orderError } = await supabase
    .from('material_orders')
    .select('student_id, school_id, quantity, status, material_id, materials(name)')
    .in('school_id', targetSchoolIds)
    .neq('status', 'cancelled')
    .gte('created_at', periodStartDate)
    .lte('created_at', periodEndDate + 'T23:59:59');

  if (orderError) throw new Error(`発注データの取得に失敗: ${orderError.message}`);
  if (!orders || orders.length === 0) return { synced: 0 };

  // Group by student_id, sum quantities
  const studentQuantities = new Map<string, { quantity: number; school_id: string }>();
  for (const order of orders) {
    if (!order.student_id) continue;
    const existing = studentQuantities.get(order.student_id);
    if (existing) {
      existing.quantity += order.quantity || 1;
    } else {
      studentQuantities.set(order.student_id, {
        quantity: order.quantity || 1,
        school_id: order.school_id,
      });
    }
  }

  // Upsert billing records
  let synced = 0;
  for (const [studentId, data] of studentQuantities) {
    const { data: existing } = await supabase
      .from('student_billings')
      .select('id')
      .eq('student_id', studentId)
      .eq('billing_item_id', billingItemId)
      .maybeSingle();

    if (existing) {
      await supabase
        .from('student_billings')
        .update({ is_billed: true, quantity: data.quantity })
        .eq('id', existing.id);
    } else {
      await supabase
        .from('student_billings')
        .insert({
          school_id: data.school_id,
          student_id: studentId,
          billing_item_id: billingItemId,
          is_billed: true,
          quantity: data.quantity,
        });
    }
    synced++;
  }

  return { synced };
}
