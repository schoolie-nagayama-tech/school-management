import { supabase } from '../supabase';
import type {
  ApplicationItem,
  ApplicationItemInsert,
  ApplicationItemUpdate,
  StudentApplication,
  ApplicationStatus,
  ApplicationColumnType,
} from '@/types/database';
import { getDefaultSchoolId } from './schools';

/**
 * 申込項目一覧を取得
 */
export async function getApplicationItems(
  schoolIds?: string | string[], // 単一のIDまたは複数のID
  includeHidden: boolean = false
): Promise<ApplicationItem[]> {
  // schoolIdsが配列の場合は複数教室、文字列の場合は単一教室、未指定の場合はデフォルト教室
  const targetSchoolIds = Array.isArray(schoolIds)
    ? schoolIds
    : schoolIds
    ? [schoolIds]
    : [getDefaultSchoolId()];
  
  let query = supabase
    .from('application_items')
    .select('*')
    .in('school_id', targetSchoolIds)
    .order('sort_order', { ascending: true });

  if (!includeHidden) {
    // is_hiddenがfalseまたはnullのものを取得
    query = query.or('is_hidden.eq.false,is_hidden.is.null');
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`申込項目の取得に失敗しました: ${error.message}`);
  }

  return (data || []).map((item: Record<string, unknown>) => ({
    ...item,
    column_type: (item.column_type as string) || 'check',
    due_date: (item.due_date as string | null) || null,
    manager_only: item.manager_only === true,
  })) as ApplicationItem[];
}

/**
 * 申込項目を作成
 */
