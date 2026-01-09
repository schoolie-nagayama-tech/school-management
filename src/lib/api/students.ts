import { supabase } from '@/lib/supabase';
import type { Student, StudentInsert, StudentUpdate, Subject } from '@/types/database';
import { setStudentSubjects } from './subjects';

// 生徒一覧を取得（科目情報も含む）
export async function getStudents(searchQuery?: string): Promise<(Student & { subjects: Subject[] })[]> {
  let query = supabase
    .from('students')
    .select('*')
    .order('student_code', { ascending: true });

  // 検索クエリがある場合
  if (searchQuery && searchQuery.trim()) {
    const trimmed = searchQuery.trim();
    query = query.or(
      `last_name.ilike.%${trimmed}%,first_name.ilike.%${trimmed}%,last_name_kana.ilike.%${trimmed}%,first_name_kana.ilike.%${trimmed}%,student_code.ilike.%${trimmed}%`
    );
  }

  const { data: students, error } = await query;

  if (error) {
    console.error('Error fetching students:', error);
    throw new Error('生徒一覧の取得に失敗しました');
  }

  if (!students || students.length === 0) return [];

  const studentsTyped = students as Student[];

  // 各生徒の科目を取得
  const studentIds = studentsTyped.map((s) => s.id);
  
  const { data: studentSubjects, error: ssError } = await supabase
    .from('student_subjects')
    .select('student_id, subject_id')
    .in('student_id', studentIds);

  if (ssError) {
    console.error('Error fetching student subjects:', ssError);
    // 科目取得に失敗しても生徒データは返す
    return studentsTyped.map((student) => ({
      ...student,
      subjects: [] as Subject[],
    }));
  }

  if (!studentSubjects || studentSubjects.length === 0) {
    return studentsTyped.map((student) => ({
      ...student,
      subjects: [] as Subject[],
    }));
  }

  // 科目IDを取得（重複を除去）
  const subjectIdSet = new Set<string>();
  studentSubjects.forEach((ss) => {
    if (ss.subject_id) {
      subjectIdSet.add(ss.subject_id);
    }
  });
  const subjectIds = Array.from(subjectIdSet);
  
  const { data: subjects, error: subjectsError } = await supabase
    .from('subjects')
    .select('*')
    .in('id', subjectIds);

  if (subjectsError) {
    console.error('Error fetching subjects:', subjectsError);
    // 科目取得に失敗しても生徒データは返す
    return studentsTyped.map((student) => ({
      ...student,
      subjects: [] as Subject[],
    }));
  }

  const subjectsTyped = (subjects || []) as Subject[];

  // 生徒と科目を関連付け
  const subjectsMap = new Map<string, Subject>();
  subjectsTyped.forEach((s) => {
    subjectsMap.set(s.id, s);
  });
  
  const studentSubjectsMap = new Map<string, string[]>();
  
  studentSubjects.forEach((ss) => {
    if (ss.student_id && ss.subject_id) {
      if (!studentSubjectsMap.has(ss.student_id)) {
        studentSubjectsMap.set(ss.student_id, []);
      }
      studentSubjectsMap.get(ss.student_id)!.push(ss.subject_id);
    }
  });

  return studentsTyped.map((student) => {
    const subjectIds = studentSubjectsMap.get(student.id) || [];
    return {
      ...student,
      subjects: subjectIds
        .map((id) => subjectsMap.get(id))
        .filter((s): s is Subject => s !== undefined),
    };
  });
}

// 生徒を1件取得
export async function getStudent(id: string): Promise<Student | null> {
  const { data, error } = await supabase
    .from('students')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    console.error('Error fetching student:', error);
    throw new Error('生徒情報の取得に失敗しました');
  }

  return data as Student;
}

// 生徒を新規登録
export async function createStudent(
  student: StudentInsert,
  subjectIds?: string[]
): Promise<Student> {
  const { data, error } = await supabase
    .from('students')
    .insert(student as never)
    .select()
    .single();

  if (error) {
    console.error('Error creating student:', error);
    if (error.code === '23505') {
      throw new Error('この生徒コードは既に使用されています');
    }
    throw new Error('生徒の登録に失敗しました');
  }

  // 科目を設定
  const studentData = data as Student;
  if (subjectIds && subjectIds.length > 0) {
    await setStudentSubjects(studentData.id, subjectIds);
  }

  return studentData;
}

// 生徒を更新
export async function updateStudent(
  id: string,
  student: StudentUpdate,
  subjectIds?: string[]
): Promise<Student> {
  const { data, error } = await supabase
    .from('students')
    .update({ ...student, updated_at: new Date().toISOString() } as never)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('Error updating student:', error);
    if (error.code === '23505') {
      throw new Error('この生徒コードは既に使用されています');
    }
    throw new Error('生徒情報の更新に失敗しました');
  }

  // 科目を更新（subjectIdsが指定された場合）
  if (subjectIds !== undefined) {
    await setStudentSubjects(id, subjectIds);
  }

  return data as Student;
}

// 生徒を削除（物理削除）
export async function deleteStudent(id: string): Promise<void> {
  const { error } = await supabase.from('students').delete().eq('id', id);

  if (error) {
    console.error('Error deleting student:', error);
    throw new Error('生徒の削除に失敗しました');
  }
}
