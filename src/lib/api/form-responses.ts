import { supabase } from '../supabase';
import type {
  FormResponse,
  FormResponseInsert,
  FormResponseUpdate,
  FormType,
  Student,
} from '@/types/database';
import { getDefaultSchoolId } from './schools';
import { withFetchCache } from '@/lib/utils/fetchCache';
import { zoukomaKomaCount } from '@/lib/utils/zoukomaKoma';

// ============================================
// フォーム回答関連
// ============================================

export interface FormResponseFilters {
  formType?: FormType;
  formPeriod?: string;
  grade?: number;
  linkedStatus?: 'all' | 'linked' | 'unlinked';
  showArchived?: boolean;
  search?: string;
  chargedStatus?: 'all' | 'charged' | 'not_charged';
  dateFrom?: string;
  dateTo?: string;
}

export interface FormResponseWithStudent extends FormResponse {
  linked_student?: Student | null;
}

/**
 * フォーム回答一覧を取得（紐付け済み生徒情報も含む）
 * schoolId に string[] を渡すと複数教室の回答を一括取得する
 */
export async function getFormResponses(
  schoolId?: string | string[],
  filters?: FormResponseFilters
): Promise<FormResponseWithStudent[]> {
  const schoolIds = Array.isArray(schoolId) ? schoolId : [schoolId || getDefaultSchoolId()];

  // フィルタ適用済みのクエリを from/to 範囲付きで組み立てる。
  // form_responses は複数教室×複数フォーム種別でスケールし 1000 行を超えうるため、
  // 1ページ1000件で全件ページング取得する。created_at は一意でなくページ境界で
  // 行が重複/欠落しうるので、安定化のため id を第2ソートキーに加える。
  const buildQuery = (from: number, to: number) => {
    let query = supabase.from('form_responses').select('*').in('school_id', schoolIds);

    if (filters?.formType) {
      query = query.eq('form_type', filters.formType);
    }

    if (filters?.formPeriod) {
      query = query.eq('form_period', filters.formPeriod);
    }

    if (filters?.grade) {
      query = query.eq('grade', filters.grade);
    }

    if (filters?.linkedStatus === 'linked') {
      query = query.not('linked_student_id', 'is', null);
    } else if (filters?.linkedStatus === 'unlinked') {
      query = query.is('linked_student_id', null);
    }

    // アーカイブフィルター
    if (!filters?.showArchived) {
      query = query.eq('is_archived', false);
    }

    // 生徒名検索
    if (filters?.search) {
      query = query.ilike('student_name', `%${filters.search}%`);
    }

    // 計上状態フィルター（JSONB内のフィールド）
    if (filters?.chargedStatus === 'charged') {
      query = query.eq('status_checks->>charged', 'true');
    } else if (filters?.chargedStatus === 'not_charged') {
      query = query.or('status_checks->>charged.is.null,status_checks->>charged.eq.false');
    }

    // 申込日フィルター
    if (filters?.dateFrom) {
      query = query.gte('created_at', filters.dateFrom + 'T00:00:00');
    }
    if (filters?.dateTo) {
      query = query.lte('created_at', filters.dateTo + 'T23:59:59');
    }

    return query
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to);
  };

  const PAGE_SIZE = 1000;
  const responses: FormResponse[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await buildQuery(from, from + PAGE_SIZE - 1);
    if (error) {
      throw new Error(`フォーム回答一覧の取得に失敗しました: ${error.message}`);
    }
    const rows = (data || []) as FormResponse[];
    responses.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }

  // 紐付け済みの生徒IDを取得
  const linkedStudentIds = responses
    .map((r) => r.linked_student_id)
    .filter((id): id is string => id !== null);

  // 紐付き生徒のみをIDで絞り込んで取得（全生徒取得を避ける）。
  // responses が 1000 件超になると linkedStudentIds も 1000 を超えうるが、
  // .in('id', ...) は PostgREST 上限で結果が 1000 行に切り捨てられるため、
  // 1000 件ずつのチャンクに分けて取得する。
  const studentsMap = new Map<string, Student>();
  if (linkedStudentIds.length > 0) {
    const CHUNK = 1000;
    for (let i = 0; i < linkedStudentIds.length; i += CHUNK) {
      const chunk = linkedStudentIds.slice(i, i + CHUNK);
      try {
        const { data: studentData } = await supabase
          .from('students')
          .select('*')
          .in('id', chunk)
          .is('deleted_at', null);
        (studentData || []).forEach((s) => studentsMap.set((s as Student).id, s as Student));
      } catch (error) {
        console.error('Error fetching linked students:', error);
        // エラーが発生しても続行
      }
    }
  }

  // フォーム回答に紐付け済み生徒情報を追加
  return responses.map((response) => ({
    ...response,
    linked_student: response.linked_student_id
      ? studentsMap.get(response.linked_student_id) || null
      : null,
  }));
}

