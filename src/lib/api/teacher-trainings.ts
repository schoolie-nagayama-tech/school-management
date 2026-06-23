import { supabase } from '../supabase';
import type { TeacherTraining } from '@/types/database';

// Database 型にまだ含まれていないため any キャストで参照
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

// ============================================
// 講師 研修参加履歴
// ============================================

export interface TeacherTrainingInput {
  teacher_id: string;
  title: string;
  period_label?: string | null;
  attended_on?: string | null;
  note?: string | null;
  training_master_id?: string | null;
}

export type TeacherTrainingPatch = Partial<Omit<TeacherTrainingInput, 'teacher_id'>>;

/**
 * 指定講師の研修参加履歴を取得
 * 並び順: attended_on 降順（NULL は末尾）→ created_at 降順
 */
export async function getTeacherTrainings(teacherId: string): Promise<TeacherTraining[]> {
  const { data, error } = await db
    .from('teacher_trainings')
    .select('*')
    .eq('teacher_id', teacherId)
    .order('attended_on', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`研修参加履歴の取得に失敗しました: ${error.message}`);
  }

  return (data || []) as TeacherTraining[];
}

/**
 * 研修参加履歴を1件作成
 */
export async function createTeacherTraining(input: TeacherTrainingInput): Promise<TeacherTraining> {
  const payload = {
    teacher_id: input.teacher_id,
    title: input.title,
    period_label: input.period_label ?? null,
    attended_on: input.attended_on ?? null,
    note: input.note ?? null,
    training_master_id: input.training_master_id ?? null,
  };

  const { data, error } = await db.from('teacher_trainings').insert(payload).select().single();

  if (error) {
    throw new Error(`研修参加履歴の登録に失敗しました: ${error.message}`);
  }

  return data as TeacherTraining;
}

/**
 * 研修参加履歴を更新
 */
export async function updateTeacherTraining(
  id: string,
  patch: TeacherTrainingPatch
): Promise<TeacherTraining> {
  const { data, error } = await db
    .from('teacher_trainings')
    .update(patch)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw new Error(`研修参加履歴の更新に失敗しました: ${error.message}`);
  }

  return data as TeacherTraining;
}

/**
 * 研修参加履歴を削除
 */
export async function deleteTeacherTraining(id: string): Promise<void> {
  const { error } = await db.from('teacher_trainings').delete().eq('id', id);

  if (error) {
    throw new Error(`研修参加履歴の削除に失敗しました: ${error.message}`);
  }
}

/**
 * 現在ログイン中のユーザーの研修参加履歴を取得
 */
export async function getMyTrainings(): Promise<TeacherTraining[]> {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError) {
    throw new Error(`認証情報の取得に失敗しました: ${authError.message}`);
  }
  if (!user) {
    return [];
  }

  return getTeacherTrainings(user.id);
}
