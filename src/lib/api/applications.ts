import { supabase } from '../supabase';
import { canDeleteOnClear } from '@/lib/bulletin/applicationSync';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
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
 *
 * @param client - RLS 認証済みのサーバークライアント（省略時はブラウザシングルトン）
 *                 サーバー prefetch 経路で正しいデータを取れるよう DI する
 */
export async function getApplicationItems(
  schoolIds?: string | string[], // 単一のIDまたは複数のID
  includeHidden: boolean = false,
  client: SupabaseClient<Database> = supabase
): Promise<ApplicationItem[]> {
  // schoolIdsが配列の場合は複数教室、文字列の場合は単一教室、未指定の場合はデフォルト教室
  const targetSchoolIds = Array.isArray(schoolIds)
    ? schoolIds
    : schoolIds
      ? [schoolIds]
      : [getDefaultSchoolId()];

  let query = client
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

  const maxSortOrder = existingItems && existingItems.length > 0 ? existingItems[0].sort_order : -1;

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

  if (error || !data) {
    throw new Error(`申込項目の作成に失敗しました: ${error?.message ?? 'no data'}`);
  }

  const row = data as ApplicationItem;
  return {
    ...row,
    column_type: row.column_type || 'check',
    due_date: row.due_date || null,
    manager_only: row.manager_only === true,
  };
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

  if (error || !data) {
    throw new Error(`申込項目の更新に失敗しました: ${error?.message ?? 'no data'}`);
  }

  const row = data as ApplicationItem;
  return {
    ...row,
    column_type: row.column_type || 'check',
    due_date: row.due_date || null,
    manager_only: row.manager_only === true,
  };
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
  const { error } = await supabase.from('application_items').delete().eq('id', id);

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
/**
 * @param client - RLS 認証済みのサーバークライアント（省略時はブラウザシングルトン）
 *                 サーバー prefetch 経路で正しいデータを取れるよう DI する
 */
export async function getStudentApplications(
  schoolIds?: string | string[], // 単一のIDまたは複数のID
  client: SupabaseClient<Database> = supabase
): Promise<StudentApplication[]> {
  // schoolIdsが配列の場合は複数教室、文字列の場合は単一教室、未指定の場合はデフォルト教室
  const targetSchoolIds = Array.isArray(schoolIds)
    ? schoolIds
    : schoolIds
      ? [schoolIds]
      : [getDefaultSchoolId()];

  // student_applications は (生徒数 × 項目数) でスケールし、複数教室選択時に 1000 行を
  // 超えうる。PostgREST のデフォルト上限で静かに切り捨てられると申込状況が一部欠落するため、
  // .order('id').range() で 1000 件ずつ全件ページング取得する。
  const PAGE_SIZE = 1000;
  const data: unknown[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data: page, error } = await client
      .from('student_applications')
      .select('*')
      .in('school_id', targetSchoolIds)
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      // テーブルが存在しない、またはRLSエラーの場合は空配列を返す
      if (
        error.code === 'PGRST116' ||
        error.code === '42501' ||
        error.message.includes('schema cache')
      ) {
        console.warn('student_applicationsテーブルの取得に失敗しました（無視します）:', error);
        return [];
      }
      throw new Error(`申込状況の取得に失敗しました: ${error.message}`);
    }

    const rows = (page || []) as unknown[];
    data.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }

  return data.map((raw) => {
    const app = raw as StudentApplication;
    return {
      ...app,
      number_value: app.number_value ?? null,
      date_value: app.date_value ?? null,
    };
  });
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
    throw new Error(
      `生徒情報の取得に失敗しました: ${studentError?.message || '生徒が見つかりません'}`
    );
  }

  const schoolId = student.school_id;

  if (status === null) {
    /**
     * チェックを外す。
     *
     * ★自動で付いた行は消さない。消すと「まだ付けていない」と区別できず、
     *   次の同期で自動が付け直してしまう（docs/bulletin-ai-assist.html）。
     *   status を空にし set_by='manual' で残して、「人が外した」事実を持たせる。
     *   人が自分で付けた行は元から manual なので、従来どおり消してよい。
     */
    const { data: current } = await supabase
      .from('student_applications')
      .select('id, set_by')
      .eq('student_id', studentId)
      .eq('item_id', itemId)
      .eq('school_id', schoolId)
      .maybeSingle();

    const row = current as { id: string; set_by?: string | null } | null;

    if (
      !canDeleteOnClear({ exists: Boolean(row), setBy: row?.set_by === 'auto' ? 'auto' : 'manual' })
    ) {
      const { error } = await supabase
        .from('student_applications')
        .update({ status: null, set_by: 'manual' })
        .eq('id', row!.id);

      if (error) {
        throw new Error(`申込状況の解除に失敗しました: ${error.message}`);
      }
      return null;
    }

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
  if (
    existingError &&
    existingError.code !== 'PGRST116' &&
    existingError.code !== '42501' &&
    existingError.code !== 'PGRST202'
  ) {
    console.warn('既存レコードの確認に失敗しました（新規作成として処理します）:', existingError);
  }

  if (existing) {
    // 更新
    // ★人が触ったので manual に戻す。以後この行は自動の対象外になる
    const { data, error } = await supabase
      .from('student_applications')
      .update({ status, set_by: 'manual' })
      .eq('id', existing.id)
      .select()
      .single();

    if (error || !data) {
      throw new Error(`申込状況の更新に失敗しました: ${error?.message ?? 'no data'}`);
    }

    const row = data as StudentApplication;
    return {
      ...row,
      number_value: row.number_value ?? null,
      date_value: row.date_value ?? null,
    };
  } else {
    // 作成
    const { data, error } = await supabase
      .from('student_applications')
      .insert({
        school_id: schoolId,
        student_id: studentId,
        item_id: itemId,
        status,
        // ★人が付けた行。自動はこの行に触らない
        set_by: 'manual',
      })
      .select()
      .single();

    if (error || !data) {
      throw new Error(`申込状況の作成に失敗しました: ${error?.message ?? 'no data'}`);
    }

    const row = data as StudentApplication;
    return {
      ...row,
      number_value: row.number_value ?? null,
      date_value: row.date_value ?? null,
    };
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
    throw new Error(
      `生徒情報の取得に失敗しました: ${studentError?.message || '生徒が見つかりません'}`
    );
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
  if (
    existingError &&
    existingError.code !== 'PGRST116' &&
    existingError.code !== '42501' &&
    existingError.code !== 'PGRST202'
  ) {
    console.warn('既存レコードの確認に失敗しました（新規作成として処理します）:', existingError);
  }

  if (existing) {
    // 更新
    const { data, error } = await supabase
      .from('student_applications')
      .update({ number_value: numberValue })
      .eq('id', existing.id)
      .select()
      .single();

    if (error || !data) {
      throw new Error(`申込状況の更新に失敗しました: ${error?.message ?? 'no data'}`);
    }

    const row = data as StudentApplication;
    return {
      ...row,
      number_value: row.number_value ?? null,
      date_value: row.date_value ?? null,
    };
  } else {
    // 作成
    const { data, error } = await supabase
      .from('student_applications')
      .insert({
        school_id: schoolId,
        student_id: studentId,
        item_id: itemId,
        status: null,
        number_value: numberValue,
      })
      .select()
      .single();

    if (error || !data) {
      throw new Error(`申込状況の作成に失敗しました: ${error?.message ?? 'no data'}`);
    }

    const row = data as StudentApplication;
    return {
      ...row,
      number_value: row.number_value ?? null,
      date_value: row.date_value ?? null,
    };
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
    throw new Error(
      `生徒情報の取得に失敗しました: ${studentError?.message || '生徒が見つかりません'}`
    );
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
  if (
    existingError &&
    existingError.code !== 'PGRST116' &&
    existingError.code !== '42501' &&
    existingError.code !== 'PGRST202'
  ) {
    console.warn('既存レコードの確認に失敗しました（新規作成として処理します）:', existingError);
  }

  if (existing) {
    // 更新
    const { data, error } = await supabase
      .from('student_applications')
      .update({ date_value: dateValue })
      .eq('id', existing.id)
      .select()
      .single();

    if (error || !data) {
      throw new Error(`申込状況の更新に失敗しました: ${error?.message ?? 'no data'}`);
    }

    const row = data as StudentApplication;
    return {
      ...row,
      number_value: row.number_value ?? null,
      date_value: row.date_value ?? null,
    };
  } else {
    // 作成
    const { data, error } = await supabase
      .from('student_applications')
      .insert({
        school_id: schoolId,
        student_id: studentId,
        item_id: itemId,
        status: null,
        date_value: dateValue,
      })
      .select()
      .single();

    if (error || !data) {
      throw new Error(`申込状況の作成に失敗しました: ${error?.message ?? 'no data'}`);
    }

    const row = data as StudentApplication;
    return {
      ...row,
      number_value: row.number_value ?? null,
      date_value: row.date_value ?? null,
    };
  }
}