/** 30秒TTLのキャッシュ付き getFormResponses */
export const getCachedFormResponses = withFetchCache(getFormResponses, {
  ttl: 30_000,
  prefix: 'formResponses',
});

/**
 * 最近の未処理フォーム回答を取得（トップページの新着通知用）
 * @param schoolIds 対象教室IDの配列
 * @param limitDays 何日以内の申込を取得するか（デフォルト: 7日）
 * @param limit 最大取得件数（デフォルト: 10件）
 * @param client DI用クライアント（省略時はブラウザクライアント。SSR事前取得時に認証済みサーバークライアントを渡す）
 */
export async function getRecentUnprocessedResponses(
  schoolIds: string[],
  limitDays: number = 7,
  limit: number = 10,
  client: typeof supabase = supabase
): Promise<FormResponseWithStudent[]> {
  if (schoolIds.length === 0) return [];

  const since = new Date();
  since.setDate(since.getDate() - limitDays);

  const { data, error } = await client
    .from('form_responses')
    .select('*')
    .in('school_id', schoolIds)
    .eq('is_archived', false)
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`新着申込の取得に失敗しました: ${error.message}`);
  }

  return (data || []) as FormResponseWithStudent[];
}

// 以下は既存のコードと同じ
/**
 * フォーム回答を1件取得
 */
export async function getFormResponse(id: string): Promise<FormResponse | null> {
  const { data, error } = await supabase.from('form_responses').select('*').eq('id', id).single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    throw new Error(`フォーム回答の取得に失敗しました: ${error.message}`);
  }

  return data as FormResponse;
}

/**
 * 保護者ポータル用フォーム回答を作成（認証不要）
 * サーバー側の /api/portal/form-responses に fetch して RLS をバイパスする
 */
export async function createPublicFormResponse(data: FormResponseInsert): Promise<FormResponse> {
  const res = await fetch('/api/portal/form-responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    if (res.status === 409) {
      throw new Error('この内容は既に送信されています。');
    }
    throw new Error(
      (json as { error?: string }).error || `フォーム回答の作成に失敗しました: ${res.status}`
    );
  }

  return (json as { data: FormResponse }).data;
}

/**
 * フォーム回答を作成（申込者・教室への通知メールは Edge Function で送信）
 */
export async function createFormResponse(data: FormResponseInsert): Promise<FormResponse> {
  const { data: created, error } = await supabase
    .from('form_responses')
    .insert(data)
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new Error('この内容は既に送信されています。');
    }
    throw new Error(`フォーム回答の作成に失敗しました: ${error.message}`);
  }

  const record = created as FormResponse;
  // 申込通知メール（申込者・教室）を Edge Function で送信（失敗しても回答は成功扱い）
  try {
    const { error: invokeError } = await supabase.functions.invoke('send-form-notification', {
      body: { record },
    });
    if (invokeError) {
      console.warn('申込通知メールの送信に失敗しました:', invokeError);
    }
  } catch (e) {
    console.warn('申込通知メールの送信に失敗しました:', e);
  }

  return record;
}

/**
 * フォーム回答のステータスチェックを更新
 */
export async function updateFormResponseStatus(
  id: string,
  statusChecks: Record<string, boolean>
): Promise<FormResponse> {
  const { data: updated, error } = await supabase
    .from('form_responses')
    .update({ status_checks: statusChecks })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw new Error(`ステータスチェックの更新に失敗しました: ${error.message}`);
  }

  return updated as FormResponse;
}

/**
 * フォーム回答を生徒に紐付け
 */
