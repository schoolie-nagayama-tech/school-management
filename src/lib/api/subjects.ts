import { supabase } from '@/lib/supabase';
import { getDefaultSchoolId } from './schools';
import type {
  Subject,
  SubjectInsert,
  SubjectUpdate,
  StudentSubject,
  StudentSubjectInsert,
  Student,
} from '@/types/database';

// 科目一覧を取得（学年カテゴリでフィルタリング可能）
export async function getSubjects(
  gradeCategory?: 'elementary' | 'middle' | 'high'
): Promise<Subject[]> {
  let query = supabase.from('subjects').select('*').order('sort_order', { ascending: true });

  if (gradeCategory) {
    query = query.eq('grade_category', gradeCategory);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Error fetching subjects:', error);
    throw new Error('科目一覧の取得に失敗しました');
  }

  return (data as Subject[]) || [];
}

// 科目を1件取得
export async function getSubject(id: string): Promise<Subject | null> {
  const { data, error } = await supabase.from('subjects').select('*').eq('id', id).single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    console.error('Error fetching subject:', error);
    throw new Error('科目情報の取得に失敗しました');
  }

  return data as Subject;
}

// 科目を新規登録
export async function createSubject(subject: SubjectInsert): Promise<Subject> {
  const { data, error } = await supabase
    .from('subjects')
    .insert(subject as never)
    .select()
    .single();

  if (error) {
    console.error('Error creating subject:', error);
    throw new Error('科目の登録に失敗しました');
  }

  return data as Subject;
}

// 科目を更新
export async function updateSubject(id: string, subject: SubjectUpdate): Promise<Subject> {
  const { data, error } = await supabase
    .from('subjects')
    .update(subject as never)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('Error updating subject:', error);
    throw new Error('科目情報の更新に失敗しました');
  }

  return data as Subject;
}

// 科目を削除
export async function deleteSubject(id: string): Promise<void> {
  const { error } = await supabase.from('subjects').delete().eq('id', id);

  if (error) {
    console.error('Error deleting subject:', error);
    throw new Error('科目の削除に失敗しました');
  }
}

// 科目の並び順を更新（一括）
export async function updateSubjectSortOrders(
  updates: { id: string; sort_order: number }[]
): Promise<void> {
  const promises = updates.map((update) =>
    supabase.from('subjects').update({ sort_order: update.sort_order }).eq('id', update.id)
  );

  const results = await Promise.all(promises);

  const errors = results.filter((result) => result.error);
  if (errors.length > 0) {
    console.error('Error updating sort orders:', errors);
    throw new Error('科目の並び順の更新に失敗しました');
  }
}

// 生徒の受講科目を取得
export async function getStudentSubjects(studentId: string): Promise<StudentSubject[]> {
  const { data, error } = await supabase
    .from('student_subjects')
    .select('*')
    .eq('student_id', studentId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Error fetching student subjects:', error);
    throw new Error('受講科目の取得に失敗しました');
  }

  return (data as StudentSubject[]) || [];
}

// 生徒の受講科目を設定（一括置き換え）
export async function setStudentSubjects(studentId: string, subjectIds: string[]): Promise<void> {
  // 既存の関連を削除
  const { error: deleteError } = await supabase
    .from('student_subjects')
    .delete()
    .eq('student_id', studentId);

  if (deleteError) {
    console.error('Error deleting student subjects:', deleteError);
    throw new Error('受講科目の設定に失敗しました');
  }

  // 新しい関連を追加
  if (subjectIds.length > 0) {
    const inserts: StudentSubjectInsert[] = subjectIds.map((subjectId) => ({
      student_id: studentId,
      subject_id: subjectId,
    }));

    const { error: insertError } = await supabase.from('student_subjects').insert(inserts as never);

    if (insertError) {
      console.error('Error inserting student subjects:', insertError);
      throw new Error('受講科目の設定に失敗しました');
    }
  }
}

// 生徒と科目の関連を含む生徒情報を取得
export async function getStudentWithSubjects(studentId: string): Promise<{
  student: Student;
  subjects: Subject[];
} | null> {
  const schoolId = getDefaultSchoolId();

  const { data: studentData, error: studentError } = await supabase
    .from('students')
    .select('*')
    .eq('id', studentId)
    .eq('school_id', schoolId)
    .is('deleted_at', null)
    .single();

  if (studentError) {
    if (studentError.code === 'PGRST116') {
      return null;
    }
    console.error('Error fetching student:', studentError);
    throw new Error('生徒情報の取得に失敗しました');
  }

  const { data: subjectData, error: subjectError } = await supabase
    .from('student_subjects')
    .select('subject_id')
    .eq('student_id', studentId);

  if (subjectError) {
    console.error('Error fetching student subjects:', subjectError);
    throw new Error('受講科目の取得に失敗しました');
  }

  if (!subjectData || subjectData.length === 0) {
    return {
      student: studentData as Student,
      subjects: [],
    };
  }

  const subjectIds = subjectData.map((item) => item.subject_id);
  const { data: subjects, error: subjectsError } = await supabase
    .from('subjects')
    .select('*')
    .in('id', subjectIds);

  if (subjectsError) {
    console.error('Error fetching subjects:', subjectsError);
    throw new Error('科目情報の取得に失敗しました');
  }

  return {
    student: studentData as Student,
    subjects: (subjects as Subject[]) || [],
  };
}