export async function createApplicationItem(
  item: Omit<ApplicationItemInsert, 'school_id' | 'sort_order'> & {
    column_type?: ApplicationColumnType;
    due_date?: string | null;
  },
  schoolId?: string
): Promise<ApplicationItem> {
  const targetSchoolId = schoolId || getDefaultSchoolId();

  // 最大のsort_orderを取得
  const { data: existingItems } = await supabase
    .from('application_items')
    .select('sort_order')
    .eq('school_id', targetSchoolId)
    .order('sort_order', { ascending: false })
    .limit(1);

  const maxSortOrder = existingItems && existingItems.length > 0 
    ? existingItems[0].sort_order 
    : -1;

  const { data, error } = await supabase
    .from('application_items')
    .insert({
      ...item,
      column_type: item.column_type || 'check',
      due_date: item.due_date || null,
      school_id: targetSchoolId,
      sort_order: maxSortOrder + 1,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`申込項目の作成に失敗しました: ${error.message}`);
  }

  return {
    ...(data as any),
    column_type: (data as any).column_type || 'check',
    due_date: (data as any).due_date || null,
    manager_only: (data as any).manager_only === true,
  } as ApplicationItem;
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

  return {
    ...(data as any),
    column_type: (data as any).column_type || 'check',
    due_date: (data as any).due_date || null,
    manager_only: (data as any).manager_only === true,
  } as ApplicationItem;
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
  items: { id: string; sort_order: number }[],
  schoolIds?: string | string[] // 単一のIDまたは複数のID
): Promise<void> {
  // schoolIdsが配列の場合は複数教室、文字列の場合は単一教室、未指定の場合はデフォルト教室
  const targetSchoolIds = Array.isArray(schoolIds)
    ? schoolIds
    : schoolIds
    ? [schoolIds]
    : [getDefaultSchoolId()];

  // トランザクション的に更新（Supabaseでは個別に更新）
  const updates = items.map((item) =>
    supabase
      .from('application_items')
      .update({ sort_order: item.sort_order })
      .eq('id', item.id)
      .in('school_id', targetSchoolIds)
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
export async function getStudentApplications(
  schoolIds?: string | string[] // 単一のIDまたは複数のID
): Promise<StudentApplication[]> {
  // schoolIdsが配列の場合は複数教室、文字列の場合は単一教室、未指定の場合はデフォルト教室
  const targetSchoolIds = Array.isArray(schoolIds)
    ? schoolIds
    : schoolIds
    ? [schoolIds]
    : [getDefaultSchoolId()];

  const { data, error } = await supabase
    .from('student_applications')
    .select('*')
    .in('school_id', targetSchoolIds);

  if (error) {
    // テーブルが存在しない、またはRLSエラーの場合は空配列を返す
    if (error.code === 'PGRST116' || error.code === '42501' || error.message.includes('schema cache')) {
      console.warn('student_applicationsテーブルの取得に失敗しました（無視します）:', error);
      return [];
    }
    throw new Error(`申込状況の取得に失敗しました: ${error.message}`);
  }

  return (data || []).map((app: Record<string, unknown>) => ({
    ...app,
    number_value: app.number_value ?? null,
    date_value: app.date_value ?? null,
  })) as StudentApplication[];
}

/**
 * 生徒の申込状況を更新（または作成）
 */
export async function updateStudentApplication(
  studentId: string,
  itemId: string,
  status: ApplicationStatus | null
): Promise<StudentApplication | null> {
  // 生徒IDからschool_idを取得
  const { data: student, error: studentError } = await supabase
    .from('students')
    .select('school_id')
    .eq('id', studentId)
    .single();

  if (studentError || !student) {
    throw new Error(`生徒情報の取得に失敗しました: ${studentError?.message || '生徒が見つかりません'}`);
  }

  const schoolId = student.school_id;

  if (status === null) {
    // 削除（未登録状態に戻す）
    const { error } = await supabase
      .from('student_applications')
      .delete()
      .eq('student_id', studentId)
      .eq('item_id', itemId)
      .eq('school_id', schoolId);

    if (error) {
      throw new Error(`申込状況の削除に失敗しました: ${error.message}`);
    }

    return null;
  }

  // 既存レコードを確認
  const { data: existing, error: existingError } = await supabase
    .from('student_applications')
    .select('id')
    .eq('student_id', studentId)
    .eq('item_id', itemId)
    .eq('school_id', schoolId)
    .maybeSingle();

  // 406エラーやその他のエラーは無視（レコードが存在しない場合は新規作成）
  if (existingError && existingError.code !== 'PGRST116' && existingError.code !== '42501' && existingError.code !== 'PGRST202') {
    console.warn('既存レコードの確認に失敗しました（新規作成として処理します）:', existingError);
  }

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

    return {
      ...(data as any),
      number_value: (data as any).number_value ?? null,
      date_value: (data as any).date_value ?? null,
    } as StudentApplication;
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

    return {
      ...(data as any),
      number_value: (data as any).number_value ?? null,
      date_value: (data as any).date_value ?? null,
    } as StudentApplication;
  }
}

/**
 * 生徒の申込状況の数値を更新（または作成）
 */
export async function updateStudentApplicationNumber(
  studentId: string,
  itemId: string,
  numberValue: number | null
): Promise<StudentApplication | null> {
  // 生徒IDからschool_idを取得
  const { data: student, error: studentError } = await supabase
    .from('students')
    .select('school_id')
    .eq('id', studentId)
    .single();

  if (studentError || !student) {
    throw new Error(`生徒情報の取得に失敗しました: ${studentError?.message || '生徒が見つかりません'}`);
  }

  const schoolId = student.school_id;

  if (numberValue === null) {
    // 削除（未登録状態に戻す）
    const { error } = await supabase
      .from('student_applications')
      .delete()
      .eq('student_id', studentId)
      .eq('item_id', itemId)
      .eq('school_id', schoolId);

    if (error) {
      throw new Error(`申込状況の削除に失敗しました: ${error.message}`);
    }

    return null;
  }

  // 既存レコードを確認
  const { data: existing, error: existingError } = await supabase
    .from('student_applications')
    .select('id')
    .eq('student_id', studentId)
    .eq('item_id', itemId)
    .eq('school_id', schoolId)
    .maybeSingle();

  // 406エラーやその他のエラーは無視（レコードが存在しない場合は新規作成）
  if (existingError && existingError.code !== 'PGRST116' && existingError.code !== '42501' && existingError.code !== 'PGRST202') {
    console.warn('既存レコードの確認に失敗しました（新規作成として処理します）:', existingError);
  }

    if (existing) {
      // 更新
      const { data, error } = await supabase
        .from('student_applications')
        .update({ number_value: numberValue } as any)
        .eq('id', existing.id)
        .select()
        .single();

      if (error) {
        throw new Error(`申込状況の更新に失敗しました: ${error.message}`);
      }

      return {
        ...(data as any),
        number_value: (data as any).number_value ?? null,
        date_value: (data as any).date_value ?? null,
      } as StudentApplication;
    } else {
      // 作成
      const { data, error } = await supabase
        .from('student_applications')
        .insert({
          school_id: schoolId,
          student_id: studentId,
          item_id: itemId,
          status: null as any,
          number_value: numberValue,
        } as any)
        .select()
        .single();

      if (error) {
        throw new Error(`申込状況の作成に失敗しました: ${error.message}`);
      }

      return {
        ...(data as any),
        number_value: (data as any).number_value ?? null,
        date_value: (data as any).date_value ?? null,
      } as StudentApplication;
    }
}

/**
 * 生徒の申込状況の日付を更新（または作成）
 */
export async function updateStudentApplicationDate(
  studentId: string,
  itemId: string,
  dateValue: string | null
): Promise<StudentApplication | null> {
  // 生徒IDからschool_idを取得
  const { data: student, error: studentError } = await supabase
    .from('students')
    .select('school_id')
    .eq('id', studentId)
    .single();

  if (studentError || !student) {
    throw new Error(`生徒情報の取得に失敗しました: ${studentError?.message || '生徒が見つかりません'}`);
  }

  const schoolId = student.school_id;

  if (dateValue === null) {
    // 削除（未登録状態に戻す）
    const { error } = await supabase
      .from('student_applications')
      .delete()
      .eq('student_id', studentId)
      .eq('item_id', itemId)
      .eq('school_id', schoolId);

    if (error) {
      throw new Error(`申込状況の削除に失敗しました: ${error.message}`);
    }

    return null;
  }

  // 既存レコードを確認
  const { data: existing, error: existingError } = await supabase
    .from('student_applications')
    .select('id')
    .eq('student_id', studentId)
    .eq('item_id', itemId)
    .eq('school_id', schoolId)
    .maybeSingle();

  // 406エラーやその他のエラーは無視（レコードが存在しない場合は新規作成）
  if (existingError && existingError.code !== 'PGRST116' && existingError.code !== '42501' && existingError.code !== 'PGRST202') {
    console.warn('既存レコードの確認に失敗しました（新規作成として処理します）:', existingError);
  }

    if (existing) {
      // 更新
      const { data, error } = await supabase
        .from('student_applications')
        .update({ date_value: dateValue } as any)
        .eq('id', existing.id)
        .select()
        .single();

      if (error) {
        throw new Error(`申込状況の更新に失敗しました: ${error.message}`);
      }

      return {
        ...(data as any),
        number_value: (data as any).number_value ?? null,
        date_value: (data as any).date_value ?? null,
      } as StudentApplication;
    } else {
      // 作成
      const { data, error } = await supabase
        .from('student_applications')
        .insert({
          school_id: schoolId,
          student_id: studentId,
          item_id: itemId,
          status: null as any,
          date_value: dateValue,
        } as any)
        .select()
        .single();

      if (error) {
        throw new Error(`申込状況の作成に失敗しました: ${error.message}`);
      }

      return {
        ...(data as any),
        number_value: (data as any).number_value ?? null,
        date_value: (data as any).date_value ?? null,
      } as StudentApplication;
    }
}