export async function linkResponseToStudent(
  responseId: string,
  studentId: string
): Promise<FormResponse> {
  // 回答を取得
  const response = await getFormResponse(responseId);
  if (!response) {
    throw new Error('フォーム回答が見つかりません');
  }

  // フォーム回答を更新
  const { data: updated, error } = await supabase
    .from('form_responses')
    .update({
      linked_student_id: studentId,
      linked_at: new Date().toISOString(),
    })
    .eq('id', responseId)
    .select()
    .single();

  if (error) {
    throw new Error(`生徒への紐付けに失敗しました: ${error.message}`);
  }

  // form_periodsからlinked_application_item_idを取得して申込状況を更新
  if (response.form_type && response.form_period) {
    try {
      const { getFormPeriods } = await import('./form-periods');
      const periods = await getFormPeriods(response.school_id, response.form_type);
      const period = periods.find((p) => p.period_key === response.form_period);

      if (period?.linked_application_item_id) {
        const { updateStudentApplication } = await import('./applications');
        try {
          await updateStudentApplication(studentId, period.linked_application_item_id, 'completed');
        } catch (error) {
          // 申込状況の更新失敗は警告のみ（回答の紐付けは成功扱い）
          console.warn('Failed to update application status:', error);
        }
      }
    } catch (error) {
      // form_periodsの取得失敗も警告のみ
      console.warn('Failed to get form period:', error);
    }
  }

  // Billing auto-sync: if form type has a linked billing item, auto-reflect
  // 判定基準: response.created_at が請求期間の start_date〜end_date 内
  try {
    const responseDate =
      response.created_at?.split('T')[0] || new Date().toISOString().split('T')[0];

    // Find active billing periods that cover the response date
    const { data: activePeriods } = await supabase
      .from('billing_periods')
      .select('id, start_date, end_date')
      .eq('school_id', response.school_id)
      .eq('is_active', true)
      .lte('start_date', responseDate)
      .gte('end_date', responseDate);

    if (activePeriods && activePeriods.length > 0) {
      // 1. 全期間の紐付け項目を1クエリで取得
      const periodIds = activePeriods.map((p) => p.id);
      const { data: linkedItems } = await supabase
        .from('billing_items')
        .select('id, billing_period_id')
        .in('billing_period_id', periodIds)
        .eq('linked_form_type', response.form_type);

      if (linkedItems && linkedItems.length > 0) {
        // 増コマは「申込コマ数」を請求数として扱う（回答件数ではない）。
        const isZoukoma = response.form_type === 'zoukoma';

        // 2. 請求数は「期間ごとに同一」（項目には依存しない）ため期間単位で1回だけ集計。
        //    通常フォームは回答件数、増コマは申込コマ数の合計を採用する。
        const countByPeriod = new Map<string, number>();
        await Promise.all(
          activePeriods.map(async (period) => {
            const d = new Date(period.end_date);
            d.setDate(d.getDate() + 1);
            const periodEndPlusOne = d.toISOString().split('T')[0];

            if (isZoukoma) {
              // 増コマ: 期間内のこの生徒の回答を取得し、申込コマ数を合算
              const { data: rows } = await supabase
                .from('form_responses')
                .select('response_data')
                .eq('form_type', response.form_type)
                .eq('linked_student_id', studentId)
                .eq('school_id', response.school_id)
                .gte('created_at', `${period.start_date}T00:00:00`)
                .lt('created_at', `${periodEndPlusOne}T00:00:00`);
              const totalKoma = (rows || []).reduce(
                (sum, r) =>
                  sum + zoukomaKomaCount((r as { response_data?: unknown }).response_data),
                0
              );
              countByPeriod.set(period.id, totalKoma || 1);
            } else {
              const { count } = await supabase
                .from('form_responses')
                .select('id', { count: 'exact', head: true })
                .eq('form_type', response.form_type)
                .eq('linked_student_id', studentId)
                .eq('school_id', response.school_id)
                .gte('created_at', `${period.start_date}T00:00:00`)
                .lt('created_at', `${periodEndPlusOne}T00:00:00`);
              countByPeriod.set(period.id, count || 1);
            }
          })
        );

        // 3. 既存レコードの is_billed を一括取得（upsert で誤って false に戻さないため保持）
        const itemIds = linkedItems.map((it) => it.id);
        const { data: existingBillings } = await supabase
          .from('student_billings')
          .select('billing_item_id, is_billed')
          .eq('student_id', studentId)
          .in('billing_item_id', itemIds);
        const billedMap = new Map<string, boolean>(
          (existingBillings || []).map((r) => [r.billing_item_id, r.is_billed])
        );

        // 4. 1回の upsert でまとめて反映
        const payload = linkedItems.map((item) => ({
          school_id: response.school_id,
          student_id: studentId,
          billing_item_id: item.id,
          is_billed: billedMap.get(item.id) ?? false,
          value_number: countByPeriod.get(item.billing_period_id) || 1,
        }));
        await supabase
          .from('student_billings')
          .upsert(payload, { onConflict: 'student_id,billing_item_id' });
      }
    }
  } catch (billingErr) {
    console.warn('Billing auto-sync failed (non-critical):', billingErr);
  }

  return updated as FormResponse;
}

/**
 * フォーム回答の生徒紐付けを解除
 */
export async function unlinkResponseFromStudent(responseId: string): Promise<FormResponse> {
  const { data: updated, error } = await supabase
    .from('form_responses')
    .update({
      linked_student_id: null,
      linked_at: null,
    })
    .eq('id', responseId)
    .select()
    .single();

  if (error) {
    throw new Error(`紐付けの解除に失敗しました: ${error.message}`);
  }

  return updated as FormResponse;
}

/**
 * フォーム回答を更新
 */
