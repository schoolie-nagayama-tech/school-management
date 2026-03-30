import { supabase } from '../supabase';
import { callCoursePrepApi } from './coursePrepApi';
import type {
  ScheduleTask,
  ScheduleMarker,
  ScheduleTaskWithMarkers,
  SeasonType,
} from '@/types/database';

// 新規テーブルは生成型に未反映のため any キャスト（SELECT用）
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

// =============================================
// 工程表タスク
// =============================================

export async function getScheduleTasks(
  schoolId: string,
  season: SeasonType,
  year: number
): Promise<ScheduleTaskWithMarkers[]> {
  const { data: tasks, error } = await db
    .from('course_prep_schedule_tasks')
    .select('*')
    .eq('school_id', schoolId)
    .eq('season', season)
    .eq('year', year)
    .order('sort_order', { ascending: true });

  if (error) {
    throw new Error(`工程表タスクの取得に失敗しました: ${error.message}`);
  }

  if (!tasks || tasks.length === 0) return [];

  const taskIds = tasks.map((t: ScheduleTask) => t.id);

  const { data: markers, error: markersError } = await db
    .from('course_prep_schedule_markers')
    .select('*')
    .in('task_id', taskIds)
    .order('marker_date', { ascending: true });

  if (markersError) {
    throw new Error(`マーカーの取得に失敗しました: ${markersError.message}`);
  }

  const markersByTask = new Map<string, ScheduleMarker[]>();
  for (const m of (markers || []) as ScheduleMarker[]) {
    if (!markersByTask.has(m.task_id)) markersByTask.set(m.task_id, []);
    markersByTask.get(m.task_id)!.push(m);
  }

  return (tasks as ScheduleTask[]).map((t) => ({
    ...t,
    markers: markersByTask.get(t.id) || [],
  }));
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
  // 現在の最大sort_orderを取得
  const { data: existing } = await db
    .from('course_prep_schedule_tasks')
    .select('sort_order')
    .eq('school_id', schoolId)
    .eq('season', season)
    .eq('year', year)
    .order('sort_order', { ascending: false })
    .limit(1);

  const maxSort = existing && existing.length > 0 ? existing[0].sort_order : -1;

  const result = await callCoursePrepApi('create_schedule_task', schoolId, {
    season,
    year,
    majorCategory: task.major_category,
    name: task.name,
    description: task.description || null,
    sortOrder: maxSort + 1,
  });

  return result.data as ScheduleTask;
}

export async function updateScheduleTask(
  id: string,
  updates: Partial<Pick<ScheduleTask, 'major_category' | 'name' | 'description' | 'start_date' | 'end_date' | 'is_completed' | 'sort_order'>>,
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
