import { supabase } from '../supabase';
import type { StudentInterview, StudentInterviewInput } from '@/types/database';
import { getDefaultSchoolId } from './schools';

/**
 * 生徒の面談記録一覧を取得（新しい順）
 */
export async function getStudentInterviews(studentId: string): Promise<StudentInterview[]> {
  const { data, error } = await supabase
    .from('student_interviews')
    .select('*')
    .eq('student_id', studentId)
    .order('interview_date', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`面談記録の取得に失敗しました: ${error.message}`);
  }

  return (data || []) as StudentInterview[];
}

/**
 * 面談記録を作成
 */
export async function createInterview(
  schoolId: string,
  studentId: string,
  input: StudentInterviewInput
): Promise<StudentInterview> {
  const { data, error } = await supabase
    .from('student_interviews')
    .insert({
      school_id: schoolId,
      student_id: studentId,
      interview_date: input.interview_date,
      interview_type: input.interview_type,
      content: input.content,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`面談記録の作成に失敗しました: ${error.message}`);
  }

  return data as StudentInterview;
}

/**
 * 面談記録を更新
 */
export async function updateInterview(
  id: string,
  input: StudentInterviewInput
): Promise<StudentInterview> {
  const { data, error } = await supabase
    .from('student_interviews')
    .update({
      interview_date: input.interview_date,
      interview_type: input.interview_type,
      content: input.content,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw new Error(`面談記録の更新に失敗しました: ${error.message}`);
  }

  return data as StudentInterview;
}

/**
 * 面談記録を削除
 */
export async function deleteInterview(id: string): Promise<void> {
  const { error } = await supabase
    .from('student_interviews')
    .delete()
    .eq('id', id);

  if (error) {
    throw new Error(`面談記録の削除に失敗しました: ${error.message}`);
  }
}

/**
 * 教室の全面談記録を取得（最新のもの）
 */
export async function getRecentInterviews(
  schoolId: string,
  limit: number = 20
): Promise<(StudentInterview & { student_name: string })[]> {
  const { data, error } = await supabase
    .from('student_interviews')
    .select(`
      *,
      students!inner(last_name, first_name)
    `)
    .eq('school_id', schoolId)
    .order('interview_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`面談記録の取得に失敗しました: ${error.message}`);
  }

  return (data || []).map((item: any) => ({
    ...item,
    student_name: `${item.students.last_name} ${item.students.first_name}`,
  })) as (StudentInterview & { student_name: string })[];
}

/**
 * 未完了タスク一覧を取得（生徒情報付き）
 */
export async function getPendingTasks(
  schoolId: string
): Promise<(StudentInterview & { student: { last_name: string; first_name: string } })[]> {
  const { data, error } = await supabase
    .from('student_interviews')
    .select(`
      *,
      students!inner(last_name, first_name)
    `)
    .eq('school_id', schoolId)
    .eq('interview_type', 'task')
    .eq('is_completed', false)
    .order('interview_date', { ascending: true });

  if (error) {
    throw new Error(`未完了タスクの取得に失敗しました: ${error.message}`);
  }

  return (data || []).map((item: any) => ({
    ...item,
    student: {
      last_name: item.students.last_name,
      first_name: item.students.first_name,
    },
  })) as (StudentInterview & { student: { last_name: string; first_name: string } })[];
}

/**
 * タスクを完了にする
 */
export async function completeTask(id: string): Promise<void> {
  const { error } = await supabase
    .from('student_interviews')
    .update({
      is_completed: true,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) {
    throw new Error(`タスクの完了に失敗しました: ${error.message}`);
  }
}

/**
 * タスクを未完了に戻す
 */
export async function uncompleteTask(id: string): Promise<void> {
  const { error } = await supabase
    .from('student_interviews')
    .update({
      is_completed: false,
      completed_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) {
    throw new Error(`タスクの未完了への戻しに失敗しました: ${error.message}`);
  }
}
