import { supabase } from '@/lib/supabase';
import type {
  StudentTextbook,
  StudentTextbookInsert,
  StudentTextbookUpdate,
  StudentTextbookSetting,
  StudentTextbookSettingInsert,
  StudentTextbookExam,
  StudentTextbookExamInsert,
  StudentTextbookExamUpdate,
  StudentProgress,
  StudentProgressInsert,
  StudentProgressUpdate,
  StudentProgressLesson,
  StudentProgressLessonInsert,
  StudentTextbookWithDetails,
  StudentProgressWithDetails,
  CurriculumItemWithProgress,
  Textbook,
  CurriculumItem,
  ProgressRowDisplay,
} from '@/types/database';
import { getCurriculumItems } from './textbooks';
import { getDefaultSchoolId } from './schools';

// ============================================
// 生徒×テキスト紐付け（student_textbooks）
// ============================================

export interface AlertTextbooksResult {
  byStudent: Map<string, StudentTextbookWithDetails[]>;
  examTypeNames: Map<string, string>;
}

/**
 * 教室単位で生徒テキスト＋テスト設定をバッチ取得（アラート用）
 */
export async function getStudentTextbooksExamsBySchool(
  schoolIds: string[]
): Promise<AlertTextbooksResult> {
  const empty: AlertTextbooksResult = { byStudent: new Map(), examTypeNames: new Map() };
  if (schoolIds.length === 0) return empty;

  const { data: studentTextbooks, error: stError } = await supabase
    .from('student_textbooks')
    .select('*, textbook:textbooks(*)')
    .in('school_id', schoolIds)
    .eq('is_active', true)
    .eq('track_progress', true)
    .order('created_at', { ascending: false });

  if (stError) {
    throw new Error(`生徒テキストの取得に失敗しました: ${stError.message}`);
  }

  const stList = (studentTextbooks || []) as (StudentTextbook & { textbook: Textbook })[];
  if (stList.length === 0) return empty;

  const stIds = stList.map((st) => st.id);
  const { data: exams, error: examsError } = await supabase
    .from('student_textbook_exams')
    .select('*')
    .in('student_textbook_id', stIds)
    .order('exam_date', { ascending: true });

  if (examsError) {
    throw new Error(`テスト設定の取得に失敗しました: ${examsError.message}`);
  }

  const examTypeNames = new Map<string, string>();
  const examTypeIds = Array.from(new Set((exams || []).map((e: { exam_type_id?: string }) => e.exam_type_id).filter((id): id is string => Boolean(id))));
  if (examTypeIds.length > 0) {
    const { data: examTypes } = await supabase
      .from('exam_types')
      .select('id, name')
      .in('id', examTypeIds);
    for (const et of examTypes || []) {
      examTypeNames.set(et.id, et.name);
    }
  }

  const examsByStId = new Map<string, StudentTextbookExam[]>();
  for (const exam of (exams || []) as StudentTextbookExam[]) {
    const list = examsByStId.get(exam.student_textbook_id) || [];
    list.push(exam);
    examsByStId.set(exam.student_textbook_id, list);
  }

  const settingsByStId = new Map<string, StudentTextbookSetting | null>();
  const { data: settings } = await supabase
    .from('student_textbook_settings')
    .select('*')
    .in('student_textbook_id', stIds);
  // O(1)ルックアップ用Mapを事前構築してO(n²)→O(n)に改善
  const settingsMap = new Map<string, StudentTextbookSetting>(
    ((settings || []) as StudentTextbookSetting[]).map((s) => [s.student_textbook_id, s])
  );
  for (const st of stList) {
    settingsByStId.set(st.id, settingsMap.get(st.id) ?? null);
  }

  const result: StudentTextbookWithDetails[] = stList.map((st) => ({
    ...st,
    settings: settingsByStId.get(st.id) || null,
    exams: (examsByStId.get(st.id) || []),
  }));

  const byStudent = new Map<string, StudentTextbookWithDetails[]>();
  for (const st of result) {
    const list = byStudent.get(st.student_id) || [];
    list.push(st);
    byStudent.set(st.student_id, list);
  }
  return { byStudent, examTypeNames };
}

