import { supabase } from '../supabase';
import type {
  ScheduleTask,
  ScheduleMarker,
  ScheduleTaskWithMarkers,
  SeasonType,
} from '@/types/database';

// 新規テーブルは生成型に未反映のため any キャスト
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
  const { data: existing } = await db
    .from('course_prep_schedule_tasks')
    .select('sort_order')
    .eq('school_id', schoolId)
    .eq('season', season)
    .eq('year', year)
    .order('sort_order', { ascending: false })
    .limit(1);

  const maxSort = existing && existing.length > 0 ? existing[0].sort_order : -1;

  const { data, error } = await db
    .from('course_prep_schedule_tasks')
    .insert({
      school_id: schoolId,
      season,
      year,
      major_category: task.major_category,
      name: task.name,
      description: task.description || null,
      start_date: task.start_date || null,
      end_date: task.end_date || null,
      sort_order: maxSort + 1,
    })
    .select()
    .single();

  if (error) throw new Error(`タスクの作成に失敗しました: ${error.message}`);
  return data as ScheduleTask;
}

export async function updateScheduleTask(
  id: string,
  updates: Partial<Pick<ScheduleTask, 'major_category' | 'name' | 'description' | 'start_date' | 'end_date' | 'is_completed' | 'sort_order'>>
): Promise<ScheduleTask> {
  const { data, error } = await db
    .from('course_prep_schedule_tasks')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error(`タスクの更新に失敗しました: ${error.message}`);
  return data as ScheduleTask;
}

export async function deleteScheduleTask(id: string): Promise<void> {
  const { error } = await db
    .from('course_prep_schedule_tasks')
    .delete()
    .eq('id', id);

  if (error) throw new Error(`タスクの削除に失敗しました: ${error.message}`);
}

// =============================================
// マーカー
// =============================================

export async function upsertScheduleMarker(
  taskId: string,
  date: string,
  label: string,
  color?: string | null
): Promise<ScheduleMarker> {
  const { data: existing } = await db
    .from('course_prep_schedule_markers')
    .select('id')
    .eq('task_id', taskId)
    .eq('marker_date', date)
    .maybeSingle();

  if (existing) {
    const { data, error } = await db
      .from('course_prep_schedule_markers')
      .update({ label, color: color || null, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
      .select()
      .single();

    if (error) throw new Error(`マーカーの更新に失敗しました: ${error.message}`);
    return data as ScheduleMarker;
  } else {
    const { data, error } = await db
      .from('course_prep_schedule_markers')
      .insert({ task_id: taskId, marker_date: date, label, color: color || null })
      .select()
      .single();

    if (error) throw new Error(`マーカーの作成に失敗しました: ${error.message}`);
    return data as ScheduleMarker;
  }
}

export async function deleteScheduleMarker(
  taskId: string,
  date: string
): Promise<void> {
  const { error } = await db
    .from('course_prep_schedule_markers')
    .delete()
    .eq('task_id', taskId)
    .eq('marker_date', date);

  if (error) throw new Error(`マーカーの削除に失敗しました: ${error.message}`);
}
