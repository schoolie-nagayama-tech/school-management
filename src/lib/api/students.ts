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
  searchQuery?: string,
  schoolIds?: string[] // 複数教室IDを指定可能（未指定の場合はデフォルト教室）
): Promise<(Student & { subjects: Subject[] })[]> {
  // schoolIdsが指定されていない場合はデフォルト教室を使用
  const targetSchoolIds = schoolIds && schoolIds.length > 0 
    ? schoolIds 
    : [getDefaultSchoolId()];

  // 基本クエリ: school_idで絞り込み、deleted_at is nullのみ
  let query = supabase
    .from('students')
    .select('*')
    .in('school_id', targetSchoolIds)
    .is('deleted_at', null);

  // 検索クエリがある場合
  if (searchQuery && searchQuery.trim()) {
    const trimmed = searchQuery.trim();
    query = query.or(
      `last_name.ilike.%${trimmed}%,first_name.ilike.%${trimmed}%,last_name_kana.ilike.%${trimmed}%,first_name_kana.ilike.%${trimmed}%,student_code.ilike.%${trimmed}%`
    );
  }

  // DB側でgrade/kana/nameを先にソート（nullsは最後）
  query = query
    .order('grade', { ascending: true })
    .order('last_name_kana', { ascending: true, nullsFirst: false })
    .order('first_name_kana', { ascending: true, nullsFirst: false })
    .order('last_name', { ascending: true })
    .order('first_name', { ascending: true })
    .order('student_code', { ascending: true });

  const { data: students, error } = await query;

  if (error) {
    console.error('Error fetching students:', error);
    throw new Error('生徒一覧の取得に失敗しました');
  }

  if (!students || students.length === 0) return [];

  const studentsTyped = students as Student[];

  // status順のみJS側でソート（active→inactive→withdrawn）、DB順を安定ソートで保持
  const statusOrder: Record<string, number> = { active: 1, inactive: 2, withdrawn: 3 };
  studentsTyped.sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);

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

/**
 * 生徒を検索（名前・かな・コードで部分一致、active のみ）
 * 座席表の「生徒追加」などで利用
 */
export async function searchStudents(
  schoolId: string,
  query: string,
  options?: { excludeIds?: string[]; limit?: number }
): Promise<(Student & { subjects: Subject[] })[]> {
  const all = await getStudents(query.trim() || undefined, [schoolId]);
  let list = all.filter((s) => s.status === 'active');
  if (options?.excludeIds?.length) {
    const set = new Set(options.excludeIds);
    list = list.filter((s) => !set.has(s.id));
  }
  if (options?.limit && options.limit > 0) {
    list = list.slice(0, options.limit);
  }
  return list;
}

// 生徒を1件取得（school_idとdeleted_atで絞り込み）
export async function getStudent(
  id: string,
  schoolIds?: string[] // 複数教室IDを指定可能（未指定の場合はデフォルト教室）
): Promise<Student | null> {
  // schoolIdsが指定されていない場合はデフォルト教室を使用
  const targetSchoolIds = schoolIds && schoolIds.length > 0 
    ? schoolIds 
    : [getDefaultSchoolId()];

  const { data, error } = await supabase
    .from('students')
    .select('*')
    .eq('id', id)
    .in('school_id', targetSchoolIds)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) {
    console.error('Error fetching student:', error);
    throw new Error('生徒情報の取得に失敗しました');
  }

  return data as Student | null;
}