/**
 * 生徒のテキスト一覧を取得
 */
export async function getStudentTextbooks(
  studentId: string,
  includeInactive = false
): Promise<StudentTextbookWithDetails[]> {
  let query = supabase
    .from('student_textbooks')
    .select('*, textbook:textbooks(*)')
    .eq('student_id', studentId);

  if (!includeInactive) {
    query = query.eq('is_active', true);
  }

  query = query.order('created_at', { ascending: false });

  const { data, error } = await query;

  if (error) {
    throw new Error(`生徒テキストの取得に失敗しました: ${error.message}`);
  }

  const studentTextbooks = (data || []) as (StudentTextbook & {
    textbook: Textbook;
  })[];

  // 設定とテスト情報をテキストブックID一覧で一括取得（N×2クエリ→2クエリ）
  const stIds = studentTextbooks.map((st) => st.id);
  const [settingsResult, examsResult] = await Promise.all([
    supabase.from('student_textbook_settings').select('*').in('student_textbook_id', stIds),
    supabase
      .from('student_textbook_exams')
      .select('*')
      .in('student_textbook_id', stIds)
      .order('exam_date', { ascending: true }),
  ]);

  const settingsList = (settingsResult.data || []) as StudentTextbookSetting[];
  const settingsMap = new Map<string, StudentTextbookSetting>(
    settingsList.map((s) => [s.student_textbook_id, s])
  );
  const examsMap = new Map<string, StudentTextbookExam[]>();
  for (const exam of (examsResult.data || []) as StudentTextbookExam[]) {
    const list = examsMap.get(exam.student_textbook_id) || [];
    list.push(exam);
    examsMap.set(exam.student_textbook_id, list);
  }

  return studentTextbooks.map((st) => ({
    ...st,
    settings: settingsMap.get(st.id) || null,
    exams: examsMap.get(st.id) || [],
  }));
}

/**
 * 生徒×テキストを紐付け
 */
export async function createStudentTextbook(
  studentTextbook: StudentTextbookInsert
): Promise<StudentTextbook> {
  const schoolId = getDefaultSchoolId();
  const { data, error } = await supabase
    .from('student_textbooks')
    .insert({ ...studentTextbook, school_id: schoolId })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new Error('このテキストは既に紐付けられています');
    }
    throw new Error(`生徒テキストの紐付けに失敗しました: ${error.message}`);
  }

  return data as StudentTextbook;
}

/**
 * 生徒×テキストを更新
 */
export async function updateStudentTextbook(
  id: string,
  studentTextbook: StudentTextbookUpdate
): Promise<StudentTextbook> {
  const { data, error } = await supabase
    .from('student_textbooks')
    .update(studentTextbook)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw new Error(`生徒テキストの更新に失敗しました: ${error.message}`);
  }

  return data as StudentTextbook;
}

/**
 * 生徒×テキストの紐付けを解除
 */
export async function deleteStudentTextbook(id: string): Promise<void> {
  const { error } = await supabase
    .from('student_textbooks')
    .delete()
    .eq('id', id);

  if (error) {
    throw new Error(`生徒テキストの削除に失敗しました: ${error.message}`);
  }
}

// ============================================
// 生徒×テキスト設定（student_textbook_settings）
// ============================================

/**
 * 生徒×テキストの設定を取得
 */
export async function getStudentTextbookSettings(
  studentTextbookId: string
): Promise<StudentTextbookSetting | null> {
  const { data, error } = await supabase
    .from('student_textbook_settings')
    .select('*')
    .eq('student_textbook_id', studentTextbookId)
    .maybeSingle();

  if (error) {
    throw new Error(`設定の取得に失敗しました: ${error.message}`);
  }

  return (data as StudentTextbookSetting) || null;
}

/**
 * 生徒×テキストの設定を作成または更新
 */
