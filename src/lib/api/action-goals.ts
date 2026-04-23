/**
 * 行動目標 (action_goals) API
 * 試験目標 (student_textbook_exams) に紐づく達成行動。
 */

import { createSupabaseBrowserClient } from '@/lib/supabase';
import type { ActionGoal, ActionGoalInsert, ActionGoalUpdate } from '@/types/database';

type AnyClient = ReturnType<typeof createSupabaseBrowserClient>;

function client(): AnyClient {
  return createSupabaseBrowserClient();
}

/** 試験目標に属する行動目標一覧を sort_order 順で取得 */
export async function getActionGoals(examId: string): Promise<ActionGoal[]> {
  const { data, error } = await (client() as any)
    .from('action_goals')
    .select('*')
    .eq('student_textbook_exam_id', examId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as ActionGoal[];
}

/** 複数試験目標の行動目標を一括取得（カード表示で複数 examId 分まとめて） */
export async function getActionGoalsByExams(examIds: string[]): Promise<Record<string, ActionGoal[]>> {
  if (examIds.length === 0) return {};
  const { data, error } = await (client() as any)
    .from('action_goals')
    .select('*')
    .in('student_textbook_exam_id', examIds)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  const map: Record<string, ActionGoal[]> = {};
  for (const g of (data ?? []) as ActionGoal[]) {
    const k = g.student_textbook_exam_id;
    if (!map[k]) map[k] = [];
    map[k].push(g);
  }
  return map;
}

export async function createActionGoal(payload: ActionGoalInsert): Promise<ActionGoal> {
  const { data, error } = await (client() as any)
    .from('action_goals')
    .insert(payload)
    .select('*')
    .single();
  if (error) throw error;
  return data as ActionGoal;
}

export async function updateActionGoal(id: string, patch: ActionGoalUpdate): Promise<ActionGoal> {
  // 達成フラグ更新時は achieved_at を同期
  const final: ActionGoalUpdate = { ...patch };
  if (patch.achieved === true && patch.achieved_at === undefined) {
    final.achieved_at = new Date().toISOString();
  } else if (patch.achieved === false && patch.achieved_at === undefined) {
    final.achieved_at = null;
  }
  const { data, error } = await (client() as any)
    .from('action_goals')
    .update(final)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data as ActionGoal;
}

export async function deleteActionGoal(id: string): Promise<void> {
  const { error } = await (client() as any)
    .from('action_goals')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

/**
 * 過去の試験目標から行動目標一式を複製。
 * achieved/achieved_at/counter_current はリセット、title と counter_target は引き継ぐ。
 */
export async function copyActionGoalsFromExam(
  sourceExamId: string,
  targetExamId: string
): Promise<ActionGoal[]> {
  const sources = await getActionGoals(sourceExamId);
  if (sources.length === 0) return [];
  const payloads: ActionGoalInsert[] = sources.map((g, i) => ({
    student_textbook_exam_id: targetExamId,
    title: g.title,
    counter_target: g.counter_target,
    counter_current: 0,
    achieved: false,
    sort_order: g.sort_order ?? i,
  }));
  const { data, error } = await (client() as any)
    .from('action_goals')
    .insert(payloads)
    .select('*');
  if (error) throw error;
  return (data ?? []) as ActionGoal[];
}
