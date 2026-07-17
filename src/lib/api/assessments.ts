import { supabase } from '@/lib/supabase';
import { getDefaultSchoolId } from '@/lib/api/schools';
import { fetchAllPaged, fetchInChunks } from '@/lib/utils/supabasePaging';
import type {
  Assessment,
  AssessmentInsert,
  AssessmentWithScores,
  AssessmentScore,
  AssessmentScoreInsert,
} from '@/types/database';
import { ASSESSMENT_NAME_LABELS } from '@/types/database';
// 共通9科の科目コード。保護者ポータルv2 Stage5（成績申請）も同じ集合を使うため
// src/lib/scores/subjects.ts に切り出し済み（挙動は変えないリファクタ）。
import { COMMON_9_SUBJECTS } from '@/lib/scores/subjects';

// 5科の科目コード（英数国社理）
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _FIVE_SUBJECTS = ['english', 'math', 'japanese', 'social', 'science'] as const;

// mock用の科目コード（5科偏差値 + 3科・5科手入力）
const MOCK_SUBJECTS = [
  'english',
  'math',
  'japanese',
  'social',
  'science',
  'hensa_3',
  'hensa_5',
] as const;

/**
 * 教室単位で成績一覧をバッチ取得（アラート用）
 * student_id でグルーピングした Map を返す
 */
export async function listAssessmentsBySchool(
  schoolIds: string[],
  category?: 'regular_test' | 'report_card' | 'mock'
): Promise<Map<string, AssessmentWithScores[]>> {
  if (schoolIds.length === 0) return new Map();

  // 成績は教室横断・全学年・全月で蓄積し1000行を超えうるため全件ページング取得
  // （旧実装の .limit(5000) は暫定上限で、超過分は静かに切り捨てられていた）。
  // grade/exam_month/name_code は一意でないため id を第2ソートキーに足して安定ページング。
  let assessmentsTyped: Assessment[];
  try {
    assessmentsTyped = await fetchAllPaged<Assessment>((from, to) => {
      let q = supabase
        .from('assessments')
        .select('*')
        .in('school_id', schoolIds)
        .order('grade', { ascending: false })
        .order('exam_month', { ascending: false, nullsFirst: false })
        .order('name_code', { ascending: true })
        .order('id', { ascending: true });
      if (category) q = q.eq('category', category);
      return q.range(from, to);
    });
  } catch (assessmentsError) {
    console.error('Error fetching assessments:', assessmentsError);
    throw new Error('成績データの取得に失敗しました');
  }

  if (assessmentsTyped.length === 0) {
    return new Map();
  }

  const assessmentIds = assessmentsTyped.map((a) => a.id);

  // assessment_scores は assessment 1件あたり数科目分。assessmentIds をチャンク分割して
  // 取得する（1チャンク=100件×科目数<1000行なのでチャンク内ページングは不要=fetchInChunks）。
  let scoresTyped: AssessmentScore[];
  try {
    scoresTyped = await fetchInChunks<AssessmentScore>(
      assessmentIds,
      (chunk) => supabase.from('assessment_scores').select('*').in('assessment_id', chunk),
      100
    );
  } catch (scoresError) {
    console.error('Error fetching assessment scores:', scoresError);
    throw new Error('成績スコアの取得に失敗しました');
  }
  const assessmentsWithScores: AssessmentWithScores[] = assessmentsTyped.map((assessment) => ({
    ...assessment,
    scores: scoresTyped.filter((score) => score.assessment_id === assessment.id),
  }));

  const byStudent = new Map<string, AssessmentWithScores[]>();
  for (const a of assessmentsWithScores) {
    const list = byStudent.get(a.student_id) || [];
    list.push(a);
    byStudent.set(a.student_id, list);
  }

  return byStudent;
}

