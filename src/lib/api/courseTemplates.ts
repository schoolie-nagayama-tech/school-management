import { callCoursePrepApi, fetchCoursePrepApi } from './coursePrepApi';
import type { CourseTemplate, SeasonType } from '@/types/database';

/**
 * テンプレート一覧取得（サーバーAPI経由）
 * NOTE: テンプレートはschool_id=NULLのものもあるため、schoolIdにはダミーで任意のアクセス可能な教室IDを渡す
 */
export async function getTemplates(
  type?: 'schedule' | 'progress',
  season?: SeasonType,
  schoolId?: string
): Promise<CourseTemplate[]> {
  // schoolIdが不明な場合は空で渡す（API側でschoolId必須なので、呼び出し元で渡す）
  if (!schoolId) {
    // フォールバック: schoolIdなしでは取得できないので空配列
    return [];
  }
  const params: Record<string, string> = { schoolId };
  if (type) params.templateType = type;
  if (season) params.season = season;

  const result = await fetchCoursePrepApi('get_templates', params);
  return (result.data || []) as CourseTemplate[];
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
 * 現在の設定をテンプレートとして保存（サーバーAPI経由）
 */
export async function saveCurrentAsTemplate(
  schoolId: string,
  season: SeasonType,
  year: number,
  type: 'schedule' | 'progress',
  name: string
): Promise<CourseTemplate> {
  const result = await callCoursePrepApi('save_template', schoolId, {
    season,
    year,
    templateType: type,
    name,
  });
  return result.data as CourseTemplate;
}

/**
 * テンプレートを削除（サーバーAPI経由）
 */
export async function deleteTemplate(id: string, schoolId: string): Promise<void> {
  await callCoursePrepApi('delete_template', schoolId, { templateId: id });
}