export async function bulkMoveStudentsToSchool({
  fromSchoolId,
  toSchoolId,
  studentCodes,
}: {
  fromSchoolId: string;
  toSchoolId: string;
  /** 指定した場合は、生徒コード一致のみを移動（移動元教室にいるもののみ） */
  studentCodes?: string[];
}): Promise<{
  movedStudents: number;
  updatedStudentLogs: number;
  updatedInterviews: number;
  updatedAssessments: number;
  updatedSchedulePatterns: number;
  updatedScheduleEntries: number;
}> {
  if (!fromSchoolId || !toSchoolId) {
    throw new Error('移動元・移動先の教室を選択してください');
  }
  if (fromSchoolId === toSchoolId) {
    throw new Error('移動元と移動先が同じです');
  }

  // 対象生徒IDを取得
  let q = supabase
    .from('students')
    .select('id, student_code')
    .eq('school_id', fromSchoolId)
    .is('deleted_at', null);

  if (studentCodes && studentCodes.length > 0) {
    q = q.in('student_code', studentCodes);
  }

  const { data: targets, error: targetErr } = await q;
  if (targetErr) {
    console.error('Error selecting target students:', targetErr);
    throw new Error('移動対象の生徒取得に失敗しました');
  }

  const ids = ((targets || []) as Array<{ id: string; student_code: string | null }>)
    .map((t) => t.id)
    .filter(Boolean);
  if (ids.length === 0) {
    return {
      movedStudents: 0,
      updatedStudentLogs: 0,
      updatedInterviews: 0,
      updatedAssessments: 0,
      updatedSchedulePatterns: 0,
      updatedScheduleEntries: 0,
    };
  }

  const now = new Date().toISOString();

  // 1) students を更新
  const { error: moveErr, count: movedCount } = await supabase
    .from('students')
    .update({ school_id: toSchoolId, updated_at: now } as never, { count: 'exact' })
    .in('id', ids)
    .eq('school_id', fromSchoolId)
    .is('deleted_at', null);

  if (moveErr) {
    console.error('Error moving students:', moveErr);
    throw new Error('生徒の教室移動に失敗しました');
  }

  // 2) 関連テーブルの school_id も揃える（新規インポート直後を想定し、範囲は必要最小限）
  const [
    { error: logsErr, count: logsCount },
    { error: interviewsErr, count: interviewsCount },
    { error: assessmentsErr, count: assessmentsCount },
    { error: patternsErr, count: patternsCount },
    { error: entriesErr, count: entriesCount },
  ] = await Promise.all([
    supabase
      .from('student_logs')
      .update({ school_id: toSchoolId } as never, { count: 'exact' })
      .in('student_id', ids)
      .eq('school_id', fromSchoolId),
    supabase
      .from('student_interviews')
      .update({ school_id: toSchoolId, updated_at: now } as never, { count: 'exact' })
      .in('student_id', ids)
      .eq('school_id', fromSchoolId),
    supabase
      .from('assessments')
      .update({ school_id: toSchoolId, updated_at: now } as never, { count: 'exact' })
      .in('student_id', ids)
      .eq('school_id', fromSchoolId),
    supabase
      .from('schedule_regular_patterns')
      .update({ school_id: toSchoolId, updated_at: now } as never, { count: 'exact' })
      .in('student_id', ids)
      .eq('school_id', fromSchoolId),
    supabase
      .from('schedule_entries')
      .update({ school_id: toSchoolId, updated_at: now } as never, { count: 'exact' })
      .in('student_id', ids)
      .eq('school_id', fromSchoolId),
  ]);

  // RLS等で更新できないテーブルがあっても、生徒移動自体は完了しているため致命にしない
  if (logsErr) console.warn('Failed to update student_logs school_id:', logsErr);
  if (interviewsErr) console.warn('Failed to update student_interviews school_id:', interviewsErr);
  if (assessmentsErr) console.warn('Failed to update assessments school_id:', assessmentsErr);
  if (patternsErr) console.warn('Failed to update schedule_regular_patterns school_id:', patternsErr);
  if (entriesErr) console.warn('Failed to update schedule_entries school_id:', entriesErr);

  return {
    movedStudents: movedCount ?? 0,
    updatedStudentLogs: logsCount ?? 0,
    updatedInterviews: interviewsCount ?? 0,
    updatedAssessments: assessmentsCount ?? 0,
    updatedSchedulePatterns: patternsCount ?? 0,
    updatedScheduleEntries: entriesCount ?? 0,
  };
}

