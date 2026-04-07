import { supabase } from '../supabase';
import type { MonthlyTaskWithChecks, MonthlyTaskTemplate } from '@/types/database';

async function getAccessToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    throw new Error('認証が必要です。ログインし直してください。');
  }
  return session.access_token;
}

// ===================== GET =====================

export async function getMonthlyTasks(year: number, month: number): Promise<MonthlyTaskWithChecks[]> {
  const token = await getAccessToken();
  const params = new URLSearchParams({ action: 'get_monthly_tasks', year: String(year), month: String(month) });
  const res = await fetch(`/api/tasks?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '取得に失敗しました');
  return data.data as MonthlyTaskWithChecks[];
}

export async function getTemplates(): Promise<MonthlyTaskTemplate[]> {
  const token = await getAccessToken();
  const params = new URLSearchParams({ action: 'get_templates' });
  const res = await fetch(`/api/tasks?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '取得に失敗しました');
  return data.data as MonthlyTaskTemplate[];
}

export async function getOverdueSummary(): Promise<{ count: number; tasks: Array<{ id: string; task_date: string; task_name: string; category: string }> }> {
  const token = await getAccessToken();
  const params = new URLSearchParams({ action: 'get_overdue_summary' });
  const res = await fetch(`/api/tasks?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '取得に失敗しました');
  return data.data;
}

// ===================== POST =====================

async function postTaskApi(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const token = await getAccessToken();
  const res = await fetch('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '操作に失敗しました');
  return data;
}

export async function createTask(params: {
  year: number; month: number; task_date: string; category: string; task_name: string; sort_order?: number; note?: string; url?: string;
}) {
  const result = await postTaskApi({ action: 'create_task', ...params });
  return result.data as MonthlyTaskWithChecks;
}

export async function updateTask(taskId: string, updates: Record<string, unknown>, schoolId?: string) {
  const result = await postTaskApi({ action: 'update_task', taskId, updates, ...(schoolId ? { schoolId } : {}) });
  return result.data;
}

export async function deleteTask(taskId: string, schoolId?: string) {
  await postTaskApi({ action: 'delete_task', taskId, ...(schoolId ? { schoolId } : {}) });
}

export async function toggleCheck(taskId: string, schoolId: string, isCompleted: boolean) {
  await postTaskApi({ action: 'toggle_check', taskId, schoolId, isCompleted });
}

export async function updateNote(taskId: string, note: string | null) {
  await postTaskApi({ action: 'update_note', taskId, note });
}

export async function generateFromTemplate(year: number, month: number, templateId: string) {
  const result = await postTaskApi({ action: 'generate_from_template', year, month, templateId });
  return result.data as { created: number };
}

export async function syncCourseTasks(year: number, month: number) {
  const result = await postTaskApi({ action: 'sync_course_tasks', year, month });
  return result.data as { imported: number };
}

export async function deleteCourseTasks(year: number, month: number) {
  const result = await postTaskApi({ action: 'delete_course_tasks', year, month });
  return result as { deleted: number };
}

export async function saveTemplate(year: number, month: number, name: string) {
  const result = await postTaskApi({ action: 'save_template', year, month, name });
  return result.data as MonthlyTaskTemplate;
}

export async function deleteTemplate(templateId: string) {
  await postTaskApi({ action: 'delete_template', templateId });
}
