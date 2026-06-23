import { supabase } from '../supabase';
import type {
  FormTemplate,
  FormTemplateInsert,
  FormTemplateUpdate,
  FormTemplateField,
  FormTemplateFieldInsert,
  FormTemplateFieldUpdate,
  FormTemplateWithFields,
  Form,
  FormInsert,
  FormUpdate,
  FormField,
  FormFieldInsert,
  FormFieldUpdate,
  FormWithFields,
  FormStatus,
  FormResponse,
} from '@/types/database';
import { getDefaultSchoolId } from './schools';

// ============================================
// テンプレート関連
// ============================================

/**
 * テンプレート一覧を取得
 */
export async function getFormTemplates(schoolId?: string): Promise<FormTemplate[]> {
  const targetSchoolId = schoolId || getDefaultSchoolId();

  const { data, error } = await supabase
    .from('form_templates')
    .select('*')
    .eq('school_id', targetSchoolId)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`テンプレート一覧の取得に失敗しました: ${error.message}`);
  }

  return (data || []) as FormTemplate[];
}

/**
 * テンプレート詳細を取得（項目含む）
 */
export async function getFormTemplate(id: string): Promise<FormTemplateWithFields> {
  const { data: template, error: templateError } = await supabase
    .from('form_templates')
    .select('*')
    .eq('id', id)
    .single();

  if (templateError) {
    throw new Error(`テンプレートの取得に失敗しました: ${templateError.message}`);
  }

  const { data: fields, error: fieldsError } = await supabase
    .from('form_template_fields')
    .select('*')
    .eq('template_id', id)
    .order('sort_order', { ascending: true });

  if (fieldsError) {
    throw new Error(`テンプレート項目の取得に失敗しました: ${fieldsError.message}`);
  }

  return {
    ...(template as FormTemplate),
    fields: (fields || []) as FormTemplateField[],
  };
}

/**
 * テンプレートを作成
 */
export async function createFormTemplate(
  template: Omit<FormTemplateInsert, 'school_id'>
): Promise<FormTemplate> {
  const schoolId = getDefaultSchoolId();

  const { data, error } = await supabase
    .from('form_templates')
    .insert({
      ...template,
      school_id: schoolId,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`テンプレートの作成に失敗しました: ${error.message}`);
  }

  return data as FormTemplate;
}

/**
 * テンプレートを更新
 */
export async function updateFormTemplate(
  id: string,
  updates: FormTemplateUpdate
): Promise<FormTemplate> {
  const { data, error } = await supabase
    .from('form_templates')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw new Error(`テンプレートの更新に失敗しました: ${error.message}`);
  }

  return data as FormTemplate;
}

/**
 * テンプレートを削除
 */
export async function deleteFormTemplate(id: string): Promise<void> {
  const { error } = await supabase.from('form_templates').delete().eq('id', id);

  if (error) {
    throw new Error(`テンプレートの削除に失敗しました: ${error.message}`);
  }
}

/**
 * テンプレート項目を追加
 */
export async function createFormTemplateField(
  field: Omit<FormTemplateFieldInsert, 'sort_order'>
): Promise<FormTemplateField> {
  // 最大のsort_orderを取得
  const { data: existingFields } = await supabase
    .from('form_template_fields')
    .select('sort_order')
    .eq('template_id', field.template_id)
    .order('sort_order', { ascending: false })
    .limit(1);

  const maxSortOrder =
    existingFields && existingFields.length > 0 ? existingFields[0].sort_order : -1;

  const { data, error } = await supabase
    .from('form_template_fields')
    .insert({
      ...field,
      options:
        field.options != null ? (field.options as Record<string, unknown> | string[]) : undefined,
      sort_order: maxSortOrder + 1,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`テンプレート項目の追加に失敗しました: ${error.message}`);
  }

  return data as FormTemplateField;
}

/**
 * テンプレート項目を更新
 */
export async function updateFormTemplateField(
  id: string,
  updates: FormTemplateFieldUpdate
): Promise<FormTemplateField> {
  const { data, error } = await supabase
    .from('form_template_fields')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw new Error(`テンプレート項目の更新に失敗しました: ${error.message}`);
  }

  return data as FormTemplateField;
}

/**
 * テンプレート項目を削除
 */
export async function deleteFormTemplateField(id: string): Promise<void> {
  const { error } = await supabase.from('form_template_fields').delete().eq('id', id);

  if (error) {
    throw new Error(`テンプレート項目の削除に失敗しました: ${error.message}`);
  }
}

/**
 * テンプレート項目の並び順を更新
 */
