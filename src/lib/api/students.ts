import { supabase } from '@/lib/supabase';
import type {
  Student,
  StudentInsert,
  StudentUpdate,
  Subject,
  StudentLogInsert,
} from '@/types/database';
import { setStudentSubjects } from './subjects';
import { getDefaultSchoolId } from './schools';

// ログを記録する関数
async function logStudentAction(
  studentId: string,
  schoolId: string,
  action: StudentLogInsert['action'],
  diff?: Record<string, unknown>
): Promise<void> {
  try {
    const logEntry: StudentLogInsert = {
      student_id: studentId,
      school_id: schoolId,
      action,
      actor: null, // 将来、認証導入後にユーザーIDを設定
      diff: diff || null,
    };

    const { error } = await supabase
      .from('student_logs')
      .insert(logEntry as never);

    if (error) {
      // ログ書き込み失敗は警告のみ（処理自体は成功扱い）
      console.warn('Failed to write student log:', error);
    }
  } catch (error) {
    console.warn('Error writing student log:', error);
  }
}

// 生徒一覧を取得（科目情報も含む）
// 並び順: 1) status (active → inactive → withdrawn), 2) grade, 3) kana, 4) name, 5) student_code
export async function getStudents(
  searchQuery?: string
): Promise<(Student & { subjects: Subject[] })[]> {
  const schoolId = getDefaultSchoolId();

  // 基本クエリ: school_idで絞り込み、deleted_at is nullのみ
  let query = supabase
    .from('students')
    .select('*')
    .eq('school_id', schoolId)
    .is('deleted_at', null);

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

  // 並び順を適用（SQL側で完全に実装できないため、JavaScript側でソート）
  studentsTyped.sort((a, b) => {
    // 1) status順: active → inactive → withdrawn
    const statusOrder: Record<string, number> = {
      active: 1,
      inactive: 2,
      withdrawn: 3,
    };
    const statusDiff = statusOrder[a.status] - statusOrder[b.status];
    if (statusDiff !== 0) return statusDiff;

    // 2) grade昇順
    const gradeDiff = a.grade - b.grade;
    if (gradeDiff !== 0) return gradeDiff;

    // 3) フリガナ（last_name_kana, first_name_kana）昇順（NULL/空は最後）
    const aLastKana = a.last_name_kana?.trim() || '';
    const bLastKana = b.last_name_kana?.trim() || '';
    const aFirstKana = a.first_name_kana?.trim() || '';
    const bFirstKana = b.first_name_kana?.trim() || '';

    if (!aLastKana && !bLastKana) {
      // 両方NULL/空の場合は次へ
    } else if (!aLastKana) return 1;
    else if (!bLastKana) return -1;
    else {
      const kanaDiff = aLastKana.localeCompare(bLastKana, 'ja');
      if (kanaDiff !== 0) return kanaDiff;
      const firstKanaDiff = aFirstKana.localeCompare(bFirstKana, 'ja');
      if (firstKanaDiff !== 0) return firstKanaDiff;
    }

    // 4) 氏名（last_name, first_name）昇順
    const nameDiff = a.last_name.localeCompare(b.last_name, 'ja');
    if (nameDiff !== 0) return nameDiff;
    const firstNameDiff = a.first_name.localeCompare(b.first_name, 'ja');
    if (firstNameDiff !== 0) return firstNameDiff;

    // 5) student_code昇順（タイブレーク）
    const aCode = a.student_code || '';
    const bCode = b.student_code || '';
    return aCode.localeCompare(bCode);
  });

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

// 生徒を1件取得（school_idとdeleted_atで絞り込み）
export async function getStudent(id: string): Promise<Student | null> {
  const schoolId = getDefaultSchoolId();

  const { data, error } = await supabase
    .from('students')
    .select('*')
    .eq('id', id)
    .eq('school_id', schoolId)
    .is('deleted_at', null)
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
  const schoolId = getDefaultSchoolId();

  // school_idを設定
  const studentWithSchool: StudentInsert = {
    ...student,
    school_id: schoolId,
  };

  const { data, error } = await supabase
    .from('students')
    .insert(studentWithSchool as never)
    .select()
    .single();

  if (error) {
    console.error('Error creating student:', error);
    if (error.code === '23505') {
      throw new Error('この生徒コードは既に使用されています');
    }
    throw new Error('生徒の登録に失敗しました');
  }

  const studentData = data as Student;

  // 科目を設定
  if (subjectIds && subjectIds.length > 0) {
    await setStudentSubjects(studentData.id, subjectIds);
  }

  // ログを記録
  await logStudentAction(studentData.id, schoolId, 'created', {
    newValues: {
      student_code: studentData.student_code,
      last_name: studentData.last_name,
      first_name: studentData.first_name,
      grade: studentData.grade,
      status: studentData.status,
    },
  });

  return studentData;
}

// 生徒を更新
export async function updateStudent(
  id: string,
  student: StudentUpdate,
  subjectIds?: string[]
): Promise<Student> {
  const schoolId = getDefaultSchoolId();

  // 既存データを取得（diff用）
  const { data: oldData } = await supabase
    .from('students')
    .select('*')
    .eq('id', id)
    .eq('school_id', schoolId)
    .is('deleted_at', null)
    .single();

  const { data, error } = await supabase
    .from('students')
    .update({ ...student, updated_at: new Date().toISOString() } as never)
    .eq('id', id)
    .eq('school_id', schoolId)
    .is('deleted_at', null)
    .select()
    .single();

  if (error) {
    console.error('Error updating student:', error);
    if (error.code === '23505') {
      throw new Error('この生徒コードは既に使用されています');
    }
    throw new Error('生徒情報の更新に失敗しました');
  }

  const studentData = data as Student;

  // 科目を更新（subjectIdsが指定された場合）
  if (subjectIds !== undefined) {
    await setStudentSubjects(id, subjectIds);
  }

  // statusが変更された場合はstatus_changed、それ以外はupdated
  const action: StudentLogInsert['action'] =
    oldData && oldData.status !== studentData.status
      ? 'status_changed'
      : 'updated';

  // ログを記録
  const diff: Record<string, unknown> = {};
  if (oldData) {
    Object.keys(student).forEach((key) => {
      const typedKey = key as keyof StudentUpdate;
      if (student[typedKey] !== undefined && oldData[typedKey] !== student[typedKey]) {
        diff[key] = {
          old: oldData[typedKey],
          new: student[typedKey],
        };
      }
    });
  } else {
    diff.newValues = student;
  }

  await logStudentAction(studentData.id, schoolId, action, diff);

  return studentData;
}

// 生徒を論理削除（soft delete）
export async function deleteStudent(id: string): Promise<void> {
  const schoolId = getDefaultSchoolId();

  // 既存データを取得（ログ用）
  const { data: oldData } = await supabase
    .from('students')
    .select('*')
    .eq('id', id)
    .eq('school_id', schoolId)
    .is('deleted_at', null)
    .single();

  if (!oldData) {
    throw new Error('生徒が見つかりません');
  }

  // deleted_atを設定（論理削除）
  const { error } = await supabase
    .from('students')
    .update({ deleted_at: new Date().toISOString() } as never)
    .eq('id', id)
    .eq('school_id', schoolId)
    .is('deleted_at', null);

  if (error) {
    console.error('Error deleting student:', error);
    throw new Error('生徒の削除に失敗しました');
  }

  // ログを記録
  await logStudentAction(id, schoolId, 'soft_deleted', {
    deletedValues: {
      student_code: oldData.student_code,
      last_name: oldData.last_name,
      first_name: oldData.first_name,
      grade: oldData.grade,
      status: oldData.status,
    },
  });
}

// 生徒を復元（将来用）
export async function restoreStudent(id: string): Promise<void> {
  const schoolId = getDefaultSchoolId();

  const { error } = await supabase
    .from('students')
    .update({ deleted_at: null } as never)
    .eq('id', id)
    .eq('school_id', schoolId)
    .not('deleted_at', 'is', null);

  if (error) {
    console.error('Error restoring student:', error);
    throw new Error('生徒の復元に失敗しました');
  }

  // ログを記録
  await logStudentAction(id, schoolId, 'restored');
}
