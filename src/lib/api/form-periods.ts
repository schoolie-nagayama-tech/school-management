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
 * period_key は回答詳細ページのURL動的セグメント（/forms/responses/[type]/[periodKey]）に
 * そのまま埋め込まれる。`/` や空白などURLパスを壊す文字が混ざると複数セグメントに割れて
 * 404 になるため（例: "6/1～7/15" → /.../6/1～7/15）、作成時にここで弾く。
 * 表示用の文言は title 側を使うので、period_key は識別子としてURLセーフに保つ。
 */
const UNSAFE_PERIOD_KEY_CHARS = /[/\\?#%\s]/;

function assertValidPeriodKey(periodKey: string): void {
  if (!periodKey || !periodKey.trim()) {
    throw new Error('期間キーを入力してください');
  }
  if (UNSAFE_PERIOD_KEY_CHARS.test(periodKey)) {
    throw new Error(
      '期間キーに / \\ ? # % や空白は使えません（URLが壊れて回答を開けなくなります）。例: 2026-06。日付の範囲はタイトルに記入してください。'
    );
  }
}

/**
 * 既存キーと重複しない期間キーを生成する（YYYY-MM 形式、衝突時は -2, -3 と連番）。
 * period_key は回答詳細・プレビューのURLにそのまま使うため、ユーザー入力させず自動生成して
 * 不正な値（スラッシュ等）の混入を防ぐ。表示用の文言は title 側で設定する。
 */
export function generateUniquePeriodKey(
  existingKeys: string[],
  baseDate: Date = new Date()
): string {
  const base = `${baseDate.getFullYear()}-${String(baseDate.getMonth() + 1).padStart(2, '0')}`;
  const taken = new Set(existingKeys);
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/**
 * 指定フォーム種別・教室群で次に使う一意な期間キーを取得する（新規作成フォーム用）。
 * 複数教室に一括作成する場合は全教室の既存キーを集約し、どの教室とも衝突しないキーを選ぶ。
 * アーカイブ済みの期間もキーを占有しているため衝突回避の対象に含める。
 */
export async function getNextPeriodKey(
  formType: FormType,
  schoolIds: string[]
): Promise<string> {
  const targets = schoolIds.filter(Boolean);
  if (targets.length === 0) {
    return generateUniquePeriodKey([]);
  }
  const lists = await Promise.all(
    targets.map((sid) => getFormPeriods(sid, formType, true))
  );
  const keys = lists.flat().map((p) => p.period_key);
  return generateUniquePeriodKey(keys);
}

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
 * 期間管理の「公開」状態（is_active=true）と日付ベースで公開期間内の期間を取得
 * 設定画面の公開状況と同期
 */
export async function getActiveFormPeriod(
  schoolId: string,
  formType: FormType
): Promise<FormPeriod | null> {
  const nowDate = new Date();

  // 期間管理で「公開」にした期間（is_active=true）を取得
  const { data, error } = await supabase
    .from('form_periods')
    .select('*')
    .eq('school_id', schoolId)
    .eq('form_type', formType)
    .eq('is_active', true)
    .or('is_archived.eq.false,is_archived.is.null')
    .order('period_key', { ascending: false })
    .limit(1);

  if (error) {
    console.error(`[getActiveFormPeriod] Error fetching periods:`, error);
    throw new Error(`フォーム公開期間の取得に失敗しました: ${error.message}`);
  }

  if (!data || data.length === 0) {
    return null;
  }

  const period = data[0] as FormPeriod;

  // 日付ベースで公開期間内かチェック
  const start = period.publish_start ? new Date(period.publish_start) : null;
  const end = period.publish_end ? new Date(period.publish_end) : null;

  if (start && start > nowDate) {
    return null; // 公開開始前
  }
  if (end && end < nowDate) {
    return null; // 公開終了後
  }

  return period;
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
  assertValidPeriodKey(data.period_key);

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
 * 選択した複数教室に同じフォーム期間を一括作成（既存の period_key があれば更新）
 */
export async function createFormPeriodForSchools(
  schoolIds: string[],
  data: Omit<FormPeriodInsert, 'school_id'>
): Promise<FormPeriod[]> {
  if (schoolIds.length === 0) {
    return [];
  }
  return Promise.all(schoolIds.map((schoolId) => createFormPeriod({ ...data, school_id: schoolId })));
}

/**
 * 選択した複数教室の同じ form_type / period_key の期間を同じ内容で一括更新（存在しない教室はスキップ）
 */
export async function updateFormPeriodForSchools(
  schoolIds: string[],
  formType: FormType,
  periodKey: string,
  updates: FormPeriodUpdate
): Promise<void> {
  const periods = await Promise.all(
    schoolIds.map((schoolId) => getFormPeriodByKey(schoolId, formType, periodKey))
  );
  const existing = periods.filter((p): p is FormPeriod => p !== null);
  if (existing.length > 0) {
    await Promise.all(existing.map((p) => updateFormPeriod(p.id, updates)));
  }
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
