import { supabase } from '../supabase';
import type {
  FormResponse,
  FormResponseInsert,
  FormResponseUpdate,
  FormType,
  Student,
} from '@/types/database';
import { getDefaultSchoolId } from './schools';
import { getStudents } from './students';

// ============================================
// フォーム回答関連
// ============================================

export interface FormResponseFilters {
  formType?: FormType;
  formPeriod?: string;
  grade?: number;
  linkedStatus?: 'all' | 'linked' | 'unlinked';
}

export interface FormResponseWithStudent extends FormResponse {
  linked_student?: Student | null;
}

/**
 * フォーム回答一覧を取得（紐付け済み生徒情報も含む）
 */
export async function getFormResponses(
  schoolId?: string,
  filters?: FormResponseFilters
): Promise<FormResponseWithStudent[]> {
  const targetSchoolId = schoolId || getDefaultSchoolId();

  let query = supabase
    .from('form_responses')
    .select('*')
    .eq('school_id', targetSchoolId);

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

  query = query.order('created_at', { ascending: false });

  const { data, error } = await query;

  if (error) {
    throw new Error(`フォーム回答一覧の取得に失敗しました: ${error.message}`);
  }

  const responses = (data || []) as FormResponse[];

  // 紐付け済みの生徒IDを取得
  const linkedStudentIds = responses
    .map((r) => r.linked_student_id)
    .filter((id): id is string => id !== null);

  // 紐付け済みの生徒情報を取得
  let studentsMap = new Map<string, Student>();
  if (linkedStudentIds.length > 0) {
    try {
      const allStudents = await getStudents();
      linkedStudentIds.forEach((id) => {
        const student = allStudents.find((s) => s.id === id);
        if (student) {
          studentsMap.set(id, student);
        }
      });
    } catch (error) {
      console.error('Error fetching linked students:', error);
      // エラーが発生しても続行
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

// 以下は既存のコードと同じ
/**
 * フォーム回答を1件取得
 */
export async function getFormResponse(id: string): Promise<FormResponse | null> {
  const { data, error } = await supabase
    .from('form_responses')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    throw new Error(`フォーム回答の取得に失敗しました: ${error.message}`);
  }

  return data as FormResponse;
}

/**
 * フォーム回答を作成
 */
export async function createFormResponse(
  data: FormResponseInsert
): Promise<FormResponse> {
  const { data: created, error } = await supabase
    .from('form_responses')
    .insert(data)
    .select()
    .single();

  if (error) {
    throw new Error(`フォーム回答の作成に失敗しました: ${error.message}`);
  }

  return created as FormResponse;
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
          await updateStudentApplication(
            studentId,
            period.linked_application_item_id,
            'completed'
          );
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

  return updated as FormResponse;
}

/**
 * フォーム回答の生徒紐付けを解除
 */
export async function unlinkResponseFromStudent(
  responseId: string
): Promise<FormResponse> {
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