export async function upsertStudentTextbookSettings(
  studentTextbookId: string,
  settings: Omit<StudentTextbookSettingInsert, 'student_textbook_id'>
): Promise<StudentTextbookSetting> {
  const { data, error } = await supabase
    .from('student_textbook_settings')
    .upsert(
      {
        student_textbook_id: studentTextbookId,
        ...settings,
      },
      { onConflict: 'student_textbook_id' }
    )
    .select()
    .single();

  if (error) {
    throw new Error(`設定の保存に失敗しました: ${error.message}`);
  }

  return data as StudentTextbookSetting;
}

// ============================================
// テスト設定（student_textbook_exams）
// ============================================

/**
 * 生徒×テキストのテスト設定一覧を取得
 */
export async function getStudentTextbookExams(
  studentTextbookId: string
): Promise<StudentTextbookExam[]> {
  const { data, error } = await supabase
    .from('student_textbook_exams')
    .select('*')
    .eq('student_textbook_id', studentTextbookId)
    .order('exam_date', { ascending: true });

  if (error) {
    throw new Error(`テスト設定の取得に失敗しました: ${error.message}`);
  }

  return (data || []) as StudentTextbookExam[];
}

/**
 * テスト設定を作成
 */
export async function createStudentTextbookExam(
  exam: StudentTextbookExamInsert
): Promise<StudentTextbookExam> {
  const { data, error } = await supabase
    .from('student_textbook_exams')
    .insert(exam)
    .select()
    .single();

  if (error) {
    throw new Error(`テスト設定の作成に失敗しました: ${error.message}`);
  }

  return data as StudentTextbookExam;
}

/**
 * テスト設定を更新
 */
export async function updateStudentTextbookExam(
  id: string,
  exam: StudentTextbookExamUpdate
): Promise<StudentTextbookExam> {
  const { data, error } = await supabase
    .from('student_textbook_exams')
    .update(exam)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw new Error(`テスト設定の更新に失敗しました: ${error.message}`);
  }

  return data as StudentTextbookExam;
}

/**
 * テスト設定を削除
 */
export async function deleteStudentTextbookExam(id: string): Promise<void> {
  const { error } = await supabase
    .from('student_textbook_exams')
    .delete()
    .eq('id', id);

  if (error) {
    throw new Error(`テスト設定の削除に失敗しました: ${error.message}`);
  }
}

// ============================================
// 進行記録（student_progress）
// ============================================

/**
 * 生徒×テキストの進行記録一覧を取得
 */
export async function getStudentProgress(
  studentTextbookId: string
): Promise<CurriculumItemWithProgress[]> {
  // テキストIDを取得
  const { data: stData, error: stError } = await supabase
    .from('student_textbooks')
    .select('textbook_id')
    .eq('id', studentTextbookId)
    .single();

  if (stError || !stData) {
    throw new Error(`生徒テキストの取得に失敗しました`);
  }

  // 目次項目を取得
  const curriculumItems = await getCurriculumItems(stData.textbook_id);

  // 進行記録を取得（exam_range_exam_type, lessons をJOIN）
  const { data: progressData, error: progressError } = await supabase
    .from('student_progress')
    .select(`
      *,
      lessons:student_progress_lessons(*),
      exam_range_exam_type:exam_types(*)
    `)
    .eq('student_textbook_id', studentTextbookId);

  if (progressError) {
    throw new Error(`進行記録の取得に失敗しました: ${progressError.message}`);
  }

  const progressMap = new Map<string, StudentProgressWithDetails>();
  (progressData || []).forEach((p: Record<string, unknown>) => {
    progressMap.set(String(p.curriculum_item_id), p as unknown as StudentProgressWithDetails);
  });

  // 目次項目と進行記録を結合
  const result: CurriculumItemWithProgress[] = curriculumItems.map((item) => ({
    ...item,
    progress: progressMap.get(item.id.toString()) || null,
  }));

  return result;
}

/**
 * 進行記録を作成または更新
 */