export async function reorderFormTemplateFields(
  templateId: string,
  fieldIds: string[]
): Promise<void> {
  const updates = fieldIds.map((fieldId, index) =>
    supabase
      .from('form_template_fields')
      .update({ sort_order: index })
      .eq('id', fieldId)
      .eq('template_id', templateId)
  );

  const results = await Promise.all(updates);
  const errors = results.filter((r) => r.error);

  if (errors.length > 0) {
    throw new Error(`並び順の更新に失敗しました: ${errors[0].error?.message}`);
  }
}

// ============================================
// フォーム関連
// ============================================

/**
 * フォーム一覧を取得
 */
export async function getForms(
  schoolId?: string,
  includeArchived: boolean = false
): Promise<Form[]> {
  const targetSchoolId = schoolId || getDefaultSchoolId();

  let query = supabase.from('forms').select('*').eq('school_id', targetSchoolId);

  if (!includeArchived) {
    query = query.eq('is_archived', false);
  }

  query = query.order('created_at', { ascending: false });

  const { data, error } = await query;

  if (error) {
    throw new Error(`フォーム一覧の取得に失敗しました: ${error.message}`);
  }

  return (data || []) as Form[];
}

/**
 * フォーム詳細を取得（項目含む）
 */
export async function getForm(id: string): Promise<FormWithFields> {
  const { data: form, error: formError } = await supabase
    .from('forms')
    .select('*')
    .eq('id', id)
    .single();

  if (formError) {
    throw new Error(`フォームの取得に失敗しました: ${formError.message}`);
  }

  const { data: fields, error: fieldsError } = await supabase
    .from('form_fields')
    .select('*')
    .eq('form_id', id)
    .order('sort_order', { ascending: true });

  if (fieldsError) {
    throw new Error(`フォーム項目の取得に失敗しました: ${fieldsError.message}`);
  }

  return {
    ...(form as Form),
    fields: (fields || []) as FormField[],
  };
}

/**
 * テンプレートからフォームを作成
 */
export async function createFormFromTemplate(
  templateId: string,
  formData: Omit<FormInsert, 'school_id' | 'template_id'>
): Promise<FormWithFields> {
  const schoolId = getDefaultSchoolId();

  // テンプレートと項目を取得
  const template = await getFormTemplate(templateId);

  // フォームを作成
  const { data: form, error: formError } = await supabase
    .from('forms')
    .insert({
      ...formData,
      school_id: schoolId,
      template_id: templateId,
    })
    .select()
    .single();

  if (formError) {
    throw new Error(`フォームの作成に失敗しました: ${formError.message}`);
  }

  // テンプレート項目をフォーム項目にコピー
  const formTyped = form as Form;
  if (template.fields.length > 0) {
    const fieldInserts: FormFieldInsert[] = template.fields.map((field) => ({
      form_id: formTyped.id,
      field_type: field.field_type,
      label: field.label,
      placeholder: field.placeholder,
      options: field.options,
      is_required: field.is_required,
      sort_order: field.sort_order,
    }));

    const { error: fieldsError } = await supabase.from('form_fields').insert(fieldInserts);

    if (fieldsError) {
      throw new Error(`フォーム項目の作成に失敗しました: ${fieldsError.message}`);
    }
  }

  return getForm(formTyped.id);
}

/**
 * フォームを新規作成（テンプレートなし）
 */
export async function createForm(form: Omit<FormInsert, 'school_id'>): Promise<Form> {
  const schoolId = getDefaultSchoolId();

  const { data, error } = await supabase
    .from('forms')
    .insert({
      ...form,
      school_id: schoolId,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`フォームの作成に失敗しました: ${error.message}`);
  }

  return data as Form;
}

/**
 * フォームを更新
 */
export async function updateForm(id: string, updates: FormUpdate): Promise<Form> {
  const { data, error } = await supabase
    .from('forms')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw new Error(`フォームの更新に失敗しました: ${error.message}`);
  }

  return data as Form;
}

/**
 * フォームを削除
 */
export async function deleteForm(id: string): Promise<void> {
  const { error } = await supabase.from('forms').delete().eq('id', id);

  if (error) {
    throw new Error(`フォームの削除に失敗しました: ${error.message}`);
  }
}

/**
 * フォームの状態を変更
 */
export async function updateFormStatus(id: string, status: FormStatus): Promise<Form> {
  return updateForm(id, { status });
}

/**
 * フォームをアーカイブ（回答も自動アーカイブ）
 */
