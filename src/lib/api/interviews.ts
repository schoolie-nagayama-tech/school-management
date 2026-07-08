import { supabase } from '../supabase';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, StudentInterview, StudentInterviewInput } from '@/types/database';
import { dismissAlert, invalidateAlertCache } from './alerts';
import { fetchAllPaged } from '@/lib/utils/supabasePaging';

/**
 * 教室単位で面談記録をバッチ取得（アラート用）
 * student_id でグルーピングした Map を返す（各生徒の最新順）
 *
 * @param client - RLS 認証済みのサーバークライアント（省略時はブラウザシングルトン）
 *                 サーバー prefetch 経路で正しいデータを取れるよう DI する
 */
export async function getInterviewsBySchool(
  schoolIds: string[],
  client: SupabaseClient<Database> = supabase
): Promise<Map<string, StudentInterview[]>> {
  if (schoolIds.length === 0) return new Map();

  // 面談記録は教室横断で蓄積し1000行を超えうるため全件ページング取得
  // （旧実装の .limit(5000) は暫定上限で、超過分は静かに切り捨てられていた）。
  // interview_date/created_at は一意でないため id を第2ソートキーに足して安定ページング。
  let rows: StudentInterview[];
  try {
    rows = await fetchAllPaged<StudentInterview>((from, to) =>
      client
        .from('student_interviews')
        .select('*')
        .in('school_id', schoolIds)
        .order('interview_date', { ascending: false })
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
        .range(from, to)
    );
  } catch (e) {
    throw new Error(`面談記録の取得に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
  }

  const byStudent = new Map<string, StudentInterview[]>();
  for (const interview of rows) {
    const list = byStudent.get(interview.student_id) || [];
    list.push(interview);
    byStudent.set(interview.student_id, list);
  }
  return byStudent;
}

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
 *
 * 注: 引数 schoolId はフォールバック扱い。実際には生徒の所属教室を DB から引いて
 * それを使う。これは「アラート集計が生徒の school_id で interview を fetch する」ため、
 * interview.school_id ≠ student.school_id だと新しい記録がアラート側で見えなくなる
 * （= 面談未更新アラートが消えない）バグを防ぐため。
 */
export async function createInterview(
  schoolId: string,
  studentId: string,
  input: StudentInterviewInput
): Promise<StudentInterview> {
  // 生徒の所属教室を取得して school_id を強制的に揃える
  let effectiveSchoolId = schoolId;
  try {
    const { data: studentRow } = await supabase
      .from('students')
      .select('school_id')
      .eq('id', studentId)
      .maybeSingle();
    if (studentRow?.school_id) {
      effectiveSchoolId = studentRow.school_id as string;
    }
  } catch {
    // 取得失敗時は呼び出し側の schoolId にフォールバック
  }

  const { data, error } = await supabase
    .from('student_interviews')
    .insert({
      school_id: effectiveSchoolId,
      student_id: studentId,
      interview_date: input.interview_date,
      interview_type: input.interview_type,
      title: input.title || null,
      content: input.content,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`面談記録の作成に失敗しました: ${error.message}`);
  }

  // 面談記録作成時に interview_overdue アラートを自動で対応済みにする。
  // アラート計算は interviews を新しい順で参照するため、新しい記録があれば
  // alert candidate 自体が生成されなくなる。ただしユーザー画面のアラートは
  // メモリキャッシュ（最大15s）越しに古い候補が見え続けるので、必ず invalidate する。
  if (input.interview_type !== 'task') {
    try {
      const { data: existingInterviews } = await supabase
        .from('student_interviews')
        .select('interview_date')
        .eq('student_id', studentId)
        .neq('interview_type', 'task')
        .order('interview_date', { ascending: false })
        .limit(2);

      const previousDate =
        existingInterviews && existingInterviews.length > 1
          ? existingInterviews[1].interview_date
          : null;
      const alertKey = `interview:${previousDate || 'never'}`;

      // dismiss は best-effort（unique 制約違反など）。失敗しても invalidate は実行する
      try {
        await dismissAlert(
          schoolId,
          studentId,
          'interview_overdue',
          alertKey,
          undefined,
          '面談記録の登録により自動消去'
        );
      } catch (_) {
        // 既に dismiss 済みなど。アラート計算側で新記録が反映されるため致命的ではない
      }
    } finally {
      invalidateAlertCache([schoolId]);
    }
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
      title: input.title ?? null,
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
  const { error } = await supabase.from('student_interviews').delete().eq('id', id);

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
    .select(
      `
      *,
      students!inner(last_name, first_name)
    `
    )
    .eq('school_id', schoolId)
    .order('interview_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`面談記録の取得に失敗しました: ${error.message}`);
  }

  return (data || []).map(
    (item: StudentInterview & { students: { last_name: string; first_name: string } }) => ({
      ...item,
      student_name: `${item.students.last_name} ${item.students.first_name}`,
    })
  ) as (StudentInterview & { student_name: string })[];
}

/**
 * 未完了タスク一覧を取得（生徒情報付き）
 */
export async function getPendingTasks(
  schoolId: string
): Promise<(StudentInterview & { student: { last_name: string; first_name: string } })[]> {
  const { data, error } = await supabase
    .from('student_interviews')
    .select(
      `
      *,
      students!inner(last_name, first_name)
    `
    )
    .eq('school_id', schoolId)
    .eq('interview_type', 'task')
    .eq('is_completed', false)
    .order('interview_date', { ascending: true });

  if (error) {
    throw new Error(`未完了タスクの取得に失敗しました: ${error.message}`);
  }

  return (data || []).map(
    (item: StudentInterview & { students: { last_name: string; first_name: string } }) => ({
      ...item,
      student: {
        last_name: item.students.last_name,
        first_name: item.students.first_name,
      },
    })
  ) as (StudentInterview & { student: { last_name: string; first_name: string } })[];
}

/**
 * 複数教室の未完了タスクを一括取得（1クエリ）
 */
/**
 * @param client - RLS 認証済みのサーバークライアント（省略時はブラウザシングルトン）
 *                 サーバー prefetch 経路で正しいデータを取れるよう DI する
 */
export async function getPendingTasksBySchools(
  schoolIds: string[],
  client: SupabaseClient<Database> = supabase
): Promise<(StudentInterview & { student: { last_name: string; first_name: string } })[]> {
  if (schoolIds.length === 0) return [];

  const { data, error } = await client
    .from('student_interviews')
    .select(
      `
      *,
      students!inner(last_name, first_name)
    `
    )
    .in('school_id', schoolIds)
    .eq('interview_type', 'task')
    .eq('is_completed', false)
    .order('interview_date', { ascending: true });

  if (error) {
    throw new Error(`未完了タスクの取得に失敗しました: ${error.message}`);
  }

  return (data || []).map(
    (item: StudentInterview & { students: { last_name: string; first_name: string } }) => ({
      ...item,
      student: {
        last_name: item.students.last_name,
        first_name: item.students.first_name,
      },
    })
  ) as (StudentInterview & { student: { last_name: string; first_name: string } })[];
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