export async function upsertStudentProgress(
  progress: StudentProgressInsert
): Promise<StudentProgress> {
  const { data, error } = await supabase
    .from('student_progress')
    .upsert(
      progress,
      {
        onConflict: 'student_textbook_id,curriculum_item_id',
      }
    )
    .select()
    .single();

  if (error) {
    throw new Error(`進行記録の保存に失敗しました: ${error.message}`);
  }

  return data as StudentProgress;
}

/**
 * 進行記録を更新
 */
export async function updateStudentProgress(
  id: string,
  progress: StudentProgressUpdate
): Promise<StudentProgress> {
  const { data, error } = await supabase
    .from('student_progress')
    .update(progress)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw new Error(`進行記録の更新に失敗しました: ${error.message}`);
  }

  return data as StudentProgress;
}

/**
 * 進行記録を削除
 */
export async function deleteStudentProgress(id: string): Promise<void> {
  const { error } = await supabase
    .from('student_progress')
    .delete()
    .eq('id', id);

  if (error) {
    throw new Error(`進行記録の削除に失敗しました: ${error.message}`);
  }
}

// ============================================
// 指導日記録（student_progress_lessons）
// ============================================

/**
 * 進行記録の指導日一覧を取得
 */
export async function getStudentProgressLessons(
  studentProgressId: string
): Promise<StudentProgressLesson[]> {
  const { data, error } = await supabase
    .from('student_progress_lessons')
    .select('*')
    .eq('student_progress_id', studentProgressId)
    .order('lesson_number', { ascending: true });

  if (error) {
    throw new Error(`指導日の取得に失敗しました: ${error.message}`);
  }

  return (data || []) as StudentProgressLesson[];
}

/**
 * 指導日を作成または更新
 */
export async function upsertStudentProgressLesson(
  lesson: StudentProgressLessonInsert
): Promise<StudentProgressLesson> {
  const { data, error } = await supabase
    .from('student_progress_lessons')
    .upsert(lesson, {
      onConflict: 'student_progress_id,lesson_number',
    })
    .select()
    .single();

  if (error) {
    throw new Error(`指導日の保存に失敗しました: ${error.message}`);
  }

  return data as StudentProgressLesson;
}

/**
 * 指導日を削除
 */
export async function deleteStudentProgressLesson(id: string): Promise<void> {
  const { error } = await supabase
    .from('student_progress_lessons')
    .delete()
    .eq('id', id);

  if (error) {
    throw new Error(`指導日の削除に失敗しました: ${error.message}`);
  }
}

// =====================================================
// グループ化機能
// =====================================================

/**
 * 次のグループ番号を取得
 */