/**
 * 生徒の成績一覧を取得（カテゴリ別）
 *
 * 注: student_id はグローバルに一意で1生徒は必ず1教室に属するため、
 * 追加で school_id フィルタは不要。NEXT_PUBLIC_DEFAULT_SCHOOL_ID と
 * 実際の生徒所属校が異なるケース（マルチ教室）で空結果になる不具合を回避。
 */
export async function listAssessments(
  studentId: string,
  category?: 'regular_test' | 'report_card' | 'mock'
): Promise<AssessmentWithScores[]> {
  let query = supabase
    .from('assessments')
    .select('*')
    .eq('student_id', studentId)
    .order('grade', { ascending: false }) // 学年の高い順（変遷可視化のため）
    .order('exam_month', { ascending: false, nullsFirst: false })
    .order('name_code', { ascending: true });

  if (category) {
    query = query.eq('category', category);
  }

  const { data: assessments, error: assessmentsError } = await query;

  if (assessmentsError) {
    console.error('Error fetching assessments:', assessmentsError);
    throw new Error('成績データの取得に失敗しました');
  }

  if (!assessments || assessments.length === 0) {
    return [];
  }

  const assessmentsList = assessments as Assessment[];
  // 各assessmentのスコアを取得
  const assessmentIds = assessmentsList.map((a) => a.id);
  const { data: scores, error: scoresError } = await supabase
    .from('assessment_scores')
    .select('*')
    .in('assessment_id', assessmentIds);

  if (scoresError) {
    console.error('Error fetching assessment scores:', scoresError);
    throw new Error('成績スコアの取得に失敗しました');
  }

  // assessmentとscoresを結合
  const scoresTyped = (scores || []) as AssessmentScore[];
  const assessmentsWithScores: AssessmentWithScores[] = assessmentsList.map((assessment) => ({
    ...assessment,
    scores: scoresTyped.filter((score) => score.assessment_id === assessment.id),
  }));

  return assessmentsWithScores;
}

/**
 * 成績行を作成（必要な科目のスコア行も空で作成）
 */
export async function createAssessmentRow(
  studentId: string,
  category: 'regular_test' | 'report_card' | 'mock',
  nameCode: string,
  grade: number,
  examMonth?: string | null // YYYY-MM形式
): Promise<AssessmentWithScores> {
  // 生徒の実 school_id を取得（マルチ教室対応）。取得失敗時は DEFAULT にフォールバック
  let schoolId = getDefaultSchoolId();
  const { data: studentRow } = await supabase
    .from('students')
    .select('school_id')
    .eq('id', studentId)
    .maybeSingle();
  if (studentRow && (studentRow as { school_id?: string }).school_id) {
    schoolId = (studentRow as { school_id: string }).school_id;
  }

  // YYYY-MMをYYYY-MM-01に変換
  const examMonthDate = examMonth ? `${examMonth}-01` : null;
  // name_codeからtitleを生成（互換性のため）
  const title = ASSESSMENT_NAME_LABELS[nameCode] || nameCode;

  // assessment行を作成
  const assessmentData: AssessmentInsert = {
    school_id: schoolId,
    student_id: studentId,
    category,
    name_code: nameCode,
    title,
    exam_month: examMonthDate,
    exam_date: examMonthDate, // 互換性のため
    grade,
  };

  const { data: assessment, error: assessmentError } = await supabase
    .from('assessments')
    .insert(assessmentData)
    .select()
    .single();

  if (assessmentError) {
    console.error('Error creating assessment:', assessmentError);
    throw new Error('成績行の作成に失敗しました');
  }

  const assessmentRow = assessment as Assessment;
  // 必要な科目のスコア行を空で作成
  let subjectsToCreate: readonly string[];
  if (category === 'mock') {
    subjectsToCreate = MOCK_SUBJECTS;
  } else {
    // regular_test と report_card は9科
    subjectsToCreate = COMMON_9_SUBJECTS;
  }

  const scoreInserts: AssessmentScoreInsert[] = subjectsToCreate.map((subject) => ({
    assessment_id: assessmentRow.id,
    subject,
    value: null,
  }));

  const { error: scoresError } = await supabase.from('assessment_scores').insert(scoreInserts);

  if (scoresError) {
    console.error('Error creating assessment scores:', scoresError);
    // assessmentは作成済みなので、エラーをログに記録するが、処理は続行
    console.warn('スコア行の作成に失敗しましたが、成績行は作成されました');
  }

  // 作成したassessmentとscoresを返す
  const { data: scores, error: fetchScoresError } = await supabase
    .from('assessment_scores')
    .select('*')
    .eq('assessment_id', assessmentRow.id);

  if (fetchScoresError) {
    console.error('Error fetching created scores:', fetchScoresError);
  }

  return {
    ...assessmentRow,
    scores: (scores || []) as AssessmentScore[],
  };
}

