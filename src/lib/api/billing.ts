import { supabase } from '../supabase';
import type {
  BillingPeriod,
  BillingPeriodInsert,
  BillingPeriodUpdate,
  BillingItem,
  BillingItemInsert,
  BillingItemUpdate,
  StudentBilling,
  SeasonType,
  CourseProgressItem,
  StudentCourseProgress,
} from '@/types/database';
import { getDefaultSchoolId } from './schools';
import { getFifthWeekDays, calcFifthWeekSlots } from '@/lib/utils/fifthWeek';
import { zoukomaKomaCount } from '@/lib/utils/zoukomaKoma';
import { fetchAllPaged } from '@/lib/utils/supabasePaging';
import { batchFetchCoursePrepApiMulti } from './coursePrepApi';
import type { AutoValues } from './courseProgress';
import { computeDecidedKomaByStudent } from '@/lib/coursePrepKpis';

// ============================================
// 請求期間 (Billing Periods)
// ============================================

/**
 * 請求期間一覧を取得
 */
export async function getBillingPeriods(schoolIds?: string | string[]): Promise<BillingPeriod[]> {
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
    if (
      error.code === 'PGRST116' ||
      error.code === '42501' ||
      error.message.includes('schema cache')
    ) {
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
  const targetSchoolIds = Array.isArray(schoolId) ? schoolId : [schoolId || getDefaultSchoolId()];

  const insertData: BillingPeriodInsert[] = targetSchoolIds.map((sid) => ({
    school_id: sid,
    name: period.name,
    start_date: period.start_date,
    end_date: period.end_date,
    is_active: true,
  }));

  const { data, error } = await supabase.from('billing_periods').insert(insertData).select();

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
  const { error } = await supabase.from('billing_periods').delete().eq('id', id);

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
    if (
      error.code === 'PGRST116' ||
      error.code === '42501' ||
      error.message.includes('schema cache')
    ) {
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
  item: {
    billing_period_id: string;
    name: string;
    source_type?: string;
    value_type?: string;
    linked_form_type?: string | null;
  },
  schoolId?: string | string[]
): Promise<BillingItem> {
  const targetSchoolIds = Array.isArray(schoolId) ? schoolId : [schoolId || getDefaultSchoolId()];

  // 全教室の既存 sort_order を1クエリで取得し、教室ごとの最大値をメモリで算出
  // （教室ごとに SELECT していた N+1 を解消）
  const { data: existingItems } = await supabase
    .from('billing_items')
    .select('school_id, sort_order')
    .eq('billing_period_id', item.billing_period_id)
    .in('school_id', targetSchoolIds);

  const maxSortBySchool = new Map<string, number>();
  for (const row of existingItems || []) {
    const current = maxSortBySchool.get(row.school_id) ?? -1;
    if (row.sort_order > current) maxSortBySchool.set(row.school_id, row.sort_order);
  }

  const insertData: BillingItemInsert[] = targetSchoolIds.map((sid) => ({
    school_id: sid,
    billing_period_id: item.billing_period_id,
    name: item.name,
    source_type: (item.source_type as BillingItem['source_type']) || 'free',
    value_type: (item.value_type as BillingItem['value_type']) || 'check',
    linked_form_type: item.linked_form_type ?? null,
    sort_order: (maxSortBySchool.get(sid) ?? -1) + 1,
    is_active: true,
  }));

  const { data, error } = await supabase.from('billing_items').insert(insertData).select();

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
  const { error } = await supabase.from('billing_items').delete().eq('id', id);

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
    supabase.from('billing_items').update({ sort_order: item.sort_order }).eq('id', item.id)
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
    if (
      itemsError.code === 'PGRST116' ||
      itemsError.code === '42501' ||
      itemsError.message.includes('schema cache')
    ) {
      console.warn('billing_itemsテーブルの取得に失敗しました（無視します）:', itemsError);
      return [];
    }
    throw new Error(`請求項目の取得に失敗しました: ${itemsError.message}`);
  }

  if (!billingItems || billingItems.length === 0) {
    return [];
  }

  const itemIds = billingItems.map((i) => i.id);

  // student_billings は (生徒数 × 項目数) のオーダーで増える。PostgREST のデフォルト
  // 上限（1000行）で頭打ちになると、5週目自動計算などで行数が増えた途端に一部の
  // 計上（例: 単語練習帳）が取得結果から押し出されて画面から消える。
  // そのため .range() でページングし、全件を確実に取得する。id 昇順で安定ページング。
  const PAGE_SIZE = 1000;
  const allRows: StudentBilling[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('student_billings')
      .select('*')
      .in('billing_item_id', itemIds)
      .in('school_id', targetSchoolIds)
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      if (
        error.code === 'PGRST116' ||
        error.code === '42501' ||
        error.message.includes('schema cache')
      ) {
        console.warn('student_billingsテーブルの取得に失敗しました（無視します）:', error);
        return [];
      }
      throw new Error(`請求状況の取得に失敗しました: ${error.message}`);
    }

    const rows = (data || []) as StudentBilling[];
    allRows.push(...rows);
    // 1ページ分に満たなければ最終ページ
    if (rows.length < PAGE_SIZE) break;
  }

  return allRows;
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
      throw new Error(
        `生徒情報の取得に失敗しました: ${studentError?.message || '生徒が見つかりません'}`
      );
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

  if (
    existingError &&
    existingError.code !== 'PGRST116' &&
    existingError.code !== '42501' &&
    existingError.code !== 'PGRST202'
  ) {
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
/**
 * 全生徒分の5週目コマ数をバルクupsertする。
 * 1件ずつ select→update/insert していた N+1 を、
 * 「既存レコード一括取得 → 1回の upsert」に置き換えて高速化する。
 *
 * 注意: upsert は指定カラムを全て上書きするため、既存行の is_billed を
 * 既存値で維持する（請求済みフラグを誤って false に戻さないため）。
 */
async function bulkUpsertFifthWeekValues(
  students: Array<{ id: string; school_id: string }>,
  billingItemId: string,
  getQuantity: (studentId: string) => number
): Promise<number> {
  if (students.length === 0) return 0;

  // 既存レコードの is_billed を一括取得（この billing_item に紐づく行のみ）
  const { data: existingRows, error: fetchError } = await supabase
    .from('student_billings')
    .select('student_id, is_billed')
    .eq('billing_item_id', billingItemId);
  if (fetchError) throw new Error(`既存請求の取得に失敗: ${fetchError.message}`);

  const billedMap = new Map<string, boolean>();
  for (const row of existingRows || []) {
    billedMap.set(row.student_id, row.is_billed);
  }

  const payload = students.map((s) => ({
    school_id: s.school_id,
    student_id: s.id,
    billing_item_id: billingItemId,
    is_billed: billedMap.get(s.id) ?? false, // 既存の請求済みフラグを保持／新規は false
    value_number: getQuantity(s.id),
  }));

  // 大量行でも安全なよう一定件数ごとに分割して upsert
  const CHUNK = 500;
  for (let i = 0; i < payload.length; i += CHUNK) {
    const { error } = await supabase.from('student_billings').upsert(payload.slice(i, i + CHUNK), {
      onConflict: 'student_id,billing_item_id',
    });
    if (error) throw new Error(`請求コマ数の更新に失敗: ${error.message}`);
  }

  return students.length;
}

export async function autoFillFifthWeekBilling(
  billingItemId: string,
  periodStartDate: string, // 'YYYY-MM-DD' format
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

    // 5週目がない月は全生徒0コマをバルクupsert
    const updated = await bulkUpsertFifthWeekValues(students, billingItemId, () => 0);
    return { updated, skipped: 0 };
  }

  // 3. 全生徒を取得
  const { data: allStudents, error: studentsError } = await supabase
    .from('students')
    .select('id, school_id, is_programming, withdrawal_date')
    .in('school_id', targetSchoolIds)
    .is('deleted_at', null);

  if (studentsError) throw new Error(`生徒の取得に失敗: ${studentsError.message}`);
  if (!allStudents || allStudents.length === 0) return { updated: 0, skipped: 0 };

  // 4. Fetch regular patterns active as of the target month start
  //    過去月の請求は当時の通塾日程、未来予約は反映されないようにする
  const targetMonthStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const { data: patterns, error: patternError } = await supabase
    .from('schedule_regular_patterns')
    .select('student_id, day_of_week, is_active, effective_from, effective_until')
    .in('school_id', targetSchoolIds)
    .eq('is_active', true)
    .eq('period_type', 'regular')
    .lte('effective_from', targetMonthStart)
    .or(`effective_until.is.null,effective_until.gte.${targetMonthStart}`);

  if (patternError) throw new Error(`通塾日程の取得に失敗: ${patternError.message}`);

  // 5. Calculate slots per student
  const slotMap = calcFifthWeekSlots(patterns || [], fifthWeekDows);

  // 6. 全生徒分のコマ数を算出してバルクupsert
  //    対象月初時点で退塾済み / プログラミング生は0コマ
  const quantityFor = (student: {
    id: string;
    is_programming: boolean | null;
    withdrawal_date: string | null;
  }) => {
    const withdrawnByMonth = student.withdrawal_date && student.withdrawal_date < targetMonthStart;
    return withdrawnByMonth ? 0 : student.is_programming ? 0 : slotMap.get(student.id) || 0;
  };
  const quantityMap = new Map(allStudents.map((s) => [s.id, quantityFor(s)]));

  const updated = await bulkUpsertFifthWeekValues(
    allStudents,
    billingItemId,
    (studentId) => quantityMap.get(studentId) || 0
  );

  return { updated, skipped: 0 };
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

  const appItemIds = appItems.map((item) => item.id);

  // 2. Find student_applications where these items are completed
  // student_applications has: student_id, item_id, status, school_id
  const { data: applications, error: appError } = await supabase
    .from('student_applications')
    .select('student_id, item_id, status, school_id')
    .in('item_id', appItemIds)
    .in('school_id', targetSchoolIds);

  if (appError) throw new Error(`申込状況の取得に失敗: ${appError.message}`);
  if (!applications) return { synced: 0, total: 0 };

  // 3. Filter to only completed applications（生徒重複は1件に集約）
  const schoolByStudent = new Map<string, string>();
  for (const app of applications) {
    if (app.status === 'completed') schoolByStudent.set(app.student_id, app.school_id);
  }
  const checkedStudentIds = Array.from(schoolByStudent.keys());
  if (checkedStudentIds.length === 0) return { synced: 0, total: 0 };

  // 4. 既存レコードを一括取得し「更新対象」と「新規作成対象」に振り分け
  //    （1件ずつ select→update/insert していた N+1 を解消）
  const { data: existingRows, error: existingError } = await supabase
    .from('student_billings')
    .select('student_id')
    .eq('billing_item_id', billingItemId)
    .in('student_id', checkedStudentIds);
  if (existingError) throw new Error(`既存請求の取得に失敗: ${existingError.message}`);

  const existingIds = new Set((existingRows || []).map((r) => r.student_id));
  const newStudentIds = checkedStudentIds.filter((id) => !existingIds.has(id));

  // 5. 既存はまとめて is_billed=true に更新（他フィールドは保持）
  if (existingIds.size > 0) {
    const { error: updateError } = await supabase
      .from('student_billings')
      .update({ is_billed: true })
      .eq('billing_item_id', billingItemId)
      .in('student_id', Array.from(existingIds));
    if (updateError) throw new Error(`請求の更新に失敗: ${updateError.message}`);
  }

  // 6. 新規はまとめて挿入
  if (newStudentIds.length > 0) {
    const { error: insertError } = await supabase.from('student_billings').insert(
      newStudentIds.map((studentId) => ({
        school_id: schoolByStudent.get(studentId)!,
        student_id: studentId,
        billing_item_id: billingItemId,
        is_billed: true,
        quantity: null,
      }))
    );
    if (insertError) throw new Error(`請求の作成に失敗: ${insertError.message}`);
  }

  return { synced: checkedStudentIds.length, total: checkedStudentIds.length };
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
  // created_at は timestamptz(UTC) 格納・DBセッションTZはUTCのため、境界比較は必ず
  // JST(+09:00)でアンカーする。素の "T00:00:00"(=UTC0時) で比較すると、JST深夜0〜9時に
  // 作成された回答が UTC では前日扱いになり、月初・期末で1つ前の請求期間に誤計上される。
  const periodStart = period.start_date; // e.g. "2026-03-01"
  const periodEndPlusOne = (() => {
    const d = new Date(period.end_date);
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0]; // e.g. "2026-04-01"
  })();

  let synced = 0;

  for (const item of linkedItems) {
    // form_responses は (生徒数 × 回答) でスケールし 1000 行を超えうる。切り捨てると
    // 一部生徒の回答が計上から漏れる（過去の請求計上消失事故と同型）ため、今期分・
    // キャリーオーバー分とも .range() で全件ページング取得する。id 昇順で安定ページング。
    type CarryResp = {
      linked_student_id: string | null;
      status_checks: Record<string, boolean> | null;
      response_data: unknown;
    };

    // 3a. 今期の日付範囲内の回答を取得（全件 — charged判定は後で行う）
    let currentResponsesAll: CarryResp[];
    try {
      currentResponsesAll = await fetchAllPaged<CarryResp>((from, to) =>
        supabase
          .from('form_responses')
          .select('linked_student_id, status_checks, response_data')
          .eq('form_type', item.linked_form_type!)
          .not('linked_student_id', 'is', null)
          .in('school_id', targetSchoolIds)
          .gte('created_at', `${periodStart}T00:00:00+09:00`)
          .lt('created_at', `${periodEndPlusOne}T00:00:00+09:00`)
          .order('id', { ascending: true })
          .range(from, to)
      );
    } catch (respErr) {
      console.warn(`フォーム回答の取得に失敗 (${item.linked_form_type}):`, respErr);
      continue;
    }

    // 3b. 前期以前の回答も取得（キャリーオーバー）
    //     charged/非charged 両方取得し、カウント段階で判定する
    let carryOverResponses: CarryResp[] = [];
    try {
      const olderAll = await fetchAllPaged<CarryResp>((from, to) =>
        supabase
          .from('form_responses')
          .select('linked_student_id, status_checks, response_data')
          .eq('form_type', item.linked_form_type!)
          .not('linked_student_id', 'is', null)
          .in('school_id', targetSchoolIds)
          .lt('created_at', `${periodStart}T00:00:00+09:00`)
          .order('id', { ascending: true })
          .range(from, to)
      );

      if (olderAll.length > 0) {
        const { data: pastPeriods } = await supabase
          .from('billing_periods')
          .select('id')
          .in('school_id', targetSchoolIds)
          .lt('end_date', periodStart);

        if (pastPeriods && pastPeriods.length > 0) {
          const pastPeriodIds = pastPeriods.map((p) => p.id);
          const { data: pastItems } = await supabase
            .from('billing_items')
            .select('id')
            .in('billing_period_id', pastPeriodIds)
            .eq('linked_form_type', item.linked_form_type!);

          if (pastItems && pastItems.length > 0) {
            const pastItemIds = pastItems.map((pi) => pi.id);
            const { data: billedInPast } = await supabase
              .from('student_billings')
              .select('student_id')
              .in('billing_item_id', pastItemIds)
              .eq('is_billed', true);

            const billedStudentIds = new Set(billedInPast?.map((b) => b.student_id) || []);
            carryOverResponses = olderAll.filter(
              (r) => r.linked_student_id && !billedStudentIds.has(r.linked_student_id)
            );
          } else {
            carryOverResponses = olderAll;
          }
        } else {
          carryOverResponses = olderAll;
        }
      }
    } catch (carryErr) {
      console.warn('キャリーオーバー取得に失敗（今期分のみで続行）:', carryErr);
    }

    // 3c. 今期 + キャリーオーバーを合算
    const allResponses = [...(currentResponsesAll || []), ...carryOverResponses];
    if (allResponses.length === 0) continue;

    // 増コマは「申込コマ数」を請求数として扱う。それ以外のフォームは1回答=1件。
    const isZoukoma = item.linked_form_type === 'zoukoma';

    // 1回答あたりの計上数。増コマは申込コマ数（zoukomaKomaCount）を採用、
    // それ以外のフォームは1回答=1件。
    const responseWeight = (resp: { response_data?: unknown }): number =>
      isZoukoma ? zoukomaKomaCount(resp.response_data) : 1;

    // 4. 生徒ごとに全コマ数・非計上コマ数を集計
    const studentTotalCounts = new Map<string, number>();
    const studentNonChargedCounts = new Map<string, number>();
    for (const resp of allResponses) {
      if (resp.linked_student_id) {
        const weight = responseWeight(resp);
        studentTotalCounts.set(
          resp.linked_student_id,
          (studentTotalCounts.get(resp.linked_student_id) || 0) + weight
        );
        const sc = (resp.status_checks || {}) as Record<string, boolean>;
        if (!sc.charged) {
          studentNonChargedCounts.set(
            resp.linked_student_id,
            (studentNonChargedCounts.get(resp.linked_student_id) || 0) + weight
          );
        }
      }
    }

    // 5. Upsert into student_billings
    //    value_number = 未計上（新規）コマ数、quantity = 計上済みコマ数。
    //    こうすると同期で計上済み分が消えず、請求表セルで「✓計上 N」を残したまま
    //    新規分だけ別表示できる（計上済みが0=空欄に潰れて見えなくなる問題の対策）。
    for (const [studentId, total] of Array.from(studentTotalCounts.entries())) {
      const nonCharged = studentNonChargedCounts.get(studentId) || 0;
      const charged = total - nonCharged;
      const allCharged = nonCharged === 0 && total > 0;

      const { data: existing } = await supabase
        .from('student_billings')
        .select('id')
        .eq('student_id', studentId)
        .eq('billing_item_id', item.id)
        .maybeSingle();

      if (existing) {
        await supabase
          .from('student_billings')
          .update({
            value_number: nonCharged,
            quantity: charged,
            is_billed: allCharged,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id);
      } else {
        const { data: studentData } = await supabase
          .from('students')
          .select('school_id')
          .eq('id', studentId)
          .single();

        if (studentData) {
          await supabase.from('student_billings').insert({
            school_id: studentData.school_id,
            student_id: studentId,
            billing_item_id: item.id,
            is_billed: allCharged,
            value_number: nonCharged,
            quantity: charged,
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

  // end_date の 23:59:59 までを含むため +1 日。境界比較は syncFormToBilling と同じく
  // JST(+09:00)アンカー。書き込み側(syncFormToBilling)と期間境界を一致させないと、
  // 同期方向によって回答の帰属期間がズレて is_billed が食い違う。
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
    .gte('created_at', `${period.start_date}T00:00:00+09:00`)
    .lt('created_at', `${periodEndPlusOne}T00:00:00+09:00`);

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

  // created_at(UTC) を JST 暦日に変換してから期間を引き当てる。素の UTC 日付で引くと、
  // JST 深夜0〜9時の回答が前日扱いになり、下の JST アンカーの sibling 取得と期間がズレる。
  const createdDate = new Date(
    new Date(response.created_at as string).getTime() + 9 * 60 * 60 * 1000
  )
    .toISOString()
    .split('T')[0];

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

  // 境界比較は JST(+09:00)アンカー（syncFormToBilling と統一。理由は同関数のコメント参照）
  const periodEndPlusOne = (() => {
    const d = new Date(period.end_date);
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  })();

  // 同じ生徒・同 form_type・同期間の全回答を取得
  const { data: siblings } = await supabase
    .from('form_responses')
    .select('id, status_checks, response_data')
    .eq('linked_student_id', response.linked_student_id)
    .eq('form_type', response.form_type)
    .gte('created_at', `${period.start_date}T00:00:00+09:00`)
    .lt('created_at', `${periodEndPlusOne}T00:00:00+09:00`);

  if (!siblings || siblings.length === 0) return;

  // 計上数は「1回答=1件」ではなく、増コマは申込コマ数（total_koma）を採用する。
  // 一括同期(syncFormToBilling)と数え方を揃える（揃えないと回答一覧で計上したときだけ
  // 件数になり、増コマのコマ数がズレる）。
  const isZoukoma = response.form_type === 'zoukoma';
  const weightOf = (r: { response_data?: unknown }) =>
    isZoukoma ? zoukomaKomaCount(r.response_data) : 1;

  let chargedCount = 0; // 計上済みコマ数（重み付け）
  let nonChargedCount = 0; // 未計上コマ数（重み付け）
  let chargedResponses = 0; // 全件計上済み判定用の回答件数
  for (const r of siblings) {
    const sc = (r.status_checks || {}) as Record<string, boolean>;
    const w = weightOf(r);
    if (sc.charged === true) {
      chargedCount += w;
      chargedResponses++;
    } else {
      nonChargedCount += w;
    }
  }
  const allCharged = chargedResponses === siblings.length && chargedCount > 0;

  // student_billings の is_billed / value_number(未計上) / quantity(計上済み) を upsert。
  // quantity に計上済み件数を残すことで、請求表セルで「✓計上 N」を維持できる。
  const { data: existing } = await supabase
    .from('student_billings')
    .select('id, is_billed, value_number, quantity')
    .eq('student_id', response.linked_student_id)
    .eq('billing_item_id', itemId)
    .maybeSingle();

  if (existing) {
    if (
      existing.is_billed !== allCharged ||
      existing.value_number !== nonChargedCount ||
      (existing as { quantity?: number | null }).quantity !== chargedCount
    ) {
      await supabase
        .from('student_billings')
        .update({
          is_billed: allCharged,
          value_number: nonChargedCount,
          quantity: chargedCount,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);
    }
  } else {
    await supabase.from('student_billings').insert({
      school_id: response.school_id,
      student_id: response.linked_student_id,
      billing_item_id: itemId,
      is_billed: allCharged,
      value_number: nonChargedCount,
      quantity: chargedCount,
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
  updates: {
    is_billed?: boolean;
    value_number?: number | null;
    value_text?: string | null;
    quantity?: number | null;
  },
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
      throw new Error(
        `生徒情報の取得に失敗しました: ${studentError?.message || '生徒が見つかりません'}`
      );
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
        quantity: updates.quantity ?? null,
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
    // 対象の全生徒を取得（1000行上限対策で全件ページング取得）
    const students = await fetchAllPaged<{ id: string; school_id: string }>((from, to) =>
      supabase
        .from('students')
        .select('id, school_id')
        .in('school_id', targetSchoolIds)
        .is('deleted_at', null)
        .order('id', { ascending: true })
        .range(from, to)
    ).catch((e) => {
      throw new Error(`生徒の取得に失敗: ${e.message}`);
    });
    if (students.length === 0) return { updated: 0, skipped: 0 };

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
          await supabase.from('student_billings').insert({
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

  // 5. 5週目がある月 → 対象月（翌月）初時点で有効な通塾日程からコマ数を計算
  //    過去月の請求を再計算しても、当時の通塾日程で正しく算出される
  const targetMonthStart = `${targetYear}-${String(targetMonth).padStart(2, '0')}-01`;
  // schedule_regular_patterns は (生徒数 × 曜日 × 履歴) で増えるため 1000行を超えやすい。
  // 切り捨てると一部生徒の通塾日程が欠落し 5週目コマ数が静かに誤るので全件ページング取得する。
  const patterns = await fetchAllPaged<{
    student_id: string;
    day_of_week: number;
    is_active: boolean;
    effective_from: string;
    effective_until: string | null;
  }>((from, to) =>
    supabase
      .from('schedule_regular_patterns')
      .select('student_id, day_of_week, is_active, effective_from, effective_until')
      .in('school_id', targetSchoolIds)
      .eq('is_active', true)
      .eq('period_type', 'regular')
      .lte('effective_from', targetMonthStart)
      .or(`effective_until.is.null,effective_until.gte.${targetMonthStart}`)
      .order('id', { ascending: true })
      .range(from, to)
  ).catch((e) => {
    throw new Error(`通塾日程の取得に失敗: ${e.message}`);
  });

  // 通塾日程に含まれる全生徒＋通塾日程がない生徒も0にする（1000行上限対策で全件ページング取得）
  const allStudents = await fetchAllPaged<{
    id: string;
    school_id: string;
    is_programming: boolean;
    withdrawal_date: string | null;
  }>((from, to) =>
    supabase
      .from('students')
      .select('id, school_id, is_programming, withdrawal_date')
      .in('school_id', targetSchoolIds)
      .is('deleted_at', null)
      .order('id', { ascending: true })
      .range(from, to)
  ).catch((e) => {
    throw new Error(`生徒の取得に失敗: ${e.message}`);
  });
  if (allStudents.length === 0) return { updated: 0, skipped: 0 };

  const slotMap = calcFifthWeekSlots(patterns, fifthWeekDows);

  // 6. Upsert student_billings with value_number
  let updated = 0;
  const skipped = 0;

  const programmingStudents = allStudents.filter((s) => s.is_programming);
  console.warn(`[5週目] 対象教室: ${targetSchoolIds.join(', ')}`);
  console.warn(
    `[5週目] 全${allStudents.length}名中、プログラミング生徒: ${programmingStudents.length}名（スキップ対象）`
  );
  if (programmingStudents.length > 0) {
    console.warn(
      `[5週目] プログラミング生徒:`,
      programmingStudents.map((s) => ({
        id: s.id,
        school_id: s.school_id,
        is_programming: s.is_programming,
      }))
    );
  }

  for (const item of fifthWeekItems) {
    for (const student of allStudents) {
      const rawSlots = slotMap.get(student.id) || 0;
      // 対象月初時点で退塾済みの生徒は0コマ
      const withdrawnByMonth =
        student.withdrawal_date && student.withdrawal_date < targetMonthStart;
      const quantity = withdrawnByMonth ? 0 : student.is_programming ? 0 : rawSlots;

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
        await supabase.from('student_billings').insert({
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
  const studentData = new Map<
    string,
    { quantity: number; school_id: string; textbookNames: string[] }
  >();
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
      await supabase.from('student_billings').insert({
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

/**
 * 講習の「取得増コマ」を請求項目に同期する。
 *
 * 進捗管理表（講習）の「増コマ回数」列と同じ定義で、生徒ごとの取得増コマ数を算出し、
 * 指定の請求項目（value_type='number'）へ流し込む。教材発注の「発注管理から同期」と同じ
 * 使い勝手で、講習の増コマを請求に載せられるようにするためのもの。
 *
 * 数え方は coursePrepKpis.computeDecidedKomaByStudent に集約（ダッシュボードと同一定義）:
 *   - applied_extra 自動列: max(0, applied_total - course_sessions)
 *   - 手入力の「増コマ回数」列: number_value
 *
 * 計上済み/未計上の扱いはフォーム同期（syncFormToBilling）と揃える:
 *   - value_number = 未計上（新規）コマ数、quantity = 計上済みコマ数
 *   - 再同期しても計上済み分（quantity）は保持し、増えた差分だけ未計上に出す
 *
 * 請求は月次・講習は季節単位でズレるため、対象の講習は season/year で明示指定する
 * （呼び出し側で季節・年を選ばせる）。
 *
 * @param billingItemId 流し込み先の請求項目ID
 * @param schoolIds     対象教室（単一/複数）
 * @param season        講習の季節（spring/summer/winter）
 * @param year          講習の年
 */
export async function syncCourseExtraToBilling(
  billingItemId: string,
  schoolIds: string | string[],
  season: SeasonType,
  year: number
): Promise<{ synced: number }> {
  const targetSchoolIds = Array.isArray(schoolIds) ? schoolIds : [schoolIds];

  // 進捗データ（項目・生徒進捗・自動値）を教室ごとに一括取得
  const multi = await batchFetchCoursePrepApiMulti(
    { schoolIds: targetSchoolIds, season, year: String(year) },
    ['progress_items', 'student_progress', 'auto_values']
  );

  let synced = 0;

  for (const schoolId of targetSchoolIds) {
    const result = multi[schoolId];
    if (!result) continue;

    const items = (result.progress_items as CourseProgressItem[]) ?? [];
    const progressData = (result.student_progress as StudentCourseProgress[]) ?? [];
    const autoValues = (result.auto_values as AutoValues) ?? {};

    // この教室に登場する生徒IDを進捗行・自動値の両方から集める
    const studentIds = new Set<string>();
    for (const p of progressData) if (p.student_id) studentIds.add(p.student_id);
    for (const sid of Object.keys(autoValues)) studentIds.add(sid);
    if (studentIds.size === 0) continue;

    // 生徒ごとの取得増コマ（ダッシュボードと同一定義）
    const decided = computeDecidedKomaByStudent(
      Array.from(studentIds).map((id) => ({ id })),
      items,
      progressData,
      autoValues
    );

    for (const [studentId, total] of Object.entries(decided)) {
      // 0コマの生徒は請求に載せない（教材発注の同期と同様、対象のみ upsert）
      if (!total || total <= 0) continue;

      const { data: existing } = await supabase
        .from('student_billings')
        .select('id, quantity')
        .eq('student_id', studentId)
        .eq('billing_item_id', billingItemId)
        .maybeSingle();

      // 計上済み(quantity)は保持し、新しい合計との差分だけ未計上(value_number)に出す。
      // 合計が減った場合でも計上済みは合計を超えないように丸める。
      const prevCharged = existing?.quantity ?? 0;
      const charged = Math.min(prevCharged, total);
      const pending = total - charged;
      const allCharged = pending === 0 && charged > 0;

      if (existing) {
        await supabase
          .from('student_billings')
          .update({
            value_number: pending,
            quantity: charged,
            is_billed: allCharged,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id);
      } else {
        await supabase.from('student_billings').insert({
          school_id: schoolId,
          student_id: studentId,
          billing_item_id: billingItemId,
          is_billed: allCharged,
          value_number: pending,
          quantity: charged,
        });
      }
      synced++;
    }
  }

  return { synced };
}
