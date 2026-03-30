import { supabase } from '../supabase';
import type { CourseTemplate, SeasonType } from '@/types/database';

// 新規テーブルは生成型に未反映のため any キャスト
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/**
 * テンプレート一覧取得
 */
export async function getTemplates(
  type?: 'schedule' | 'progress',
  season?: SeasonType
): Promise<CourseTemplate[]> {
  let query = supabase
    .from('course_prep_templates')
    .select('*')
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: false });

  if (type) {
    query = query.eq('template_type', type);
  }
  if (season) {
    query = query.or(`season.eq.${season},season.is.null`);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`テンプレートの取得に失敗しました: ${error.message}`);
  }

  return (data || []) as CourseTemplate[];
}

/**
 * テンプレートから進捗管理項目を初期化
 */
export async function initializeProgressFromTemplate(
  schoolId: string,
  season: SeasonType,
  year: number,
  templateId: string
): Promise<void> {
  // テンプレート取得
  const { data: template, error: templateError } = await db
    .from('course_prep_templates')
    .select('*')
    .eq('id', templateId)
    .single();

  if (templateError || !template) {
    throw new Error(`テンプレートの取得に失敗しました: ${templateError?.message || 'テンプレートが見つかりません'}`);
  }

  const items = template.template_data as Array<{
    name: string;
    column_type: string;
    sort_order: number;
    column_group?: string;
  }>;

  if (!items || items.length === 0) {
    throw new Error('テンプレートに項目がありません');
  }

  // 既存項目があるか確認
  const { data: existing } = await db
    .from('course_prep_progress_items')
    .select('id')
    .eq('school_id', schoolId)
    .eq('season', season)
    .eq('year', year)
    .limit(1);

  if (existing && existing.length > 0) {
    throw new Error('既に項目が存在します。テンプレートを適用するには既存の項目を削除してください。');
  }

  // 一括挿入
  const insertData = items.map((item) => ({
    school_id: schoolId,
    season,
    year,
    name: item.name,
    column_type: item.column_type || 'check',
    sort_order: item.sort_order,
    column_group: item.column_group || null,
  }));

  const { error: insertError } = await db
    .from('course_prep_progress_items')
    .insert(insertData);

  if (insertError) {
    throw new Error(`テンプレートの適用に失敗しました: ${insertError.message}`);
  }
}

/**
 * テンプレートから工程表タスクを初期化
 */
export async function initializeScheduleFromTemplate(
  schoolId: string,
  season: SeasonType,
  year: number,
  templateId: string
): Promise<void> {
  const { data: template, error: templateError } = await db
    .from('course_prep_templates')
    .select('*')
    .eq('id', templateId)
    .single();

  if (templateError || !template) {
    throw new Error(`テンプレートの取得に失敗しました: ${templateError?.message || 'テンプレートが見つかりません'}`);
  }

  const tasks = template.template_data as Array<{
    major_category: string;
    name: string;
    description?: string;
    sort_order: number;
  }>;

  if (!tasks || tasks.length === 0) {
    throw new Error('テンプレートにタスクがありません');
  }

  const { data: existing } = await db
    .from('course_prep_schedule_tasks')
    .select('id')
    .eq('school_id', schoolId)
    .eq('season', season)
    .eq('year', year)
    .limit(1);

  if (existing && existing.length > 0) {
    throw new Error('既にタスクが存在します。テンプレートを適用するには既存のタスクを削除してください。');
  }

  const insertData = tasks.map((task) => ({
    school_id: schoolId,
    season,
    year,
    major_category: task.major_category,
    name: task.name,
    description: task.description || null,
    sort_order: task.sort_order,
  }));

  const { error: insertError } = await db
    .from('course_prep_schedule_tasks')
    .insert(insertData);

  if (insertError) {
    throw new Error(`テンプレートの適用に失敗しました: ${insertError.message}`);
  }
}

/**
 * 現在の設定をテンプレートとして保存
 */
export async function saveCurrentAsTemplate(
  schoolId: string,
  season: SeasonType,
  year: number,
  type: 'schedule' | 'progress',
  name: string
): Promise<CourseTemplate> {
  let templateData: Record<string, unknown>[];

  if (type === 'progress') {
    const { data: items, error } = await db
      .from('course_prep_progress_items')
      .select('name, column_type, sort_order, column_group')
      .eq('school_id', schoolId)
      .eq('season', season)
      .eq('year', year)
      .or('is_hidden.eq.false,is_hidden.is.null')
      .order('sort_order');

    if (error) throw new Error(`項目の取得に失敗しました: ${error.message}`);
    templateData = (items || []) as Record<string, unknown>[];
  } else {
    const { data: tasks, error } = await db
      .from('course_prep_schedule_tasks')
      .select('major_category, name, description, sort_order')
      .eq('school_id', schoolId)
      .eq('season', season)
      .eq('year', year)
      .order('sort_order');

    if (error) throw new Error(`タスクの取得に失敗しました: ${error.message}`);
    templateData = (tasks || []) as Record<string, unknown>[];
  }

  const { data, error } = await db
    .from('course_prep_templates')
    .insert({
      school_id: schoolId,
      template_type: type,
      season,
      name,
      template_data: templateData,
      is_default: false,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`テンプレートの保存に失敗しました: ${error.message}`);
  }

  return data as CourseTemplate;
}

/**
 * テンプレートを削除
 */
export async function deleteTemplate(id: string): Promise<void> {
  const { error } = await db
    .from('course_prep_templates')
    .delete()
    .eq('id', id)
    .eq('is_default', false); // デフォルトテンプレートは削除不可

  if (error) {
    throw new Error(`テンプレートの削除に失敗しました: ${error.message}`);
  }
}