/**
 * スコアを更新（1セル更新）
 */
export async function updateScore(
  assessmentId: string,
  subject: string,
  value: number | null
): Promise<AssessmentScore> {
  // 既存のスコアを確認
  const { data: existingScore, error: fetchError } = await supabase
    .from('assessment_scores')
    .select('*')
    .eq('assessment_id', assessmentId)
    .eq('subject', subject)
    .single();

  if (fetchError && fetchError.code !== 'PGRST116') {
    // PGRST116は「レコードが見つからない」エラー
    console.error('Error fetching existing score:', fetchError);
    throw new Error('スコアの取得に失敗しました');
  }

  const existing = existingScore as AssessmentScore | null;
  if (existing) {
    // 更新
    const { data: updatedScore, error: updateError } = await supabase
      .from('assessment_scores')
      .update({ value })
      .eq('id', existing.id)
      .select()
      .single();

    if (updateError) {
      console.error('Error updating score:', updateError);
      throw new Error('スコアの更新に失敗しました');
    }

    return updatedScore as AssessmentScore;
  } else {
    // 新規作成
    const { data: newScore, error: insertError } = await supabase
      .from('assessment_scores')
      .insert({
        assessment_id: assessmentId,
        subject,
        value,
      })
      .select()
      .single();

    if (insertError) {
      console.error('Error creating score:', insertError);
      throw new Error('スコアの作成に失敗しました');
    }

    return newScore as AssessmentScore;
  }
}

/**
 * 成績行のメタ情報を更新（grade, exam_month, name_code）
 */
export async function updateAssessmentMeta(
  assessmentId: string,
  updates: {
    grade?: number;
    examMonth?: string | null; // YYYY-MM形式
    nameCode?: string;
  }
): Promise<Assessment> {
  const updateData: Partial<Assessment> = {};

  if (updates.grade !== undefined) {
    updateData.grade = updates.grade;
  }

  if (updates.examMonth !== undefined) {
    const examMonthDate = updates.examMonth ? `${updates.examMonth}-01` : null;
    updateData.exam_month = examMonthDate;
    updateData.exam_date = examMonthDate; // 互換性のため
  }

  if (updates.nameCode !== undefined) {
    updateData.name_code = updates.nameCode;
    // name_codeからtitleを生成（互換性のため）
    updateData.title = ASSESSMENT_NAME_LABELS[updates.nameCode] || updates.nameCode;
  }

  const { data: updatedAssessment, error } = await supabase
    .from('assessments')
    .update(updateData)
    .eq('id', assessmentId)
    .select()
    .single();

  if (error) {
    console.error('Error updating assessment meta:', error);
    throw new Error('成績行の更新に失敗しました');
  }

  return updatedAssessment as Assessment;
}

/**
 * 成績行を削除（物理削除）
 */
export async function deleteAssessmentRow(assessmentId: string): Promise<void> {
  // assessmentを削除すると、CASCADEでassessment_scoresも削除される
  const { error } = await supabase.from('assessments').delete().eq('id', assessmentId);

  if (error) {
    console.error('Error deleting assessment:', error);
    throw new Error('成績行の削除に失敗しました');
  }
}