export async function archiveForm(id: string): Promise<{ form: Form; responsesArchived: number }> {
  // フォームを取得（存在確認）
  await getForm(id);

  // フォームをアーカイブ
  const { data, error } = await supabase
    .from('forms')
    .update({
      is_archived: true,
      archived_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw new Error(`フォームのアーカイブに失敗しました: ${error.message}`);
  }

  // このフォームに関連する回答もアーカイブ
  const { archiveResponsesByFormId } = await import('./form-responses');
  const responsesArchived = await archiveResponsesByFormId(id);

  return { form: data as Form, responsesArchived };
}

/**
 * フォームのアーカイブを解除（回答も自動アーカイブ解除）
 */
export async function unarchiveForm(
  id: string
): Promise<{ form: Form; responsesUnarchived: number }> {
  // フォームのアーカイブを解除
  const { data, error } = await supabase
    .from('forms')
    .update({
      is_archived: false,
      archived_at: null,
    })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw new Error(`フォームのアーカイブ解除に失敗しました: ${error.message}`);
  }

  // このフォームに関連する回答もアーカイブ解除
  const { unarchiveResponsesByFormId } = await import('./form-responses');
  const responsesUnarchived = await unarchiveResponsesByFormId(id);

  return { form: data as Form, responsesUnarchived };
}

/**
 * フォーム項目を追加
 */
export async function createFormField(
  field: Omit<FormFieldInsert, 'sort_order'>
): Promise<FormField> {
  // 最大のsort_orderを取得
  const { data: existingFields } = await supabase
    .from('form_fields')
    .select('sort_order')
    .eq('form_id', field.form_id)
    .order('sort_order', { ascending: false })
    .limit(1);

  const maxSortOrder =
    existingFields && existingFields.length > 0 ? existingFields[0].sort_order : -1;

  const { data, error } = await supabase
    .from('form_fields')
    .insert({
      ...field,
      sort_order: maxSortOrder + 1,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`フォーム項目の追加に失敗しました: ${error.message}`);
  }

  return data as FormField;
}

/**
 * フォーム項目を更新
 */
export async function updateFormField(id: string, updates: FormFieldUpdate): Promise<FormField> {
  const { data, error } = await supabase
    .from('form_fields')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw new Error(`フォーム項目の更新に失敗しました: ${error.message}`);
  }

  return data as FormField;
}

/**
 * フォーム項目を削除
 */
export async function deleteFormField(id: string): Promise<void> {
  const { error } = await supabase.from('form_fields').delete().eq('id', id);

  if (error) {
    throw new Error(`フォーム項目の削除に失敗しました: ${error.message}`);
  }
}

/**
 * フォーム項目の並び順を更新
 */
export async function reorderFormFields(formId: string, fieldIds: string[]): Promise<void> {
  const updates = fieldIds.map((fieldId, index) =>
    supabase
      .from('form_fields')
      .update({ sort_order: index })
      .eq('id', fieldId)
      .eq('form_id', formId)
  );

  const results = await Promise.all(updates);
  const errors = results.filter((r) => r.error);

  if (errors.length > 0) {
    throw new Error(`並び順の更新に失敗しました: ${errors[0].error?.message}`);
  }
}

// ============================================
// ポータル関連
// ============================================

/**
 * 公開中フォーム一覧を取得（学校コードで絞り込み）
 */
export async function getPublishedForms(schoolCode: string): Promise<Form[]> {
  const now = new Date().toISOString();

  // まず学校IDを取得
  const { data: school, error: schoolError } = await supabase
    .from('schools')
    .select('id')
    .eq('code', schoolCode)
    .single();

  if (schoolError || !school) {
    throw new Error(`教室が見つかりません: ${schoolCode}`);
  }

  const { data, error } = await supabase
    .from('forms')
    .select('*')
    .eq('school_id', school.id)
    .eq('status', 'published')
    .eq('is_archived', false)
    .or(`publish_start.is.null,publish_start.lte.${now}`)
    .or(`publish_end.is.null,publish_end.gte.${now}`)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`公開フォーム一覧の取得に失敗しました: ${error.message}`);
  }

  // 公開期間でフィルタリング（SupabaseのOR条件が複雑なので、クライアント側でも確認）
  const typedData = (data || []) as Form[];
  const filtered = typedData.filter((form) => {
    // アーカイブされたフォームは除外
    if (form.is_archived) return false;
    // statusがpublishedでないフォームは除外
    if (form.status !== 'published') return false;

    const start = form.publish_start ? new Date(form.publish_start) : null;
    const end = form.publish_end ? new Date(form.publish_end) : null;
    const nowDate = new Date();

    if (start && nowDate < start) return false;
    if (end && nowDate > end) return false;
    return true;
  });

  return filtered;
}

/**
 * スラッグでフォームを取得（公開チェック付き）
 */
