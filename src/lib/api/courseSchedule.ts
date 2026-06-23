import { callCoursePrepApi, fetchCoursePrepApi } from './coursePrepApi';
import type { ScheduleTask, ScheduleTaskWithMarkers, SeasonType } from '@/types/database';

// =============================================
// 工程表タスク
// =============================================

export async function getScheduleTasks(
  schoolId: string,
  season: SeasonType,
  year: number
): Promise<ScheduleTaskWithMarkers[]> {
  const result = await fetchCoursePrepApi('get_schedule_tasks', {
    schoolId,
    season,
    year: String(year),
  });
  return (result.data || []) as ScheduleTaskWithMarkers[];
}

export async function createScheduleTask(
  schoolId: string,
  season: SeasonType,
  year: number,
  task: {
    major_category: string;
    name: string;
    description?: string;
    start_date?: string | null;
    end_date?: string | null;
  }
): Promise<ScheduleTask> {
  const result = await callCoursePrepApi('create_schedule_task', schoolId, {
    season,
    year,
    majorCategory: task.major_category,
    name: task.name,
    description: task.description || null,
    startDate: task.start_date || null,
    endDate: task.end_date || null,
  });

  return result.data as ScheduleTask;
}

export async function updateScheduleTask(
  id: string,
  updates: Partial<
    Pick<
      ScheduleTask,
      | 'major_category'
      | 'name'
      | 'description'
      | 'start_date'
      | 'end_date'
      | 'is_completed'
      | 'sort_order'
      | 'linked_progress_item_id'
    >
  >,
  schoolId: string
): Promise<void> {
  await callCoursePrepApi('update_schedule_task', schoolId, {
    taskId: id,
    updates,
  });
}

export async function deleteScheduleTask(id: string, schoolId: string): Promise<void> {
  await callCoursePrepApi('delete_schedule_task', schoolId, { taskId: id });
}

// =============================================
// マーカー
// =============================================

export async function upsertScheduleMarker(
  taskId: string,
  date: string,
  label: string,
  color?: string | null,
  schoolId?: string
): Promise<void> {
  if (!schoolId) throw new Error('schoolIdが必要です');
  await callCoursePrepApi('upsert_schedule_marker', schoolId, {
    taskId,
    markerDate: date,
    label,
    color: color || null,
  });
}

export async function deleteScheduleMarker(
  taskId: string,
  date: string,
  schoolId?: string
): Promise<void> {
  if (!schoolId) throw new Error('schoolIdが必要です');
  await callCoursePrepApi('delete_schedule_marker', schoolId, {
    taskId,
    markerDate: date,
  });
}