export async function getNextGroupNumber(studentTextbookId: string): Promise<number> {
  const { data, error } = await supabase
    .from('student_progress')
    .select('group_number')
    .eq('student_textbook_id', studentTextbookId)
    .not('group_number', 'is', null)
    .order('group_number', { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(`グループ番号の取得に失敗しました: ${error.message}`);
  }
  
  const maxGroup = data?.[0]?.group_number ?? 0;
  return maxGroup + 1;
}

/**
 * 複数の単元をグループ化
 */
export async function groupProgressItems(
  studentTextbookId: string,
  curriculumItemIds: number[]
): Promise<void> {
  if (curriculumItemIds.length < 2) {
    throw new Error('グループ化には2つ以上の単元が必要です');
  }

  // 次のグループ番号を取得
  const groupNumber = await getNextGroupNumber(studentTextbookId);

  // 各単元の進行データを更新（なければ作成）
  for (const curriculumItemId of curriculumItemIds) {
    const { error } = await supabase
      .from('student_progress')
      .upsert({
        student_textbook_id: studentTextbookId,
        curriculum_item_id: curriculumItemId,
        group_number: groupNumber,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'student_textbook_id,curriculum_item_id',
      });

    if (error) {
      throw new Error(`グループ化に失敗しました: ${error.message}`);
    }
  }
}

/**
 * グループ解除
 */
export async function ungroupProgressItems(
  studentTextbookId: string,
  curriculumItemIds: number[]
): Promise<void> {
  const { error } = await supabase
    .from('student_progress')
    .update({ 
      group_number: null,
      updated_at: new Date().toISOString(),
    })
    .eq('student_textbook_id', studentTextbookId)
    .in('curriculum_item_id', curriculumItemIds);

  if (error) {
    throw new Error(`グループ解除に失敗しました: ${error.message}`);
  }
}

/**
 * グループ全体の提案・申込回数を更新（グループの先頭行に値を設定）
 */
export async function updateGroupCounts(
  studentTextbookId: string,
  groupNumber: number,
  proposalCount: number,
  applicationCount: number,
  firstCurriculumItemId: number
): Promise<void> {
  // まずグループ内の全ての行の回数を0にする
  const { error: updateError } = await supabase
    .from('student_progress')
    .update({
      proposal_count: 0,
      application_count: 0,
      updated_at: new Date().toISOString(),
    })
    .eq('student_textbook_id', studentTextbookId)
    .eq('group_number', groupNumber);

  if (updateError) {
    throw new Error(`グループ回数の更新に失敗しました: ${updateError.message}`);
  }

  // 先頭行にのみ回数を設定
  const { error: setError } = await supabase
    .from('student_progress')
    .update({
      proposal_count: proposalCount,
      application_count: applicationCount,
      updated_at: new Date().toISOString(),
    })
    .eq('student_textbook_id', studentTextbookId)
    .eq('curriculum_item_id', firstCurriculumItemId);

  if (setError) {
    throw new Error(`グループ回数の設定に失敗しました: ${setError.message}`);
  }
}

// =====================================================
// 表示用データ変換
// =====================================================

/**
 * 進行データを表示用に変換（グループ化対応）
 */
export function convertToDisplayRows(
  items: CurriculumItem[],
  progressList: (StudentProgress | StudentProgressWithDetails)[]
): ProgressRowDisplay[] {
  // curriculum_item_idでProgressを引けるMapを作成
  const progressMap = new Map<number, StudentProgress | StudentProgressWithDetails>();
  for (const p of progressList) {
    progressMap.set(p.curriculum_item_id, p);
  }

  // グループごとの単元リストを作成
  const groupItems = new Map<number, number[]>(); // group_number -> curriculum_item_ids[]
  for (const item of items) {
    const progress = progressMap.get(item.id);
    if (progress?.group_number != null) {
      const existing = groupItems.get(progress.group_number) || [];
      existing.push(item.id);
      groupItems.set(progress.group_number, existing);
    }
  }

  // 表示用行データを作成
  const displayRows: ProgressRowDisplay[] = [];
  const processedGroups = new Set<number>();

  for (const item of items) {
    const progress = (progressMap.get(item.id) || null) as StudentProgressWithDetails | null;
    const groupNumber = progress?.group_number;

    if (groupNumber != null) {
      // グループに属する単元
      const groupItemIds = groupItems.get(groupNumber) || [];
      const isFirstInGroup = !processedGroups.has(groupNumber);

      if (isFirstInGroup) {
        processedGroups.add(groupNumber);

        // グループ全体の提案・申込回数を計算
        let totalProposal = 0;
        let totalApplication = 0;
        for (const itemId of groupItemIds) {
          const p = progressMap.get(itemId);
          totalProposal += p?.proposal_count || 0;
          totalApplication += p?.application_count || 0;
        }

        displayRows.push({
          curriculumItem: item,
          progress,
          isGroupStart: true,
          groupRowSpan: groupItemIds.length,
          groupProposalCount: totalProposal,
          groupApplicationCount: totalApplication,
        });
      } else {
        // グループの2行目以降
        displayRows.push({
          curriculumItem: item,
          progress,
          isGroupStart: false,
          groupRowSpan: 0,
          groupProposalCount: 0,
          groupApplicationCount: 0,
        });
      }
    } else {
      // グループに属さない単独単元
      displayRows.push({
        curriculumItem: item,
        progress,
        isGroupStart: true,
        groupRowSpan: 1,
        groupProposalCount: progress?.proposal_count || 0,
        groupApplicationCount: progress?.application_count || 0,
      });
    }
  }

  return displayRows;
}
