import { supabase } from '../supabase';
import { callCoursePrepApi } from './coursePrepApi';
import type { CourseTemplate, SeasonType } from '@/types/database';

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
 * テンプレートから進捗管理項目を初期化（サーバーAPI経由）
 */
export async function initializeProgressFromTemplate(
  schoolId: string,
  season: SeasonType,
  year: number,
  templateId: string
): Promise<void> {
  await callCoursePrepApi('init_progress_template', schoolId, {
    season,
    year,
    templateId,
  });
}

/**
 * テンプレートから工程表タスクを初期化（サーバーAPI経由）
 */
export async function initializeScheduleFromTemplate(
  schoolId: string,
  season: SeasonType,
  year: number,
  templateId: string
): Promise<void> {
  await callCoursePrepApi('init_schedule_template', schoolId, {
    season,
    year,
    templateId,
  });
}

/**
 * 現在の設定をテンプレートとして保存
 * NOTE: テンプレート保存は頻度が低いため、直接supabaseクライアント経由で実行
 * RLSが問題になる場合はサーバーAPI追加を検討
 */
export async function saveCurrentAsTemplate(
  schoolId: string,
  season: SeasonType,
  year: number,
  type: 'schedule' | 'progress',
  name: string
): Promise<CourseTemplate> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  let templateData: Record<string, unknown>[];

  if (type === 'progress') {
    const { data: items, error } = await db
      .from('course_prep_progress_items')
      .select('name, column_type, sort_order')
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { error } = await db
    .from('course_prep_templates')
    .delete()
    .eq('id', id)
    .eq('is_default', false);

  if (error) {
    throw new Error(`テンプレートの削除に失敗しました: ${error.message}`);
  }
}