export async function updateFormResponse(
  id: string,
  data: FormResponseUpdate
): Promise<FormResponse> {
  const { data: updated, error } = await supabase
    .from('form_responses')
    .update(data)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw new Error(`フォーム回答の更新に失敗しました: ${error.message}`);
  }

  return updated as FormResponse;
}

/**
 * 回答を個別アーカイブ
 */
export async function archiveResponse(id: string): Promise<void> {
  const { error } = await supabase
    .from('form_responses')
    .update({
      is_archived: true,
      archived_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) {
    throw new Error(`アーカイブに失敗しました: ${error.message}`);
  }
}

/**
 * 回答のアーカイブを解除
 */
export async function unarchiveResponse(id: string): Promise<void> {
  const { error } = await supabase
    .from('form_responses')
    .update({
      is_archived: false,
      archived_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) {
    throw new Error(`アーカイブ解除に失敗しました: ${error.message}`);
  }
}

/**
 * 複数回答を一括アーカイブ
 */
export async function archiveResponses(ids: string[]): Promise<void> {
  const { error } = await supabase
    .from('form_responses')
    .update({
      is_archived: true,
      archived_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .in('id', ids);

  if (error) {
    throw new Error(`一括アーカイブに失敗しました: ${error.message}`);
  }
}

/**
 * 期間内の全回答をアーカイブ
 */
export async function archiveResponsesByPeriod(
  schoolId: string,
  formType: FormType,
  periodKey: string
): Promise<number> {
  const { data, error } = await supabase
    .from('form_responses')
    .update({
      is_archived: true,
      archived_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('school_id', schoolId)
    .eq('form_type', formType)
    .eq('form_period', periodKey)
    .eq('is_archived', false)
    .select('id');

  if (error) {
    throw new Error(`期間アーカイブに失敗しました: ${error.message}`);
  }
  return data?.length || 0;
}

/**
 * 期間内の全回答のアーカイブを解除
 */
export async function unarchiveResponsesByPeriod(
  schoolId: string,
  formType: FormType,
  periodKey: string
): Promise<number> {
  const { data, error } = await supabase
    .from('form_responses')
    .update({
      is_archived: false,
      archived_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('school_id', schoolId)
    .eq('form_type', formType)
    .eq('form_period', periodKey)
    .eq('is_archived', true)
    .select('id');

  if (error) {
    throw new Error(`期間アーカイブ解除に失敗しました: ${error.message}`);
  }
  return data?.length || 0;
}

/**
 * アーカイブ済み回答数を取得
 */
export async function getArchivedCount(
  schoolId: string | string[],
  formType: FormType,
  periodKey?: string
): Promise<number> {
  const schoolIds = Array.isArray(schoolId) ? schoolId : [schoolId];
  let query = supabase
    .from('form_responses')
    .select('id', { count: 'exact', head: true })
    .in('school_id', schoolIds)
    .eq('form_type', formType)
    .eq('is_archived', true);

  if (periodKey) {
    query = query.eq('form_period', periodKey);
  }

  const { count, error } = await query;

  if (error) {
    throw new Error(`アーカイブ数の取得に失敗しました: ${error.message}`);
  }
  return count || 0;
}

/**
 * フォーム回答を完全に削除（1件）
 * アーカイブと異なり物理削除のため、UI側でマネージャー以上に限定すること。
 */
export async function deleteFormResponse(id: string): Promise<void> {
  const { error } = await supabase.from('form_responses').delete().eq('id', id);

  if (error) {
    throw new Error(`回答の削除に失敗しました: ${error.message}`);
  }
}

/**
 * 複数のフォーム回答を一括で完全削除
 * アーカイブと異なり物理削除のため、UI側でマネージャー以上に限定すること。
 */
export async function deleteResponses(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase.from('form_responses').delete().in('id', ids);

  if (error) {
    throw new Error(`回答の一括削除に失敗しました: ${error.message}`);
  }
}

/**
 * フォームIDで回答をアーカイブ（formsテーブル用）
 */
export async function archiveResponsesByFormId(formId: string): Promise<number> {
  const { data, error } = await supabase
    .from('form_responses')
    .update({
      is_archived: true,
      archived_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('form_id', formId)
    .eq('is_archived', false)
    .select('id');

  if (error) {
    throw new Error(`フォーム回答のアーカイブに失敗しました: ${error.message}`);
  }
  return data?.length || 0;
}

/**
 * フォームIDで回答のアーカイブを解除（formsテーブル用）
 */
export async function unarchiveResponsesByFormId(formId: string): Promise<number> {
  const { data, error } = await supabase
    .from('form_responses')
    .update({
      is_archived: false,
      archived_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('form_id', formId)
    .eq('is_archived', true)
    .select('id');

  if (error) {
    throw new Error(`フォーム回答のアーカイブ解除に失敗しました: ${error.message}`);
  }
  return data?.length || 0;
}