// 生徒を新規登録
export async function createStudent(
  student: StudentInsert,
  subjectIds?: string[]
): Promise<Student> {
  // 呼び出し元が school_id を指定している場合はそれを優先（CSVインポート等）
  // 未指定の場合のみデフォルト教室に紐づける
  const schoolId =
    student.school_id && String(student.school_id).trim() !== ''
      ? String(student.school_id)
      : getDefaultSchoolId();

  // 生徒コードが空の場合は一意のコードを自動生成（DBがNOT NULLかつUNIQUEのため）
  const rawCode =
    student.student_code != null ? String(student.student_code).trim() : '';
  const studentCode =
    rawCode !== ''
      ? rawCode
      : `A${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

  const studentWithSchool: StudentInsert = {
    ...student,
    school_id: schoolId,
    student_code: studentCode,
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

  // 生徒コードが空の場合は既存値を維持（空文字は更新しない）
  const updateData = { ...student };
  if ('student_code' in student) {
    const sc = student.student_code;
    // 空の場合は更新対象から除外（既存のコードを維持）
    if (sc == null || String(sc).trim() === '') {
      delete updateData.student_code;
    } else {
      updateData.student_code = String(sc).trim();
    }
  }

  // 既存データを取得（diff用）
  const { data: oldData } = await supabase
    .from('students')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .single();

  const { data, error } = await supabase
    .from('students')
    .update({ ...updateData, updated_at: new Date().toISOString() } as never)
    .eq('id', id)
    .is('deleted_at', null)
    .select()
    .single();

  if (error) {
    console.error('Error updating student:', error);
    if (error.code === '23505') {
      throw new Error('この生徒コードは既に使用されています');
    }
    if (error.code === 'PGRST116') {
      throw new Error('生徒が見つかりません。他のユーザーによって削除された可能性があります。');
    }
    throw new Error(`生徒情報の更新に失敗しました: ${error.message}`);
  }

  const studentData = data as Student;

  // 科目を更新（subjectIdsが指定された場合）
  if (subjectIds !== undefined) {
    await setStudentSubjects(id, subjectIds);
  }

  const oldTyped = oldData as Student | null;
  // statusが変更された場合はstatus_changed、それ以外はupdated
  const action: StudentLogInsert['action'] =
    oldTyped && oldTyped.status !== studentData.status
      ? 'status_changed'
      : 'updated';

  // ログを記録
  const diff: Record<string, unknown> = {};
  if (oldTyped) {
    Object.keys(student).forEach((key) => {
      const typedKey = key as keyof StudentUpdate;
      if (student[typedKey] !== undefined && oldTyped[typedKey] !== student[typedKey]) {
        diff[key] = {
          old: oldTyped[typedKey],
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
  // 既存データを取得（ログ用）
  const { data: oldData } = await supabase
    .from('students')
    .select('*')
    .eq('id', id)
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
    .is('deleted_at', null);

  if (error) {
    console.error('Error deleting student:', error);
    throw new Error('生徒の削除に失敗しました');
  }

  const oldTyped = oldData as Student;
  // ログを記録
  await logStudentAction(id, schoolId, 'soft_deleted', {
    deletedValues: {
      student_code: oldTyped.student_code,
      last_name: oldTyped.last_name,
      first_name: oldTyped.first_name,
      grade: oldTyped.grade,
      status: oldTyped.status,
    },
  });
}

// 生徒を一括論理削除
export async function bulkDeleteStudents(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;

  const schoolId = getDefaultSchoolId();
  const now = new Date().toISOString();

  // 対象生徒の情報を取得（ログ用）
  const { data: targets } = await supabase
    .from('students')
    .select('id, student_code, last_name, first_name, grade, status')
    .in('id', ids)
    .is('deleted_at', null);

  const targetList = (targets || []) as Array<{
    id: string;
    student_code: string | null;
    last_name: string;
    first_name: string;
    grade: number;
    status: string;
  }>;

  if (targetList.length === 0) return 0;

  const targetIds = targetList.map((t) => t.id);

  const { error, count } = await supabase
    .from('students')
    .update({ deleted_at: now } as never, { count: 'exact' })
    .in('id', targetIds)
    .is('deleted_at', null);

  if (error) {
    console.error('Error bulk deleting students:', error);
    throw new Error('生徒の一括削除に失敗しました');
  }

  // ログを並列記録
  await Promise.all(
    targetList.map((s) =>
      logStudentAction(s.id, schoolId, 'soft_deleted', {
        bulk_delete: true,
        deletedValues: {
          student_code: s.student_code,
          last_name: s.last_name,
          first_name: s.first_name,
          grade: s.grade,
          status: s.status,
        },
      })
    )
  );

  return count ?? 0;
}

// 選択した生徒の教室を移動（IDベース）
export async function moveStudentsToSchool(
  studentIds: string[],
  toSchoolId: string
): Promise<number> {
  if (studentIds.length === 0) return 0;
  if (!toSchoolId) throw new Error('移動先の教室を選択してください');

  const now = new Date().toISOString();

  // 対象生徒の現在のschool_idを取得
  const { data: targets } = await supabase
    .from('students')
    .select('id, school_id')
    .in('id', studentIds)
    .is('deleted_at', null);

  const targetList = (targets || []) as Array<{ id: string; school_id: string }>;
  if (targetList.length === 0) return 0;

  // 既に移動先にいる生徒は除外
  const toMove = targetList.filter((t) => t.school_id !== toSchoolId);
  if (toMove.length === 0) return 0;

  const ids = toMove.map((t) => t.id);

  // students を更新
  const { error, count } = await supabase
    .from('students')
    .update({ school_id: toSchoolId, updated_at: now } as never, { count: 'exact' })
    .in('id', ids)
    .is('deleted_at', null);

  if (error) {
    console.error('Error moving students:', error);
    throw new Error('生徒の教室移動に失敗しました');
  }

  // 関連テーブルも更新（移動元school_idごとにグループ化）
  const byFromSchool = new Map<string, string[]>();
  for (const t of toMove) {
    if (!byFromSchool.has(t.school_id)) byFromSchool.set(t.school_id, []);
    byFromSchool.get(t.school_id)!.push(t.id);
  }

  for (const [fromSchoolId, groupIds] of Array.from(byFromSchool.entries())) {
    await Promise.all([
      supabase
        .from('student_logs')
        .update({ school_id: toSchoolId } as never)
        .in('student_id', groupIds)
        .eq('school_id', fromSchoolId),
      supabase
        .from('student_interviews')
        .update({ school_id: toSchoolId, updated_at: now } as never)
        .in('student_id', groupIds)
        .eq('school_id', fromSchoolId),
      supabase
        .from('assessments')
        .update({ school_id: toSchoolId, updated_at: now } as never)
        .in('student_id', groupIds)
        .eq('school_id', fromSchoolId),
      supabase
        .from('schedule_regular_patterns')
        .update({ school_id: toSchoolId, updated_at: now } as never)
        .in('student_id', groupIds)
        .eq('school_id', fromSchoolId),
      supabase
        .from('schedule_entries')
        .update({ school_id: toSchoolId, updated_at: now } as never)
        .in('student_id', groupIds)
        .eq('school_id', fromSchoolId),
    ]);
  }

  return count ?? 0;
}

// 生徒を復元（将来用）
export async function restoreStudent(id: string): Promise<void> {
  const { error } = await supabase
    .from('students')
    .update({ deleted_at: null } as never)
    .eq('id', id)
    .not('deleted_at', 'is', null);

  if (error) {
    console.error('Error restoring student:', error);
    throw new Error('生徒の復元に失敗しました');
  }

  // ログを記録
  await logStudentAction(id, schoolId, 'restored');
}

// 学年カテゴリ取得
function getGradeCategory(grade: number): 'elementary' | 'middle' | 'high' {
  if (grade <= 6) return 'elementary';
  if (grade <= 9) return 'middle';
  return 'high';
}

// 一括学年更新
export async function bulkUpdateGrades(schoolIds: string[]): Promise<void> {
  if (schoolIds.length === 0) {
    throw new Error('教室が選択されていません');
  }

  const { data: students, error: studentsError } = await supabase
    .from('students')
    .select('id, school_id, grade')
    .in('school_id', schoolIds)
    .is('deleted_at', null)
    .eq('status', 'active');

  if (studentsError) {
    console.error('Error fetching students:', studentsError);
    throw new Error('生徒の取得に失敗しました');
  }
  if (!students || students.length === 0) return;

  const eligible = (students as Array<{ id: string; school_id: string; grade: number }>).filter(
    (s) => s.grade < 13
  );
  if (eligible.length === 0) return;

  const now = new Date().toISOString();

  // カテゴリ変更する生徒を特定
  const categoryChangedStudents = eligible.filter(
    (s) => getGradeCategory(s.grade) !== getGradeCategory(s.grade + 1)
  );
  const categoryChangedIds = categoryChangedStudents.map((s) => s.id);
  const categoryChangedMap = new Map(
    categoryChangedStudents.map((s) => [s.id, getGradeCategory(s.grade + 1)])
  );

  // 1. gradeをグループごとにバッチUPDATE（学年ごとに1クエリ）
  const gradeGroups = new Map<number, string[]>();
  for (const s of eligible) {
    const newGrade = s.grade + 1;
    if (!gradeGroups.has(newGrade)) gradeGroups.set(newGrade, []);
    gradeGroups.get(newGrade)!.push(s.id);
  }

  const gradeUpdateResults = await Promise.all(
    Array.from(gradeGroups.entries()).map(([newGrade, ids]) =>
      supabase
        .from('students')
        .update({ grade: newGrade, updated_at: now } as never)
        .in('id', ids)
    )
  );
  for (const result of gradeUpdateResults) {
    if (result.error) {
      throw new Error(`生徒の学年更新に失敗しました: ${result.error.message}`);
    }
  }

  // カテゴリ変更がある場合のみ以下を実行
  if (categoryChangedIds.length > 0) {
    // 2. student_subjects を一括削除
    await supabase.from('student_subjects').delete().in('student_id', categoryChangedIds);

    // 3. student_textbooks を一括取得
    const { data: stList } = await supabase
      .from('student_textbooks')
      .select('id, student_id, textbook:textbooks(grade_category)')
      .in('student_id', categoryChangedIds);

    // 削除対象IDをJS側で絞り込んで一括DELETE
    if (stList && stList.length > 0) {
      const idsToDelete = (
        stList as Array<{
          id: string;
          student_id: string;
          textbook: { grade_category: string | null } | null;
        }>
      )
        .filter((st) => {
          const tbCat = st.textbook?.grade_category ?? null;
          const newCat = categoryChangedMap.get(st.student_id);
          return tbCat != null && tbCat !== newCat;
        })
        .map((st) => st.id);

      if (idsToDelete.length > 0) {
        await supabase.from('student_textbooks').delete().in('id', idsToDelete);
      }
    }

    // 4. schedule_regular_patterns の subject_ids を一括リセット
    await supabase
      .from('schedule_regular_patterns')
      .update({ subject_ids: [], updated_at: now } as never)
      .in('student_id', categoryChangedIds);
  }

  // ログを並列記録
  await Promise.all(
    eligible.map((s) =>
      logStudentAction(s.id, s.school_id, 'updated', {
        grade_bulk_update: {
          old: s.grade,
          new: s.grade + 1,
          categoryChanged: categoryChangedIds.includes(s.id),
        },
      })
    )
  );
}
