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
  item: { billing_period_id: string; name: string; source_type?: string; value_type?: string; linked_form_type?: string | null },
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
      value_type: (item.value_type as BillingItem['value_type']) || 'check',
      linked_form_type: item.linked_form_type ?? null,
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

  let result: StudentBilling;
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

    result = data as StudentBilling;
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

    result = data as StudentBilling;
  }

  // フォーム回答の計上状態へ同期（失敗してもメイン処理は通す）
  try {
    await syncBillingToFormResponses(studentId, billingItemId, isBilled);
  } catch (syncErr) {
    console.warn('フォーム回答への計上同期に失敗:', syncErr);
  }

  return result;
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

  // 5週目がない月 → 全生徒に0を入力
  if (fifthWeekDows.length === 0) {
    const { data: students, error: studentsError } = await supabase
      .from('students')
      .select('id, school_id')
      .in('school_id', targetSchoolIds)
      .is('deleted_at', null);

    if (studentsError) throw new Error(`生徒の取得に失敗: ${studentsError.message}`);
    if (!students || students.length === 0) return { updated: 0, skipped: 0 };

    let updated = 0;
    for (const student of students) {
      const { data: existing } = await supabase
        .from('student_billings')
        .select('id')
        .eq('student_id', student.id)
        .eq('billing_item_id', billingItemId)
        .maybeSingle();

      if (existing) {
        await supabase
          .from('student_billings')
          .update({ value_number: 0, updated_at: new Date().toISOString() })
          .eq('id', existing.id);
      } else {
        await supabase
          .from('student_billings')
          .insert({
            school_id: student.school_id,
            student_id: student.id,
            billing_item_id: billingItemId,
            is_billed: false,
            value_number: 0,
          });
      }
      updated++;
    }
    return { updated, skipped: 0 };
  }

  // 3. 全生徒を取得
  const { data: allStudents, error: studentsError } = await supabase
    .from('students')
    .select('id, school_id')
    .in('school_id', targetSchoolIds)
    .is('deleted_at', null);

  if (studentsError) throw new Error(`生徒の取得に失敗: ${studentsError.message}`);
  if (!allStudents || allStudents.length === 0) return { updated: 0, skipped: 0 };

  // 4. Fetch regular patterns for all schools
  const { data: patterns, error: patternError } = await supabase
    .from('schedule_regular_patterns')
    .select('student_id, day_of_week, is_active')
    .in('school_id', targetSchoolIds)
    .eq('is_active', true)
    .eq('period_type', 'regular');

  if (patternError) throw new Error(`通塾日程の取得に失敗: ${patternError.message}`);

  // 5. Calculate slots per student
  const slotMap = calcFifthWeekSlots(patterns || [], fifthWeekDows);

  // 6. Upsert billing records (全生徒に対して)
  let updated = 0;
  const skipped = 0;

  for (const student of allStudents) {
    const quantity = slotMap.get(student.id) || 0;

    // Check if record exists
    const { data: existing } = await supabase
      .from('student_billings')
      .select('id')
      .eq('student_id', student.id)
      .eq('billing_item_id', billingItemId)
      .maybeSingle();

    if (existing) {
      await supabase
        .from('student_billings')
        .update({ value_number: quantity, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
    } else {
      await supabase
        .from('student_billings')
        .insert({
          school_id: student.school_id,
          student_id: student.id,
          billing_item_id: billingItemId,
          is_billed: false,
          value_number: quantity,
        });
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

  // 2. Find student_applications where these items are completed
  // student_applications has: student_id, item_id, status, school_id
  const { data: applications, error: appError } = await supabase
    .from('student_applications')
    .select('student_id, item_id, status, school_id')
    .in('item_id', appItemIds)
    .in('school_id', targetSchoolIds);

  if (appError) throw new Error(`申込状況の取得に失敗: ${appError.message}`);
  if (!applications) return { synced: 0, total: 0 };

  // 3. Filter to only completed applications
  const checkedApps = applications.filter(app =>
    app.status === 'completed'
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
 * 教材発注を請求に反映。
 * 生徒ごとに発注数をquantityとして設定し、教材名をvalue_textに設定。
 */
/**
 * フォーム回答を請求データに同期
 *
 * linked_form_type が設定されている請求項目に対して、
 * 対応するフォーム回答（生徒紐付け済み）の件数を value_number に反映する。
 */
export async function syncFormToBilling(
  billingPeriodId: string,
  schoolIds: string | string[]
): Promise<{ synced: number }> {
  const targetSchoolIds = Array.isArray(schoolIds) ? schoolIds : [schoolIds];

  // 1. Get billing items with linked_form_type for this period
  const { data: linkedItems, error: itemsError } = await supabase
    .from('billing_items')
    .select('id, linked_form_type, billing_period_id')
    .eq('billing_period_id', billingPeriodId)
    .in('school_id', targetSchoolIds)
    .not('linked_form_type', 'is', null);

  if (itemsError) throw new Error(`請求項目の取得に失敗: ${itemsError.message}`);
  if (!linkedItems || linkedItems.length === 0) return { synced: 0 };

  // 2. Get the billing period date range
  const { data: period, error: periodError } = await supabase
    .from('billing_periods')
    .select('start_date, end_date')
    .eq('id', billingPeriodId)
    .single();

  if (periodError || !period) throw new Error(`請求期間の取得に失敗: ${periodError?.message}`);

  // 請求期間の開始日〜終了日+1日（終了日の23:59:59までを含む）
  const periodStart = period.start_date; // e.g. "2026-03-01"
  const periodEndPlusOne = (() => {
    const d = new Date(period.end_date);
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0]; // e.g. "2026-04-01"
  })();

  let synced = 0;

  for (const item of linkedItems) {
    // 3a. 今期の日付範囲内の回答を取得
    const { data: currentResponses, error: respError } = await supabase
      .from('form_responses')
      .select('linked_student_id')
      .eq('form_type', item.linked_form_type!)
      .not('linked_student_id', 'is', null)
      .in('school_id', targetSchoolIds)
      .gte('created_at', `${periodStart}T00:00:00`)
      .lt('created_at', `${periodEndPlusOne}T00:00:00`);

    if (respError) {
      console.warn(`フォーム回答の取得に失敗 (${item.linked_form_type}):`, respError);
      continue;
    }

    // 3b. 前期以前で未計上の回答も取得（計上漏れ救済）
    //     created_at < 今期の開始日 の回答のうち、
    //     過去の請求期間で計上済み(is_billed=true)でないものを含める
    let carryOverResponses: Array<{ linked_student_id: string | null }> = [];
    try {
      // 前期以前の全回答を取得
      const { data: olderResponses } = await supabase
        .from('form_responses')
        .select('linked_student_id')
        .eq('form_type', item.linked_form_type!)
        .not('linked_student_id', 'is', null)
        .in('school_id', targetSchoolIds)
        .lt('created_at', `${periodStart}T00:00:00`);

      if (olderResponses && olderResponses.length > 0) {
        // 過去の請求期間の同じform_typeの項目で計上済みの生徒を取得
        const { data: pastPeriods } = await supabase
          .from('billing_periods')
          .select('id')
          .in('school_id', targetSchoolIds)
          .lt('end_date', periodStart); // 今期より前の期間

        if (pastPeriods && pastPeriods.length > 0) {
          const pastPeriodIds = pastPeriods.map(p => p.id);
          // 過去の期間で同じform_typeの請求項目を取得
          const { data: pastItems } = await supabase
            .from('billing_items')
            .select('id')
            .in('billing_period_id', pastPeriodIds)
            .eq('linked_form_type', item.linked_form_type!);

          if (pastItems && pastItems.length > 0) {
            const pastItemIds = pastItems.map(pi => pi.id);
            // 過去の期間で計上済みの生徒IDを取得
            const { data: chargedBillings } = await supabase
              .from('student_billings')
              .select('student_id')
              .in('billing_item_id', pastItemIds)
              .eq('is_billed', true);

            const chargedStudentIds = new Set(
              chargedBillings?.map(b => b.student_id) || []
            );

            // 計上済みでない生徒の回答だけキャリーオーバー
            carryOverResponses = olderResponses.filter(
              r => r.linked_student_id && !chargedStudentIds.has(r.linked_student_id)
            );
          } else {
            // 過去に請求項目がない = 全部キャリーオーバー
            carryOverResponses = olderResponses;
          }
        } else {
          // 過去の請求期間がない = 全部キャリーオーバー
          carryOverResponses = olderResponses;
        }
      }
    } catch (carryErr) {
      console.warn('キャリーオーバー取得に失敗（今期分のみで続行）:', carryErr);
    }

    // 3c. 今期 + キャリーオーバーを合算
    const allResponses = [...(currentResponses || []), ...carryOverResponses];
    if (allResponses.length === 0) continue;

    // 4. Group by student_id, count responses per student
    const studentCounts = new Map<string, number>();
    for (const resp of allResponses) {
      if (resp.linked_student_id) {
        const current = studentCounts.get(resp.linked_student_id) || 0;
        studentCounts.set(resp.linked_student_id, current + 1);
      }
    }

    // 5. Upsert into student_billings
    const studentCountEntries = Array.from(studentCounts.entries());
    for (const [studentId, count] of studentCountEntries) {
      const { data: existing } = await supabase
        .from('student_billings')
        .select('id')
        .eq('student_id', studentId)
        .eq('billing_item_id', item.id)
        .maybeSingle();

      if (existing) {
        await supabase
          .from('student_billings')
          .update({ value_number: count, updated_at: new Date().toISOString() })
          .eq('id', existing.id);
      } else {
        // Get school_id from student
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
              billing_item_id: item.id,
              is_billed: false,
              value_number: count,
            });
        }
      }
      synced++;
    }
  }

  return { synced };
}

// ============================================
// 計上ボタン双方向同期 (Charged ↔ Billed Sync)
// ============================================

/**
 * 請求の is_billed → フォーム回答の status_checks.charged へ同期
 *
 * 該当 billing_item に linked_form_type が設定されている場合、
 * その期間内・同じ生徒・同じ form_type のフォーム回答全件の
 * status_checks.charged を isBilled の値に揃える。
 *
 * linked_form_type が無い billing_item は何もしない（連動不要）。
 */
export async function syncBillingToFormResponses(
  studentId: string,
  billingItemId: string,
  isBilled: boolean
): Promise<void> {
  const { data: item, error: itemError } = await supabase
    .from('billing_items')
    .select('linked_form_type, billing_period_id, school_id')
    .eq('id', billingItemId)
    .maybeSingle();
  if (itemError || !item || !item.linked_form_type) return;

  const { data: period, error: periodError } = await supabase
    .from('billing_periods')
    .select('start_date, end_date')
    .eq('id', item.billing_period_id)
    .maybeSingle();
  if (periodError || !period) return;

  // end_date の 23:59:59 までを含むため +1 日
  const periodEndPlusOne = (() => {
    const d = new Date(period.end_date);
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  })();

  const { data: responses, error: respError } = await supabase
    .from('form_responses')
    .select('id, status_checks')
    .eq('linked_student_id', studentId)
    .eq('form_type', item.linked_form_type)
    .gte('created_at', `${period.start_date}T00:00:00`)
    .lt('created_at', `${periodEndPlusOne}T00:00:00`);

  if (respError || !responses || responses.length === 0) return;

  // 既に同じ値のものは更新しない（無駄なwrite & 再同期ループ防止）
  for (const r of responses) {
    const current = (r.status_checks || {}) as Record<string, boolean>;
    if (current.charged === isBilled) continue;
    await supabase
      .from('form_responses')
      .update({ status_checks: { ...current, charged: isBilled } })
      .eq('id', r.id);
  }
}

/**
 * フォーム回答の status_checks.charged → 請求の is_billed へ同期
 *
 * 該当 form_response の form_type と一致する linked_form_type を持つ
 * billing_item（同じ school、回答日を含む billing_period 内）を探し、
 * その生徒の同期間・同 form_type の全回答が charged=true なら is_billed=true、
 * 1件でも未計上なら is_billed=false に設定（AND判定）。
 *
 * 紐付け先生徒なし、または対応する billing_item が見つからない場合は何もしない。
 */
export async function syncFormResponseToBilling(responseId: string): Promise<void> {
  const { data: response, error: respError } = await supabase
    .from('form_responses')
    .select('id, form_type, linked_student_id, school_id, created_at')
    .eq('id', responseId)
    .maybeSingle();
  if (respError || !response || !response.linked_student_id) return;

  const createdDate = String(response.created_at).split('T')[0];

  // 回答日を含む billing_period を探す
  const { data: periods } = await supabase
    .from('billing_periods')
    .select('id, start_date, end_date')
    .eq('school_id', response.school_id)
    .lte('start_date', createdDate)
    .gte('end_date', createdDate)
    .limit(1);

  if (!periods || periods.length === 0) return;
  const period = periods[0];

  // form_type に紐付く billing_item を探す
  const { data: items } = await supabase
    .from('billing_items')
    .select('id')
    .eq('billing_period_id', period.id)
    .eq('school_id', response.school_id)
    .eq('linked_form_type', response.form_type)
    .limit(1);

  if (!items || items.length === 0) return;
  const itemId = items[0].id;

  const periodEndPlusOne = (() => {
    const d = new Date(period.end_date);
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  })();

  // 同じ生徒・同 form_type・同期間の全回答を取得
  const { data: siblings } = await supabase
    .from('form_responses')
    .select('id, status_checks')
    .eq('linked_student_id', response.linked_student_id)
    .eq('form_type', response.form_type)
    .gte('created_at', `${period.start_date}T00:00:00`)
    .lt('created_at', `${periodEndPlusOne}T00:00:00`);

  if (!siblings || siblings.length === 0) return;

  // AND判定: 全件 charged=true なら計上、1件でも未計上なら未計上
  const allCharged = siblings.every((r) => {
    const sc = (r.status_checks || {}) as Record<string, boolean>;
    return sc.charged === true;
  });

  // student_billings の is_billed を upsert
  const { data: existing } = await supabase
    .from('student_billings')
    .select('id, is_billed')
    .eq('student_id', response.linked_student_id)
    .eq('billing_item_id', itemId)
    .maybeSingle();

  if (existing) {
    if (existing.is_billed !== allCharged) {
      await supabase
        .from('student_billings')
        .update({ is_billed: allCharged, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
    }
  } else {
    await supabase
      .from('student_billings')
      .insert({
        school_id: response.school_id,
        student_id: response.linked_student_id,
        billing_item_id: itemId,
        is_billed: allCharged,
      });
  }
}

/**
 * 請求セルの値を更新（upsert）
 *
 * value_number / value_text / is_billed の部分更新に対応。
 */
export async function updateBillingValue(
  studentId: string,
  billingItemId: string,
  updates: { is_billed?: boolean; value_number?: number | null; value_text?: string | null },
  schoolId?: string
): Promise<StudentBilling> {
  // Resolve school_id if not provided
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

  // Check if record exists
  const { data: existing } = await supabase
    .from('student_billings')
    .select('id')
    .eq('student_id', studentId)
    .eq('billing_item_id', billingItemId)
    .maybeSingle();

  let result: StudentBilling;
  if (existing) {
    const { data, error } = await supabase
      .from('student_billings')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
      .select()
      .single();

    if (error) throw new Error(`請求値の更新に失敗しました: ${error.message}`);
    result = data as StudentBilling;
  } else {
    const { data, error } = await supabase
      .from('student_billings')
      .insert({
        school_id: targetSchoolId,
        student_id: studentId,
        billing_item_id: billingItemId,
        is_billed: updates.is_billed ?? false,
        value_number: updates.value_number ?? null,
        value_text: updates.value_text ?? null,
      })
      .select()
      .single();

    if (error) throw new Error(`請求値の作成に失敗しました: ${error.message}`);
    result = data as StudentBilling;
  }

  // is_billed が変更された場合のみフォーム回答へ同期
  if (updates.is_billed !== undefined) {
    try {
      await syncBillingToFormResponses(studentId, billingItemId, updates.is_billed);
    } catch (syncErr) {
      console.warn('フォーム回答への計上同期に失敗:', syncErr);
    }
  }

  return result;
}

/**
 * 5週目の請求を自動計算（新版 - value_number を使用）
 *
 * 1. 期間の月から5回ある曜日を特定
 * 2. 通塾日程(regular_patterns)からその曜日のコマ数を生徒ごとに計算
 * 3. student_billings に value_number = コマ数を upsert（is_billed は手動）
 */
export async function calcFifthWeekBilling(
  billingPeriodId: string,
  schoolIds: string | string[]
): Promise<{ updated: number; skipped: number }> {
  const targetSchoolIds = Array.isArray(schoolIds) ? schoolIds : [schoolIds];

  // 1. Get the billing period to determine year-month
  // 請求名から年月を取得し、+1ヶ月（翌月分の月謝として5週目を計算）
  const { data: period, error: periodError } = await supabase
    .from('billing_periods')
    .select('name, start_date')
    .eq('id', billingPeriodId)
    .single();

  if (periodError || !period) throw new Error(`請求期間の取得に失敗: ${periodError?.message}`);

  // 請求名から年月を抽出（例: "2026年3月請求" → 2026, 3）
  const nameMatch = period.name.match(/(\d{4})年(\d{1,2})月/);
  let year: number;
  let month: number;
  if (nameMatch) {
    year = Number(nameMatch[1]);
    month = Number(nameMatch[2]);
  } else {
    // フォールバック: start_dateから取得
    const [yearStr, monthStr] = period.start_date.split('-');
    year = Number(yearStr);
    month = Number(monthStr);
  }

  // 5週目は翌月分（月謝は翌月分を請求するため）
  let targetYear = year;
  let targetMonth = month + 1;
  if (targetMonth > 12) {
    targetMonth = 1;
    targetYear++;
  }

  // 2. Get 5th week days for the NEXT month
  const fifthWeekDows = getFifthWeekDays(targetYear, targetMonth);
  const hasFifthWeek = fifthWeekDows.length > 0;

  // 3. Find the 5週目 billing_item for this period
  const { data: fifthWeekItems, error: itemError } = await supabase
    .from('billing_items')
    .select('id')
    .eq('billing_period_id', billingPeriodId)
    .in('school_id', targetSchoolIds)
    .ilike('name', '%5週目%');

  if (itemError) throw new Error(`5週目項目の取得に失敗: ${itemError.message}`);
  if (!fifthWeekItems || fifthWeekItems.length === 0) {
    return { updated: 0, skipped: 0 };
  }

  // 4. 5週目がない月（4週のみ）→ 全生徒に0を入力
  if (!hasFifthWeek) {
    // 対象の全生徒を取得
    const { data: students, error: studentsError } = await supabase
      .from('students')
      .select('id, school_id')
      .in('school_id', targetSchoolIds)
      .is('deleted_at', null);

    if (studentsError) throw new Error(`生徒の取得に失敗: ${studentsError.message}`);
    if (!students || students.length === 0) return { updated: 0, skipped: 0 };

    let updated = 0;
    for (const item of fifthWeekItems) {
      for (const student of students) {
        const { data: existing } = await supabase
          .from('student_billings')
          .select('id')
          .eq('student_id', student.id)
          .eq('billing_item_id', item.id)
          .maybeSingle();

        if (existing) {
          await supabase
            .from('student_billings')
            .update({ value_number: 0, updated_at: new Date().toISOString() })
            .eq('id', existing.id);
        } else {
          await supabase
            .from('student_billings')
            .insert({
              school_id: student.school_id,
              student_id: student.id,
              billing_item_id: item.id,
              is_billed: false,
              value_number: 0,
            });
        }
        updated++;
      }
    }

    return { updated, skipped: 0 };
  }

  // 5. 5週目がある月 → 通塾日程からコマ数を計算
  const { data: patterns, error: patternError } = await supabase
    .from('schedule_regular_patterns')
    .select('student_id, day_of_week, is_active')
    .in('school_id', targetSchoolIds)
    .eq('is_active', true)
    .eq('period_type', 'regular');

  if (patternError) throw new Error(`通塾日程の取得に失敗: ${patternError.message}`);

  // 通塾日程に含まれる全生徒＋通塾日程がない生徒も0にする
  const { data: allStudents, error: allStudentsError } = await supabase
    .from('students')
    .select('id, school_id')
    .in('school_id', targetSchoolIds)
    .is('deleted_at', null);

  if (allStudentsError) throw new Error(`生徒の取得に失敗: ${allStudentsError.message}`);
  if (!allStudents || allStudents.length === 0) return { updated: 0, skipped: 0 };

  const slotMap = calcFifthWeekSlots(patterns || [], fifthWeekDows);

  // 6. Upsert student_billings with value_number
  let updated = 0;
  const skipped = 0;

  for (const item of fifthWeekItems) {
    for (const student of allStudents) {
      const quantity = slotMap.get(student.id) || 0;

      const { data: existing } = await supabase
        .from('student_billings')
        .select('id')
        .eq('student_id', student.id)
        .eq('billing_item_id', item.id)
        .maybeSingle();

      if (existing) {
        await supabase
          .from('student_billings')
          .update({ value_number: quantity, updated_at: new Date().toISOString() })
          .eq('id', existing.id);
      } else {
        await supabase
          .from('student_billings')
          .insert({
            school_id: student.school_id,
            student_id: student.id,
            billing_item_id: item.id,
            is_billed: false,
            value_number: quantity,
          });
      }
      updated++;
    }
  }

  return { updated, skipped };
}

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

  // Group by student_id, sum quantities and collect textbook names
  const studentData = new Map<string, { quantity: number; school_id: string; textbookNames: string[] }>();
  for (const order of orders) {
    if (!order.student_id) continue;
    const materialName = (order as Record<string, unknown>).materials
      ? ((order as Record<string, unknown>).materials as { name: string })?.name
      : null;
    const existing = studentData.get(order.student_id);
    if (existing) {
      existing.quantity += order.quantity || 1;
      if (materialName && !existing.textbookNames.includes(materialName)) {
        existing.textbookNames.push(materialName);
      }
    } else {
      studentData.set(order.student_id, {
        quantity: order.quantity || 1,
        school_id: order.school_id,
        textbookNames: materialName ? [materialName] : [],
      });
    }
  }

  // Upsert billing records
  let synced = 0;
  const entries = Array.from(studentData.entries());
  for (let i = 0; i < entries.length; i++) {
    const studentId = entries[i][0];
    const data = entries[i][1];
    const valueText = data.textbookNames.length > 0 ? data.textbookNames.join(', ') : null;

    const { data: existing } = await supabase
      .from('student_billings')
      .select('id')
      .eq('student_id', studentId)
      .eq('billing_item_id', billingItemId)
      .maybeSingle();

    if (existing) {
      await supabase
        .from('student_billings')
        .update({ is_billed: false, quantity: data.quantity, value_text: valueText })
        .eq('id', existing.id);
    } else {
      await supabase
        .from('student_billings')
        .insert({
          school_id: data.school_id,
          student_id: studentId,
          billing_item_id: billingItemId,
          is_billed: false,
          quantity: data.quantity,
          value_text: valueText,
        });
    }
    synced++;
  }

  return { synced };
}