export async function getFormBySlug(
  schoolCode: string,
  slug: string
): Promise<FormWithFields | null> {
  // まず学校IDを取得
  const { data: school, error: schoolError } = await supabase
    .from('schools')
    .select('id')
    .eq('code', schoolCode)
    .single();

  if (schoolError || !school) {
    throw new Error(`教室が見つかりません: ${schoolCode}`);
  }

  const { data: form, error: formError } = await supabase
    .from('forms')
    .select('*')
    .eq('school_id', school.id)
    .eq('slug', slug)
    .eq('is_archived', false)
    .single();

  if (formError || !form) {
    return null;
  }

  const formTyped = form as Form;
  // 公開チェック
  const now = new Date();
  const start = formTyped.publish_start ? new Date(formTyped.publish_start) : null;
  const end = formTyped.publish_end ? new Date(formTyped.publish_end) : null;

  if (formTyped.status !== 'published' || formTyped.is_archived) {
    return null;
  }
  if (start && now < start) {
    return null;
  }
  if (end && now > end) {
    return null;
  }

  // フィールドを取得
  const { data: fields, error: fieldsError } = await supabase
    .from('form_fields')
    .select('*')
    .eq('form_id', formTyped.id)
    .order('sort_order', { ascending: true });

  if (fieldsError) {
    throw new Error(`フォーム項目の取得に失敗しました: ${fieldsError.message}`);
  }

  return {
    ...(formTyped as Form),
    fields: (fields || []) as FormField[],
  };
}

// ============================================
// 回答関連
// ============================================

/**
 * フォーム回答を送信
 */
export async function submitFormResponse(
  formId: string,
  response: {
    student_name: string;
    grade: number | null;
    email: string | null;
    answers: Record<string, unknown>;
  }
): Promise<void> {
  // フォームを取得してschool_idを確認
  const { data: form, error: formError } = await supabase
    .from('forms')
    .select('school_id')
    .eq('id', formId)
    .single();

  if (formError || !form) {
    throw new Error(`フォームが見つかりません`);
  }

  const formRow = form as { school_id: string };
  const insertPayload = {
    form_id: formId,
    school_id: formRow.school_id,
    form_type: 'kyozai',
    form_period: 'n/a',
    student_name: response.student_name,
    grade: response.grade ?? 0,
    email: response.email ?? '',
    response_data: response.answers as Record<string, unknown>,
  };
  const { error } = await supabase.from('form_responses').insert(insertPayload);

  if (error) {
    throw new Error(`回答の送信に失敗しました: ${error.message}`);
  }
}

// フォーム回答型（form_idベースのフォーム用）
type FormResponseRow = FormResponse & { form_id?: string | null };

/**
 * 回答一覧を取得（フィルター対応）
 */
export async function getFormResponses(
  formId: string,
  filters?: {
    grade?: number | null;
    linked?: boolean | null;
  }
): Promise<FormResponse[]> {
  let query = supabase
    .from('form_responses')
    .select('*')
    .eq('form_id', formId)
    .order('created_at', { ascending: false });

  if (filters?.grade !== undefined && filters.grade !== null) {
    query = query.eq('grade', filters.grade);
  }

  if (filters?.linked === true) {
    query = query.not('linked_student_id', 'is', null);
  } else if (filters?.linked === false) {
    query = query.is('linked_student_id', null);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`回答一覧の取得に失敗しました: ${error.message}`);
  }

  return (data || []) as FormResponse[];
}

/**
 * 回答詳細を取得
 */
export async function getFormResponse(id: string): Promise<FormResponse> {
  const { data, error } = await supabase.from('form_responses').select('*').eq('id', id).single();

  if (error) {
    throw new Error(`回答の取得に失敗しました: ${error.message}`);
  }

  return data as FormResponse;
}

/**
 * 回答を生徒に紐付け
 */
export async function linkResponseToStudent(responseId: string, studentId: string): Promise<void> {
  // 回答を取得
  const response = (await getFormResponse(responseId)) as FormResponseRow;

  // フォームを取得（form_idがあれば）
  if (!response.form_id) {
    throw new Error('この回答にはフォームが紐付いていません');
  }
  const form = await getForm(response.form_id);

  // 回答を更新
  const { error: updateError } = await supabase
    .from('form_responses')
    .update({
      linked_student_id: studentId,
      linked_at: new Date().toISOString(),
    })
    .eq('id', responseId);

  if (updateError) {
    throw new Error(`紐付けの更新に失敗しました: ${updateError.message}`);
  }

  // フォームに linked_application_item_id が設定されていれば、申込状況を更新
  if (form.linked_application_item_id) {
    const { updateStudentApplication } = await import('./applications');
    try {
      await updateStudentApplication(studentId, form.linked_application_item_id, 'completed');
    } catch (error) {
      // 申込状況の更新失敗は警告のみ（回答の紐付けは成功扱い）
      console.warn('Failed to update application status:', error);
    }
  }
}

/**
 * 回答の紐付けを解除
 */
export async function unlinkResponseFromStudent(responseId: string): Promise<void> {
  const { error } = await supabase
    .from('form_responses')
    .update({
      linked_student_id: null,
      linked_at: null,
    })
    .eq('id', responseId);

  if (error) {
    throw new Error(`紐付け解除に失敗しました: ${error.message}`);
  }
}
